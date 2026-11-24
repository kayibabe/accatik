import type { AccaStrategy, Fixture, SettlementStatus } from '../../src/types/fixtures.ts';
import type {
  GradeFilterGrade,
  GradeFilterMatch,
  GradeFilterPickSummary,
  GradeFilterResponse,
  GradeFilterTicket,
  GradeFilterTicketSummary,
  TicketReplayStatus,
} from '../../src/types/analytics.ts';
import { evaluateTicketSettlement } from '../../src/utils/accaMath.ts';
import { buildRecommendedAcca } from '../../src/utils/accaEngine.ts';
import { isPriced } from '../../src/utils/pickResolver.ts';
import { inferPriceQuality } from '../../src/utils/priceQuality.ts';
import { mapWithConcurrency } from './appwriteData.ts';
import { createTtlCache, registerAnalyticsCache } from './cache.ts';
import { studyPickForFixture } from './combinationRoi.ts';
import { listArchivedSlateDates, readArchivedSlate } from './slateArchive.ts';
import { getTodayIsoDate } from './time.ts';

/**
 * Archived review of the Pick Guide's investable grades.
 *
 * The panel keeps only Recommended Angle cards whose fair probability lands in
 * High or Solid, shows how those exact markets settled, and replays one
 * hypothetical accumulator per matchday from the same filtered pool.
 *
 * Two rules keep the replay honest:
 *   - only prices captured before kickoff are eligible;
 *   - the builder sees Scheduled clones, while settlement uses the final score.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const ARCHIVE_READ_CONCURRENCY = 4;
const STAKE = 1;
const GRADES: readonly GradeFilterGrade[] = ['High', 'Solid'];
const REPLAY_STATUSES: readonly SettlementStatus[] = ['Win', 'Lost', 'Void'];

const round1 = (value: number): number => Math.round(value * 10) / 10;
const round2 = (value: number): number => Math.round(value * 100) / 100;

function isDecided(status: SettlementStatus): boolean {
  return REPLAY_STATUSES.includes(status);
}

function usableFixture(fixture: Fixture): boolean {
  const home = fixture.score?.home;
  const away = fixture.score?.away;
  return (
    fixture.status === 'Finished' &&
    home !== null &&
    home !== undefined &&
    away !== null &&
    away !== undefined &&
    (fixture.allMarkets ?? fixture.markets).some(isPriced) &&
    inferPriceQuality(fixture) === 'prematch'
  );
}

function pickSummary(matches: GradeFilterMatch[]): GradeFilterPickSummary {
  let wins = 0;
  let losses = 0;
  let voids = 0;
  let oddsSum = 0;
  let returns = 0;

  for (const match of matches) {
    oddsSum += match.odds;
    if (match.status === 'Win') {
      wins += 1;
      returns += match.odds;
    } else if (match.status === 'Lost') {
      losses += 1;
    } else {
      voids += 1;
    }
  }

  const staked = wins + losses;
  const netPnl = round2(returns - staked);
  return {
    matches: matches.length,
    settled: matches.length,
    staked,
    wins,
    losses,
    voids,
    hitRate: staked > 0 ? round1((wins / staked) * 100) : null,
    avgOdds: staked > 0 ? round2(oddsSum / matches.length) : null,
    netPnl,
    roi: staked > 0 ? round1((netPnl / staked) * 100) : null,
  };
}

function ticketSummary(tickets: GradeFilterTicket[]): GradeFilterTicketSummary {
  let wins = 0;
  let losses = 0;
  let voids = 0;
  let oddsSum = 0;
  let returns = 0;
  let positiveDays = 0;

  for (const ticket of tickets) {
    oddsSum += ticket.odds;
    if (ticket.status === 'Win') {
      wins += 1;
      returns += ticket.odds;
      if (ticket.pnl > 0) positiveDays += 1;
    } else if (ticket.status === 'Lost') {
      losses += 1;
    } else {
      voids += 1;
    }
  }

  const staked = wins + losses;
  const netPnl = round2(returns - staked);
  return {
    tickets: tickets.length,
    wins,
    losses,
    voids,
    hitRate: staked > 0 ? round1((wins / staked) * 100) : null,
    avgOdds: staked > 0 ? round2(oddsSum / staked) : null,
    netPnl,
    roi: staked > 0 ? round1((netPnl / staked) * 100) : null,
    positiveDays,
  };
}

const cache = createTtlCache<GradeFilterResponse>(CACHE_TTL_MS, 8);
registerAnalyticsCache(() => cache.clear());

export async function computeGradeFilter(
  strategy: AccaStrategy,
  targetLegs = 2,
  force = false
): Promise<GradeFilterResponse> {
  const legs = Math.min(5, Math.max(2, Math.round(targetLegs)));
  const cacheKey = `${strategy}:${legs}`;
  const cached = cache.get(cacheKey);
  if (cached && !force) return cached;

  const today = getTodayIsoDate();
  const dates = (await listArchivedSlateDates()).filter(
    (dateIso) => dateIso < today
  );
  const archives: Awaited<ReturnType<typeof readArchivedSlate>>[] = new Array(
    dates.length
  );
  await mapWithConcurrency(dates, ARCHIVE_READ_CONCURRENCY, async (dateIso, index) => {
    archives[index] = await readArchivedSlate(dateIso);
  });

  const matches: GradeFilterMatch[] = [];
  const tickets: GradeFilterTicket[] = [];

  for (let index = 0; index < dates.length; index += 1) {
    const archive = archives[index];
    if (!archive) continue;
    const dateIso = dates[index];
    const fixtures = archive.fixtures.filter(usableFixture);
    if (fixtures.length === 0) continue;

    const eligible: Array<{ fixture: Fixture; match: GradeFilterMatch }> = [];
    for (const fixture of fixtures) {
      const study = studyPickForFixture(fixture, strategy, 'angle');
      if (!study || !isDecided(study.status)) continue;
      const grade = study.band as GradeFilterGrade;
      if (!GRADES.includes(grade)) continue;
      eligible.push({
        fixture,
        match: {
          fixtureId: fixture.id,
          dateIso,
          homeTeam: fixture.homeTeam,
          awayTeam: fixture.awayTeam,
          competition: fixture.competition,
          matchDate: fixture.matchDate,
          kickoffTime: fixture.kickoffTime,
          grade,
          marketId: study.market.id,
          marketLabel: study.marketLabel,
          marketType: study.market.marketType,
          odds: study.market.odds,
          fairProbability: study.market.fairProbability ?? null,
          status: study.status,
        },
      });
    }
    matches.push(...eligible.map((entry) => entry.match));
    if (eligible.length < 2) continue;

    const replayFixtures = eligible.map(({ fixture, match }) => ({
      ...fixture,
      markets: [fixture.markets.find((m) => m.id === match.marketId) ?? studyMarket(fixture, match)],
      allMarkets: undefined,
      status: 'Scheduled' as const,
      awaitingResult: false,
    }));
    const built = buildRecommendedAcca(replayFixtures, 1000, strategy, legs);
    if (built.length < 2) continue;

    const settlement = evaluateTicketSettlement(
      built,
      eligible.map((entry) => entry.fixture),
      STAKE
    );
    if (!isDecided(settlement.status)) continue;

    const gradeByFixture = new Map(
      eligible.map((entry) => [entry.fixture.id, entry.match.grade])
    );
    const statusByFixture = new Map(
      eligible.map((entry) => [entry.fixture.id, entry.match.status])
    );
    tickets.push({
      id: `${dateIso}:${legs}`,
      dateIso,
      status: settlement.status as TicketReplayStatus,
      legs: built.length,
      odds: settlement.effectiveOdds,
      pnl:
        settlement.status === 'Win'
          ? round2(settlement.effectiveOdds - STAKE)
          : settlement.status === 'Lost'
            ? -STAKE
            : 0,
      picks: built.map((leg) => ({
        fixtureId: leg.fixtureId,
        homeTeam: leg.homeTeam,
        awayTeam: leg.awayTeam,
        marketLabel: leg.marketLabel,
        grade: gradeByFixture.get(leg.fixtureId) ?? 'Solid',
        odds: leg.odds,
        status: statusByFixture.get(leg.fixtureId) ?? 'Pending',
      })),
    });
  }

  matches.sort((a, b) =>
    a.dateIso.localeCompare(b.dateIso) ||
    a.homeTeam.localeCompare(b.homeTeam)
  );
  tickets.sort((a, b) => a.dateIso.localeCompare(b.dateIso));

  const caveats = [
    'Prematch-priced archived cards only; live and backfilled prices are excluded.',
    'High and Solid are book-probability grades, not an independent edge signal.',
    'One hypothetical ticket per matchday at a flat one-unit stake; research only, not a proven ROI strategy.',
  ];
  if (tickets.length > 0 && tickets.length < 20) {
    caveats.push(
      `Only ${tickets.length} simulated tickets across the whole archive; returns are not statistically reliable.`
    );
  }

  const result: GradeFilterResponse = {
    strategy,
    generatedAt: new Date().toISOString(),
    firstDateIso: matches[0]?.dateIso ?? null,
    lastDateIso: matches[matches.length - 1]?.dateIso ?? null,
    matchdays: new Set(matches.map((match) => match.dateIso)).size,
    grades: [...GRADES],
    priceFilter: 'prematch',
    stakePerPick: STAKE,
    stakePerTicket: STAKE,
    targetLegs: legs,
    matches,
    pickSummary: pickSummary(matches),
    tickets,
    ticketSummary: ticketSummary(tickets),
    caveats,
  };
  cache.set(cacheKey, result);
  return result;
}

/** Rebuild a settleable market when the original price block lacks this ref. */
function studyMarket(fixture: Fixture, match: GradeFilterMatch) {
  return {
    id: match.marketId,
    marketType: match.marketType,
    label: match.marketLabel,
    odds: match.odds,
    impliedProbability: Math.round((100 / match.odds) * 10) / 10,
    fairProbability: match.fairProbability ?? undefined,
    rationale: 'Captured filtered angle.',
    bookmaker: fixture.markets[0]?.bookmaker,
  };
}
