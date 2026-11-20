import type {
  AccaStrategy,
  Fixture,
  MarketOption,
  MarketType,
  SettlementStatus,
} from '../../src/types/fixtures.ts';
import type {
  MarketAnalyticsRow,
  PickAnalyticsDay,
  PickAnalyticsResponse,
  PickAnalyticsRow,
} from '../../src/types/analytics.ts';
import { evaluateMarketSettlement } from '../../src/utils/accaMath.ts';
import { resolveAnalystNoteMarket } from '../../src/utils/analystNote.ts';
import { isPriced } from '../../src/utils/pickResolver.ts';
import { buildRecommendedAngle } from '../../src/utils/recommendedAngle.ts';
import { mapWithConcurrency } from './appwriteData.ts';
import { createTtlCache } from './cache.ts';
import { listArchivedSlateDates, readArchivedSlate } from './slateArchive.ts';

/**
 * Inception-to-date record for the picks the engine already publishes.
 *
 * Unlike the board's 30-date hit-rate strip, this scan reads every archived
 * matchday and prices each settled pick at one flat unit. That makes hit rate,
 * net P&L and ROI directly comparable between the featured picks (angle, cover,
 * note) and the individual markets on the board. Void picks return their stake
 * and stay out of both the hit rate and the ROI denominator.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const STAKE_PER_PICK = 1;
const ARCHIVE_READ_CONCURRENCY = 4;
const TOP_SELECTIONS = 12;

interface Tally {
  key: string;
  label: string;
  settled: number;
  wins: number;
  losses: number;
  voids: number;
  stake: number;
  returns: number;
  oddsSum: number;
  oddsCount: number;
}

interface SelectionTally extends Tally {
  marketType: MarketType;
}

const newTally = (key: string, label: string): Tally => ({
  key,
  label,
  settled: 0,
  wins: 0,
  losses: 0,
  voids: 0,
  stake: 0,
  returns: 0,
  oddsSum: 0,
  oddsCount: 0,
});

const round1 = (value: number): number => Math.round(value * 10) / 10;
const round2 = (value: number): number => Math.round(value * 100) / 100;

function isDecided(status: SettlementStatus): boolean {
  return status === 'Win' || status === 'Lost' || status === 'Void';
}

function record(tally: Tally, market: MarketOption, status: SettlementStatus): void {
  if (!isDecided(status)) return;
  tally.settled += 1;

  if (status === 'Void') {
    tally.voids += 1;
    // The stake comes back, so it is neither risked nor returned as profit.
    // Counting it on both sides would inflate the denominator and mask ROI.
    return;
  }

  tally.stake += STAKE_PER_PICK;
  tally.oddsSum += market.odds;
  tally.oddsCount += 1;
  if (status === 'Win') {
    tally.wins += 1;
    tally.returns += STAKE_PER_PICK * market.odds;
  } else {
    tally.losses += 1;
  }
}

function toRow(tally: Tally): PickAnalyticsRow {
  const decided = tally.wins + tally.losses;
  const netPnl = round2(tally.returns - tally.stake);
  return {
    key: tally.key,
    label: tally.label,
    settled: tally.settled,
    wins: tally.wins,
    losses: tally.losses,
    voids: tally.voids,
    hitRate: decided > 0 ? round1((tally.wins / decided) * 100) : null,
    stake: round2(tally.stake),
    returns: round2(tally.returns),
    netPnl,
    roi: tally.stake > 0 ? round1((netPnl / tally.stake) * 100) : null,
    avgOdds: tally.oddsCount > 0 ? round2(tally.oddsSum / tally.oddsCount) : null,
  };
}

function getTally(
  map: Map<string, Tally>,
  key: string,
  label: string
): Tally {
  let tally = map.get(key);
  if (!tally) {
    tally = newTally(key, label);
    map.set(key, tally);
  }
  return tally;
}

function selectionKey(market: MarketOption): string {
  const label = market.label.trim().replace(/\s+/g, ' ');
  return `${market.marketType}|${label}`;
}

function sampleFixture(fixture: Fixture): boolean {
  return (
    fixture.status === 'Finished' &&
    fixture.score?.home !== null &&
    fixture.score?.home !== undefined &&
    fixture.score?.away !== null &&
    fixture.score?.away !== undefined &&
    fixture.markets.some(isPriced)
  );
}

function qualityKey(fixture: Fixture): 'prematch' | 'live' | 'unknown' {
  return fixture.priceQuality === 'prematch' || fixture.priceQuality === 'live'
    ? fixture.priceQuality
    : 'unknown';
}

function buildDaily(
  featuredByDate: Map<string, Tally>,
  marketByDate: Map<string, Tally>
): PickAnalyticsDay[] {
  const dates = [
    ...new Set([...featuredByDate.keys(), ...marketByDate.keys()]),
  ].sort();
  let cumulativeFeatured = 0;
  let cumulativeMarkets = 0;

  return dates.map((dateIso) => {
    const featured = toRow(
      featuredByDate.get(dateIso) ?? newTally(dateIso, dateIso)
    );
    const markets = toRow(
      marketByDate.get(dateIso) ?? newTally(dateIso, dateIso)
    );
    cumulativeFeatured = round2(cumulativeFeatured + featured.netPnl);
    cumulativeMarkets = round2(cumulativeMarkets + markets.netPnl);

    return {
      dateIso,
      settled: featured.settled + markets.settled,
      featuredNetPnl: featured.netPnl,
      marketNetPnl: markets.netPnl,
      cumulativeFeatured,
      cumulativeMarkets,
    };
  });
}

const cache = createTtlCache<PickAnalyticsResponse>(CACHE_TTL_MS, 8);

export async function computePickAnalytics(
  strategy: AccaStrategy,
  force = false
): Promise<PickAnalyticsResponse> {
  const cached = cache.get(strategy);
  if (cached && !force) return cached;

  const dates = await listArchivedSlateDates();
  const slates: (Awaited<ReturnType<typeof readArchivedSlate>> | undefined)[] =
    new Array(dates.length);
  await mapWithConcurrency(dates, ARCHIVE_READ_CONCURRENCY, async (dateIso, i) => {
    slates[i] = await readArchivedSlate(dateIso);
  });

  const angle = newTally('angle', 'Recommended Angle');
  const cover = newTally('cover', 'Safer cover');
  const note = newTally('note', 'Analyst note');
  const marketsByType = new Map<string, Tally>();
  const selections = new Map<string, SelectionTally>();
  const featuredByDate = new Map<string, Tally>();
  const marketByDate = new Map<string, Tally>();
  const priceQuality = { prematch: 0, live: 0, unknown: 0 };
  const usedDates: string[] = [];
  let sampleFixtures = 0;
  let marketPicks = 0;

  for (let i = 0; i < dates.length; i += 1) {
    const dateIso = dates[i];
    const slate = slates[i];
    if (!slate) continue;

    let dateUsed = false;
    for (const fixture of slate.fixtures) {
      if (!sampleFixture(fixture)) continue;
      dateUsed = true;
      sampleFixtures += 1;

      const featuredDate = getTally(featuredByDate, dateIso, dateIso);
      const recommended = buildRecommendedAngle(fixture, strategy);
      if (recommended) {
        record(
          angle,
          recommended.market,
          evaluateMarketSettlement(fixture, recommended.market)
        );
        record(
          featuredDate,
          recommended.market,
          evaluateMarketSettlement(fixture, recommended.market)
        );
        if (recommended.cover) {
          record(
            cover,
            recommended.cover,
            evaluateMarketSettlement(fixture, recommended.cover)
          );
          record(
            featuredDate,
            recommended.cover,
            evaluateMarketSettlement(fixture, recommended.cover)
          );
        }
        const noteMarket = resolveAnalystNoteMarket(
          fixture,
          fixture.modelAdvice
        );
        if (noteMarket) {
          record(
            note,
            noteMarket,
            evaluateMarketSettlement(fixture, noteMarket)
          );
          record(
            featuredDate,
            noteMarket,
            evaluateMarketSettlement(fixture, noteMarket)
          );
        }
      }

      for (const market of fixture.markets) {
        if (!isPriced(market)) continue;
        const status = evaluateMarketSettlement(fixture, market);
        if (!isDecided(status)) continue;

        const byType = getTally(
          marketsByType,
          market.marketType,
          market.marketType
        );
        record(byType, market, status);

        const key = selectionKey(market);
        let selection = selections.get(key);
        if (!selection) {
          selection = {
            ...newTally(key, market.label.trim().replace(/\s+/g, ' ')),
            marketType: market.marketType,
          };
          selections.set(key, selection);
        }
        record(selection, market, status);

        record(
          getTally(marketByDate, dateIso, dateIso),
          market,
          status
        );
        priceQuality[qualityKey(fixture)] += 1;
        marketPicks += 1;
      }
    }
    if (dateUsed) usedDates.push(dateIso);
  }

  const sortedDates = [...usedDates].sort();
  const byTypeRows = [...marketsByType.values()]
    .map(toRow)
    .sort((a, b) => b.settled - a.settled || a.label.localeCompare(b.label));
  const selectionRows: MarketAnalyticsRow[] = [...selections.values()]
    .map((tally) => ({ ...toRow(tally), marketType: tally.marketType }))
    .sort(
      (a, b) =>
        b.settled - a.settled ||
        (b.netPnl ?? 0) - (a.netPnl ?? 0) ||
        a.label.localeCompare(b.label)
    )
    .slice(0, TOP_SELECTIONS);

  const result: PickAnalyticsResponse = {
    strategy,
    generatedAt: new Date().toISOString(),
    firstDateIso: sortedDates[0] ?? null,
    lastDateIso: sortedDates[sortedDates.length - 1] ?? null,
    sampleDates: sortedDates.length,
    sampleFixtures,
    marketPicks,
    stakePerPick: STAKE_PER_PICK,
    priceQuality,
    featured: [toRow(angle), toRow(cover), toRow(note)],
    marketsByType: byTypeRows,
    marketsBySelection: selectionRows,
    daily: buildDaily(featuredByDate, marketByDate),
  };
  cache.set(strategy, result);
  return result;
}
