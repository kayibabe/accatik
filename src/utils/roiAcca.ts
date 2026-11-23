import type {
  AccaLeg,
  AccaStrategy,
  Fixture,
  MarketOption,
} from '../types/fixtures.ts';
import type {
  FeaturedPickSource,
  RoiAccaResponse,
  RoiRegistryEntry,
} from '../types/analytics.ts';
import { legFromMarket } from './accaEngine.ts';
import { isPriced } from './pickResolver.ts';
import { resolveMarketSelection } from './marketSelection.ts';
import { resolveFeaturedPick } from './featuredPickSnapshot.ts';
import { inferPriceQuality, isPreMatchFixture } from './priceQuality.ts';
import {
  guardTicket,
  MAX_RECOMMENDED_LEGS,
  ticketEconomics,
} from './ticketGuard.ts';

/**
 * Research accumulator built exclusively from promoted ROI selections.
 *
 * No leg is added to chase the headline price: every candidate has already
 * passed the promotion gate and the framework's QUALIFIED status. The 5.00+
 * target simply decides how many promoted legs are needed; if five short legs
 * still fall short, the ticket stays short and `targetReached` is false. The
 * guard runs in research mode so the short-price bypass is documented rather
 * than silently applied.
 */

export interface RoiAccaOptions {
  targetOdds: number;
  maxLegs: number;
  nowMs?: number;
}

interface Candidate {
  fixture: Fixture;
  market: MarketOption;
  source: FeaturedPickSource;
  selectionKey: string;
  roi: number | null;
  roiCiLow: number | null;
  settled: number;
}

function candidatesFor(
  fixture: Fixture,
  strategy: AccaStrategy,
  promoted: Map<string, RoiRegistryEntry>
): Candidate[] {
  const cards: Array<{ source: FeaturedPickSource; market: MarketOption | null }> = [
    { source: 'angle', market: resolveFeaturedPick(fixture, strategy, 'angle') },
    { source: 'cover', market: resolveFeaturedPick(fixture, strategy, 'cover') },
    { source: 'note', market: resolveFeaturedPick(fixture, strategy, 'note') },
  ];

  const result: Candidate[] = [];
  for (const card of cards) {
    if (!card.market || !isPriced(card.market)) continue;
    const selection = resolveMarketSelection(card.market, fixture);
    const entry = promoted.get(`${card.source}:${selection.key}`);
    if (!entry) continue;
    result.push({
      fixture,
      market: card.market,
      source: card.source,
      selectionKey: selection.key,
      roi: entry.roi,
      roiCiLow: entry.roiCiLow,
      settled: entry.settled,
    });
  }
  return result;
}

export function buildRoiAcca(
  fixtures: Fixture[],
  registry: RoiRegistryEntry[],
  strategy: AccaStrategy,
  options: RoiAccaOptions
): Omit<
  RoiAccaResponse,
  'economics' | 'recommended' | 'mode' | 'stake' | 'reason' | 'riskWarning'
> {
  const nowMs = options.nowMs ?? Date.now();
  const promoted = new Map(
    registry
      .filter((entry) => entry.strategy === strategy && entry.status === 'promoted')
      .map((entry) => [`${entry.source}:${entry.selectionKey}`, entry])
  );

  const candidates = fixtures
    .filter((fixture) => {
      if (!isPreMatchFixture(fixture)) return false;
      if (inferPriceQuality(fixture) !== 'prematch') return false;
      if (fixture.kickoffTimestamp && fixture.kickoffTimestamp <= nowMs) return false;
      if (!fixture.markets.some(isPriced)) return false;
      return true;
    })
    .flatMap((fixture) => candidatesFor(fixture, strategy, promoted))
    .sort((a, b) => {
      // Strongest statistical edge first, then the highest price that reaches
      // the target in fewer legs. Ties fall back to kickoff order.
      const ciDiff = (b.roiCiLow ?? -Infinity) - (a.roiCiLow ?? -Infinity);
      if (ciDiff !== 0) return ciDiff;
      const oddsDiff = b.market.odds - a.market.odds;
      if (oddsDiff !== 0) return oddsDiff;
      const settledDiff = b.settled - a.settled;
      if (settledDiff !== 0) return settledDiff;
      return (
        (a.fixture.kickoffTimestamp ?? 0) - (b.fixture.kickoffTimestamp ?? 0)
      );
    });

  const legs: AccaLeg[] = [];
  const usedFixtureIds = new Set<string>();
  const rejected: Array<{ fixtureId: string; marketId: string; reason: string }> = [];
  let product = 1;

  for (const candidate of candidates) {
    const framework = candidate.market.framework;
    if (framework && framework.status !== 'QUALIFIED') {
      rejected.push({
        fixtureId: candidate.fixture.id,
        marketId: candidate.market.id,
        reason: `Framework ${framework.status}: ${
          framework.reasonCodes.join(', ') || 'not qualified'
        }.`,
      });
      continue;
    }
    if (product >= options.targetOdds) {
      rejected.push({
        fixtureId: candidate.fixture.id,
        marketId: candidate.market.id,
        reason: 'Target odds already reached.',
      });
      continue;
    }
    if (legs.length >= options.maxLegs) {
      rejected.push({
        fixtureId: candidate.fixture.id,
        marketId: candidate.market.id,
        reason: `Maximum ${options.maxLegs} legs reached.`,
      });
      continue;
    }
    if (usedFixtureIds.has(candidate.fixture.id)) {
      rejected.push({
        fixtureId: candidate.fixture.id,
        marketId: candidate.market.id,
        reason: 'Another selection from this fixture is already on the ticket.',
      });
      continue;
    }
    legs.push(legFromMarket(candidate.fixture, candidate.market));
    usedFixtureIds.add(candidate.fixture.id);
    product *= candidate.market.odds;
  }

  return {
    dateIso: new Date(nowMs).toISOString().slice(0, 10),
    strategy,
    targetOdds: options.targetOdds,
    maxLegs: options.maxLegs,
    legs,
    totalOdds: legs.reduce((acc, leg) => acc * leg.odds, 1),
    targetReached: product >= options.targetOdds,
    rejected,
  };
}

/**
 * Hard boundary for generated tickets. The ROI builder only ever produces
 * shadow-ledger research tickets; a request that asks for a stake, a live
 * placement or a recommendation is rejected before any ticket is built.
 */
export function isLiveStakingRequest(body: unknown): boolean {
  if (body === null || typeof body !== 'object') return false;
  const source = body as Record<string, unknown>;
  return (
    source.placeBet === true ||
    source.live === true ||
    source.mode === 'live' ||
    source.recommended === true ||
    'stake' in source ||
    'stakeAmount' in source
  );
}

/** Grade a research ticket with the structural caps explicitly bypassed. */
export function guardRoiAcca(legs: AccaLeg[]): {
  economics: ReturnType<typeof ticketEconomics>;
  recommended: false;
  reason: string;
  riskWarning: string;
} {
  const guard = guardTicket(legs, {
    researchMode: true,
    maxLegs: MAX_RECOMMENDED_LEGS,
  });
  const marginPts = Math.max(
    0,
    guard.economics.breakEvenChance - guard.economics.fairChance
  );
  return {
    economics: guard.economics,
    recommended: false,
    reason: guard.reason,
    riskWarning:
      `Research only. ${guard.legs.length} legs compound the bookmaker margin; fair chance is ${marginPts.toFixed(1)} points below break-even. ` +
      'Historical flat-stake ROI on a single selection is not the expected return of an accumulator. Flat stake only, never a recommended bet.',
  };
}
