import type {
  AccaLeg,
  AccaStrategy,
  Fixture,
  MarketOption,
} from '../types/fixtures.ts';
import { calculateImpliedProbability } from './accaMath.ts';
import { getLeaguePriority } from './leaguePriority.ts';
import { resolvePick, scoreMarket } from './pickResolver.ts';

export function legFromMarket(fixture: Fixture, market: MarketOption): AccaLeg {
  return {
    fixtureId: fixture.id,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    competition: fixture.competition,
    matchDate: fixture.matchDate,
    kickoffTime: fixture.kickoffTime,
    marketId: market.id,
    marketLabel: market.label,
    marketType: market.marketType,
    odds: market.odds,
    impliedProbability:
      market.impliedProbability || calculateImpliedProbability(market.odds),
    fairProbability: market.fairProbability,
    rationale: market.rationale,
    bookmaker: market.bookmaker,
    locked: false,
    framework: market.framework,
  };
}

/** The framework caps accumulators at three legs (§14.1). */
export const MAX_ACCA_LEGS = 3;

function hasFrameworkDecision(fixture: Fixture): boolean {
  return Boolean(
    fixture.framework ||
      fixture.markets.some((market) => market.framework) ||
      fixture.allMarkets?.some((market) => market.framework)
  );
}

function bestMarketFor(
  fixture: Fixture,
  strategy: AccaStrategy
): { market: MarketOption; score: number } | null {
  // One market per fixture, chosen by the same resolver the board renders.
  const resolved = resolvePick(fixture, strategy);

  // Fixtures without a framework decision keep the legacy resolver path, so
  // archived replays and tests remain unchanged.
  if (!hasFrameworkDecision(fixture)) {
    if (!resolved) return null;
    return { market: resolved, score: scoreMarket(fixture, resolved, strategy) };
  }

  const priced = fixture.allMarkets ?? fixture.markets;
  const qualified = priced.filter(
    (market) => market.framework?.status === 'QUALIFIED'
  );
  if (qualified.length === 0) return null;

  if (resolved?.framework?.status === 'QUALIFIED') {
    return { market: resolved, score: scoreMarket(fixture, resolved, strategy) };
  }

  let best: { market: MarketOption; score: number } | null = null;
  for (const market of qualified) {
    const score = scoreMarket(fixture, market, strategy);
    if (!best || score > best.score) best = { market, score };
  }
  return best;
}

/**
 * Builds the candidate pool for a pre-match accumulator.
 *
 * Only genuinely upcoming fixtures are eligible. Live and finished matches
 * used to top up short tickets, which quietly turned a pre-match slip into a
 * bet on a game that had already started (and whose archived price was often
 * captured after kickoff). The builder now leaves the ticket short instead.
 */
function selectPools(fixtures: Fixture[], usedFixtureIds: Set<string>): Fixture[][] {
  const upcoming = fixtures.filter(
    (f) =>
      !usedFixtureIds.has(f.id) &&
      f.status === 'Scheduled' &&
      !f.awaitingResult &&
      f.markets.length > 0
  );

  return upcoming.length > 0 ? [upcoming] : [];
}

/**
 * "Most Likely" mode reads as a ranking, so the final slip is ordered from the
 * highest margin-adjusted probability to the lowest (stable for exact ties).
 */
function rankForDisplay(legs: AccaLeg[], strategy: AccaStrategy): AccaLeg[] {
  if (strategy !== 'probability') return legs;
  return [...legs].sort(
    (a, b) => (b.fairProbability ?? 0) - (a.fairProbability ?? 0)
  );
}

/**
 * Tops an accumulator up to `targetOdds` using the same ranking rules the
 * server uses for its curated ticket, so the recommended slip and the
 * auto-completed slip never disagree on quality.
 */
export function completeAccaToTargetOdds(
  fixtures: Fixture[],
  existingLegs: AccaLeg[],
  targetOdds: number,
  strategy: AccaStrategy,
  maxLegs = MAX_ACCA_LEGS
): AccaLeg[] {
  const legs: AccaLeg[] = [...existingLegs];
  const legCap = Math.min(
    Math.max(1, Math.round(maxLegs)),
    MAX_ACCA_LEGS
  );
  const usedFixtureIds = new Set(legs.map((leg) => leg.fixtureId));

  let currentProduct = legs.reduce((acc, leg) => acc * leg.odds, 1);
  if (legs.length > 0 && currentProduct >= targetOdds) {
    return rankForDisplay(legs, strategy);
  }

  const candidates = selectPools(fixtures, usedFixtureIds)
    .flatMap((pool) =>
      pool
        .map((fixture) => {
          const best = bestMarketFor(fixture, strategy);
          if (!best) return null;
          return {
            fixture,
            market: best.market,
            // Band the fit so league prestige breaks ties between similar picks
            // instead of letting a 0.01 odds difference override a bigger league.
            band: Math.round(best.score * 20),
            leagueRank: getLeaguePriority(fixture.competition, fixture.country),
          };
        })
        .filter(
          (candidate): candidate is NonNullable<typeof candidate> =>
            candidate !== null
        )
        .sort((a, b) => {
          if (b.band !== a.band) return b.band - a.band;
          if (a.leagueRank !== b.leagueRank) return a.leagueRank - b.leagueRank;
          return (
            (a.fixture.kickoffTimestamp ?? 0) -
            (b.fixture.kickoffTimestamp ?? 0)
          );
        })
    );

  for (const candidate of candidates) {
    if (legs.length >= legCap) break;
    if (legs.length > 0 && currentProduct >= targetOdds) break;

    legs.push(legFromMarket(candidate.fixture, candidate.market));
    usedFixtureIds.add(candidate.fixture.id);
    currentProduct *= candidate.market.odds;
  }

  // Deliberately no "upgrade unlocked legs" pass here. Swapping a
  // recommended 1.25 pick for a 3.00 longshot to reach a headline target is
  // how a high-probability slip became a negative-EV lottery ticket.
  return rankForDisplay(legs, strategy);
}

/** The curated slip shown on load: the engine run with no pre-existing legs. */
export function buildRecommendedAcca(
  fixtures: Fixture[],
  targetOdds: number,
  strategy: AccaStrategy,
  maxLegs = MAX_ACCA_LEGS
): AccaLeg[] {
  return completeAccaToTargetOdds(fixtures, [], targetOdds, strategy, maxLegs);
}
