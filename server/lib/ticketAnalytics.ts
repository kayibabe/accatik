import type { AccaStrategy, Fixture } from '../../src/types/fixtures.ts';
import type {
  TicketReplayDay,
  TicketReplayResponse,
  TicketReplayRow,
  TicketReplayStatus,
  TicketReplaySummary,
  TicketVariantConfig,
} from '../../src/types/analytics.ts';
import { evaluateTicketSettlement } from '../../src/utils/accaMath.ts';
import { buildRecommendedAcca } from '../../src/utils/accaEngine.ts';
import { inferPriceQuality } from '../../src/utils/priceQuality.ts';
import { buildTicketVariants } from '../../src/utils/ticketControls.ts';
import { mapWithConcurrency } from './appwriteData.ts';
import { createTtlCache } from './cache.ts';
import { listArchivedSlateDates, readArchivedSlate } from './slateArchive.ts';

/**
 * Inception-to-date replay of the accumulator slip.
 *
 * The pick analytics scan prices settled selections; this scan prices whole
 * tickets the way the slip's builder would have built them on that matchday.
 * It is a reconstruction, not the saved-ticket ledger: one hypothetical ticket
 * per variant per matchday, always at a one-unit stake.
 *
 * Two rules keep the numbers honest:
 *   - a fixture is usable only if its price block was captured before kickoff;
 *   - the engine is replayed on a Scheduled clone, so it sees exactly what it
 *     would have seen before the match, while settlement uses the final score.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const ARCHIVE_READ_CONCURRENCY = 4;
const STAKE_PER_TICKET = 1;
const REPLAY_STATUSES: readonly string[] = ['Win', 'Lost', 'Void'];

interface ReplaySlate {
  dateIso: string;
  /** Finished fixtures with a score, used only for settlement. */
  fixtures: Fixture[];
  /** The same fixtures as the builder saw them, before kickoff. */
  builderFixtures: Fixture[];
}

const round1 = (value: number): number => Math.round(value * 10) / 10;
const round2 = (value: number): number => Math.round(value * 100) / 100;

function hasFinalScore(fixture: Fixture): boolean {
  return (
    fixture.status === 'Finished' &&
    fixture.score?.home !== null &&
    fixture.score?.home !== undefined &&
    fixture.score?.away !== null &&
    fixture.score?.away !== undefined &&
    fixture.markets.length > 0
  );
}

function usableFixture(fixture: Fixture): boolean {
  return hasFinalScore(fixture) && inferPriceQuality(fixture) === 'prematch';
}

/** Builds one ticket for a slate, mirroring the slip's auto-build controls. */
function replaySlate(
  slate: ReplaySlate,
  variant: TicketVariantConfig
): TicketReplayDay | null {
  const legs = buildRecommendedAcca(
    slate.builderFixtures,
    variant.targetOdds,
    variant.strategy,
    variant.maxLegs
  );
  if (legs.length === 0) return null;

  const settlement = evaluateTicketSettlement(
    legs,
    slate.fixtures,
    STAKE_PER_TICKET
  );
  if (!REPLAY_STATUSES.includes(settlement.status)) return null;

  // Effective odds drop voided legs, so a void ticket is not credited with a
  // target it could no longer pay at settlement.
  const odds = settlement.effectiveOdds;
  return {
    dateIso: slate.dateIso,
    status: settlement.status as TicketReplayStatus,
    legs: legs.length,
    odds,
    targetMet: odds >= variant.targetOdds,
  };
}

/** Flat-stake record for one control combination, oldest matchday first. */
export function summarizeTicketReplay(
  days: TicketReplayDay[],
  variant: TicketVariantConfig
): TicketReplaySummary {
  let wins = 0;
  let losses = 0;
  let voids = 0;
  let staked = 0;
  let returned = 0;
  let oddsSum = 0;
  let legsSum = 0;
  let targetHits = 0;
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let streak = 0;
  let longestLossStreak = 0;

  for (const day of days) {
    if (day.targetMet) targetHits += 1;

    if (day.status === 'Win') {
      wins += 1;
      staked += STAKE_PER_TICKET;
      returned += day.odds;
      oddsSum += day.odds;
      legsSum += day.legs;
      equity += day.odds - STAKE_PER_TICKET;
      streak = 0;
    } else if (day.status === 'Lost') {
      losses += 1;
      staked += STAKE_PER_TICKET;
      oddsSum += day.odds;
      legsSum += day.legs;
      equity -= STAKE_PER_TICKET;
      streak += 1;
      longestLossStreak = Math.max(longestLossStreak, streak);
    } else {
      // A voided leg returns its stake: no risk, no return, no streak change.
      voids += 1;
      continue;
    }
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  const decided = wins + losses;
  const avgOdds = decided > 0 ? round2(oddsSum / decided) : null;
  const netPnl = round2(returned - staked);
  const dates = days.map((day) => day.dateIso).sort();

  return {
    tickets: days.length,
    wins,
    losses,
    voids,
    hitRate: decided > 0 ? round1((wins / decided) * 100) : null,
    breakEvenHitRate: avgOdds !== null ? round1(100 / avgOdds) : null,
    targetHitRate:
      days.length > 0 ? round1((targetHits / days.length) * 100) : null,
    roi: staked > 0 ? round1((netPnl / staked) * 100) : null,
    netPnl,
    avgOdds,
    avgLegs: decided > 0 ? round1(legsSum / decided) : null,
    maxDrawdown: round2(maxDrawdown),
    longestLossStreak,
    firstDateIso: dates[0] ?? null,
    lastDateIso: dates[dates.length - 1] ?? null,
  };
}

const cache = createTtlCache<TicketReplayResponse>(CACHE_TTL_MS, 8);

export async function computeTicketAnalytics(
  strategy: AccaStrategy,
  minOdds: number,
  maxLegs: number,
  force = false
): Promise<TicketReplayResponse> {
  const cacheKey = `${strategy}:${minOdds}:${maxLegs}`;
  const cached = cache.get(cacheKey);
  if (cached && !force) return cached;

  const dates = await listArchivedSlateDates();
  const archives: (Awaited<ReturnType<typeof readArchivedSlate>> | undefined)[] =
    new Array(dates.length);
  await mapWithConcurrency(dates, ARCHIVE_READ_CONCURRENCY, async (dateIso, i) => {
    archives[i] = await readArchivedSlate(dateIso);
  });

  const slates: ReplaySlate[] = [];
  let pricedFixtures = 0;
  let excludedFixtures = 0;
  for (let i = 0; i < dates.length; i += 1) {
    const archive = archives[i];
    if (!archive) continue;
    const finished = archive.fixtures.filter(hasFinalScore);
    excludedFixtures += archive.fixtures.filter(
      (fixture) => fixture.status === 'Finished' && !hasFinalScore(fixture)
    ).length;
    const fixtures = finished.filter(usableFixture);
    excludedFixtures += finished.length - fixtures.length;
    pricedFixtures += fixtures.length;
    if (fixtures.length === 0) continue;

    slates.push({
      dateIso: dates[i],
      fixtures,
      builderFixtures: fixtures.map((fixture) => ({
        ...fixture,
        status: 'Scheduled' as const,
        awaitingResult: false,
      })),
    });
  }

  // Archive dates arrive newest-first, but the replay (equity, streaks) must
  // be walked forwards in time.
  slates.sort((a, b) => a.dateIso.localeCompare(b.dateIso));

  const variants = buildTicketVariants(strategy, minOdds, maxLegs);
  const allVariants = [
    ...variants.shapes,
    ...variants.strategies,
    ...variants.odds,
    ...variants.legs,
    variants.current,
  ];

  // Presets, control tables and the current shape share many configurations;
  // replay each distinct one once, then reuse it in every section.
  const byConfig = new Map<string, TicketReplayDay[]>();
  for (const variant of allVariants) {
    const key = `${variant.strategy}:${variant.targetOdds}:${variant.maxLegs}`;
    if (byConfig.has(key)) continue;
    const daily: TicketReplayDay[] = [];
    for (const slate of slates) {
      const day = replaySlate(slate, variant);
      if (day) daily.push(day);
    }
    byConfig.set(key, daily);
  }

  const toRow = (variant: TicketVariantConfig): TicketReplayRow => {
    const key = `${variant.strategy}:${variant.targetOdds}:${variant.maxLegs}`;
    const daily = byConfig.get(key) ?? [];
    return { ...variant, summary: summarizeTicketReplay(daily, variant), daily };
  };

  const usedDates = slates
    .filter((slate) =>
      allVariants.some((variant) => {
        const key = `${variant.strategy}:${variant.targetOdds}:${variant.maxLegs}`;
        return (byConfig.get(key) ?? []).some((day) => day.dateIso === slate.dateIso);
      })
    )
    .map((slate) => slate.dateIso);
  const sortedDates = [...usedDates].sort();

  const result: TicketReplayResponse = {
    generatedAt: new Date().toISOString(),
    firstDateIso: sortedDates[0] ?? null,
    lastDateIso: sortedDates[sortedDates.length - 1] ?? null,
    matchdays: sortedDates.length,
    pricedFixtures,
    excludedFixtures,
    stakePerTicket: STAKE_PER_TICKET,
    shapes: variants.shapes.map(toRow),
    strategies: variants.strategies.map(toRow),
    odds: variants.odds.map(toRow),
    legs: variants.legs.map(toRow),
    current: toRow(variants.current),
  };
  cache.set(cacheKey, result);
  return result;
}
