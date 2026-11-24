import type { MarketCalibrationRecord } from '../../src/framework/confidence.ts';
import type { Fixture, MarketOption } from '../../src/types/fixtures.ts';
import type { LedgerFile } from '../../src/types/ledger.ts';
import { evaluateMarketSettlement } from '../../src/utils/accaMath.ts';
import { resolveMarketSelection } from '../../src/utils/marketSelection.ts';
import { listArchivedSlateDates, readArchivedSlate } from './slateArchive.ts';
import { readLedger } from './ticketLedger.ts';

/**
 * Market Brier scores from settled shadow-ledger legs.
 *
 * The model probability is captured on the leg at decision time; the outcome
 * comes from the frozen archive. Only prematch, decided legs count, and each
 * fixture/market pair is counted once so a leg repeated across strategies does
 * not masquerade as independent evidence. Absence is honest: no record means
 * the confidence layer reports calibration as unavailable, not as good.
 */

const CALIBRATION_TTL_MS = 10 * 60 * 1000;
const MAX_CALIBRATION_DATES = 240;

interface BrierAccumulator {
  settled: number;
  brierSum: number;
}

export function computeMarketCalibration(
  ledger: LedgerFile,
  fixturesById: Map<string, Fixture>
): Record<string, MarketCalibrationRecord> {
  const seen = new Set<string>();
  const accumulators = new Map<string, BrierAccumulator>();

  for (const ticket of ledger.tickets) {
    if (ticket.status !== 'Win' && ticket.status !== 'Lost') continue;

    for (const leg of ticket.legs) {
      if (leg.priceQuality !== 'prematch') continue;
      const fixture = fixturesById.get(leg.fixtureId);
      if (!fixture) continue;

      const outcome = evaluateMarketSettlement(fixture, {
        id: leg.marketId,
        label: leg.marketLabel,
        marketType: leg.marketType,
      });
      if (outcome !== 'Win' && outcome !== 'Lost') continue;

      const pModel = leg.framework?.pModel;
      if (
        typeof pModel !== 'number' ||
        !Number.isFinite(pModel) ||
        pModel <= 0 ||
        pModel >= 1
      ) {
        continue;
      }

      const legKey = `${leg.fixtureId}:${leg.marketId}`;
      if (seen.has(legKey)) continue;
      seen.add(legKey);

      const market: MarketOption = {
        id: leg.marketId,
        marketType: leg.marketType,
        label: leg.marketLabel,
        odds: leg.odds,
        impliedProbability: leg.impliedProbability,
        rationale: leg.rationale,
      };
      const key = resolveMarketSelection(market, fixture).key;
      const accumulator = accumulators.get(key) ?? { settled: 0, brierSum: 0 };
      const target = outcome === 'Win' ? 1 : 0;
      accumulator.settled += 1;
      accumulator.brierSum += (pModel - target) ** 2;
      accumulators.set(key, accumulator);
    }
  }

  const calibration: Record<string, MarketCalibrationRecord> = {};
  for (const [key, accumulator] of accumulators) {
    if (accumulator.settled === 0) continue;
    calibration[key] = {
      settled: accumulator.settled,
      brier:
        Math.round((accumulator.brierSum / accumulator.settled) * 10_000) / 10_000,
    };
  }
  return calibration;
}

/** Reads the durable ledger and archive once per cache window. */
export async function loadMarketCalibration(): Promise<
  Record<string, MarketCalibrationRecord>
> {
  const [ledger, dates] = await Promise.all([
    readLedger(),
    listArchivedSlateDates(),
  ]);
  const fixturesById = new Map<string, Fixture>();

  for (const dateIso of dates.slice(0, MAX_CALIBRATION_DATES)) {
    const slate = await readArchivedSlate(dateIso);
    if (!slate) continue;
    for (const fixture of slate.fixtures) {
      if (!fixturesById.has(fixture.id)) fixturesById.set(fixture.id, fixture);
    }
  }

  return computeMarketCalibration(ledger, fixturesById);
}

interface CalibrationCache {
  builtAt: number;
  value: Record<string, MarketCalibrationRecord>;
}

let cache: CalibrationCache | null = null;
let inflight: Promise<Record<string, MarketCalibrationRecord>> | null = null;

/** Cached, single-flight view of market calibration for live assessments. */
export function getMarketCalibration(
  nowMs: number = Date.now()
): Promise<Record<string, MarketCalibrationRecord>> {
  if (cache && nowMs - cache.builtAt < CALIBRATION_TTL_MS) {
    return Promise.resolve(cache.value);
  }
  if (!inflight) {
    inflight = loadMarketCalibration()
      .then((value) => {
        cache = { builtAt: Date.now(), value };
        return value;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Test hook: the next read rebuilds from ledger and archive. */
export function clearMarketCalibrationCache(): void {
  cache = null;
}
