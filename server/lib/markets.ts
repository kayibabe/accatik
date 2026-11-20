import type { Fixture, MarketOption, MarketType } from '../../src/types/fixtures.ts';
import type { RawApiFixture, RawApiOddsItem } from './apiFootball.ts';
import { formatKickoffCat, formatMatchDateCat } from './time.ts';
import { getLeaguePriority } from '../../src/utils/leaguePriority.ts';
import { estimateOverround, stripMargin } from '../../src/utils/probability.ts';
/**
 * Selections that have always been shown on the fixture board. Extra lines
 * captured from the feed (3.5/4.5 goals, unders, BTTS No, DC 12) are archived
 * for analytics but deliberately held back from the five-card board grid.
 */
const BOARD_MARKET_SUFFIXES = [
  '1x2-h',
  '1x2-a',
  'ou-15',
  'ou-25',
  'btts-yes',
  'dc-1x',
  'dc-x2',
  'dnb-h',
  'dnb-a',
];

const PREFERRED_BOOKMAKER_IDS = [
  8, // Bet365
  11, // 1xBet
  16, // Unibet
  4, // Pinnacle
  7, // William Hill
  3, // Betfair
  6, // Bwin
  2, // Marathonbet
  1,
];

/** Short codes that mean the match is over for betting purposes. */
const VOID_STATUS_CODES = ['PST', 'CANC', 'ABD', 'AWD', 'WO'];
/** Short codes that mean play has started (suspended/interrupted included: they usually resume). */
const LIVE_STATUS_CODES = ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'SUSP', 'INT'];
const FINISHED_STATUS_CODES = ['FT', 'AET', 'PEN'];

export function mapFixtureStatus(shortCode?: string): Fixture['status'] {
  const s = (shortCode || 'NS').toUpperCase();
  if (LIVE_STATUS_CODES.includes(s)) return 'Live';
  if (FINISHED_STATUS_CODES.includes(s)) return 'Finished';
  if (VOID_STATUS_CODES.includes(s)) return 'Void';
  return 'Scheduled';
}

export function isAwaitingFeedResult(
  status: Fixture['status'],
  kickoffTimestamp: number | undefined,
  nowMs: number
): boolean {
  if (status !== 'Scheduled' || !kickoffTimestamp) return false;
  return nowMs > kickoffTimestamp + 15 * 60 * 1000;
}

export function getRawFixtureSortTier(
  raw: RawApiFixture,
  hasOdds: boolean,
  nowMs: number
): number {
  const status = mapFixtureStatus(raw.fixture?.status?.short);
  const kickoffTs = raw.fixture?.timestamp ? raw.fixture.timestamp * 1000 : undefined;
  const awaitingResult = isAwaitingFeedResult(status, kickoffTs, nowMs);

  let statusTier: number;
  if (status === 'Scheduled' && !awaitingResult) {
    statusTier = 0; // Truly upcoming
  } else if (status === 'Live') {
    statusTier = 1; // Live in-play
  } else if (status === 'Finished') {
    statusTier = 2; // Finished with official score
  } else if (status === 'Void') {
    statusTier = 3; // Postponed / Cancelled / Void
  } else {
    statusTier = 4; // Past kickoff still marked NS with no live feed coverage
  }

  return (hasOdds ? 0 : 5) + statusTier;
}

/** Upcoming first, then live, then finished, then void, then stale NS; prestige and kickoff break ties. */
export function sortRawFixtures(
  rawFixtures: RawApiFixture[],
  pricedFixtureIds: Set<number>,
  nowMs: number
): RawApiFixture[] {
  return [...rawFixtures].sort((a, b) => {
    const aTier = getRawFixtureSortTier(a, pricedFixtureIds.has(a.fixture.id), nowMs);
    const bTier = getRawFixtureSortTier(b, pricedFixtureIds.has(b.fixture.id), nowMs);
    if (aTier !== bTier) return aTier - bTier;
    const prioDiff =
      getLeaguePriority(a.league.name, a.league.country) -
      getLeaguePriority(b.league.name, b.league.country);
    if (prioDiff !== 0) return prioDiff;
    return (a.fixture.timestamp || 0) - (b.fixture.timestamp || 0);
  });
}

export function buildMarketsFromOdds(
  fixtureId: string,
  homeTeam: string,
  awayTeam: string,
  oddsEntry?: RawApiOddsItem
): {
  markets: MarketOption[];
  allMarkets: MarketOption[];
  bookmakerName?: string;
} {
  if (!oddsEntry || !Array.isArray(oddsEntry.bookmakers) || oddsEntry.bookmakers.length === 0) {
    return { markets: [], allMarkets: [] };
  }

  // Pick preferred bookmaker that offers Match Winner or multiple bets
  const sortedBookmakers = [...oddsEntry.bookmakers].sort((a, b) => {
    const idxA = PREFERRED_BOOKMAKER_IDS.indexOf(a.id);
    const idxB = PREFERRED_BOOKMAKER_IDS.indexOf(b.id);
    const rankA = idxA === -1 ? 999 : idxA;
    const rankB = idxB === -1 ? 999 : idxB;
    if (rankA !== rankB) return rankA - rankB;
    return (b.bets?.length ?? 0) - (a.bets?.length ?? 0);
  });

  const markets: MarketOption[] = [];

  const pushMarket = (
    suffix: string,
    marketType: MarketType,
    label: string,
    oddStr: string | undefined,
    rationale: string,
    bookmaker: string | undefined
  ) => {
    const num = Number(oddStr);
    if (!Number.isFinite(num) || num < 1.05 || num > 35) return;
    const odds = Math.round(num * 100) / 100;
    markets.push({
      id: `${fixtureId}-${suffix}`,
      marketType,
      label,
      odds,
      impliedProbability: Math.round((1 / odds) * 1000) / 10,
      rationale,
      bookmaker,
    });
  };

  // Look across bookmakers if the primary is missing a specific bet type.
  // The bookmaker travels with the bet so each card shows where the price came from.
  const findBet = (betId: number, nameFragment: string) => {
    for (const bm of sortedBookmakers) {
      const bet = bm.bets?.find(
        (b) => b.id === betId || b.name.toLowerCase().includes(nameFragment)
      );
      if (bet) return { bet, bookmaker: bm.name };
    }
    return undefined;
  };

  const matchWinner = findBet(1, 'match winner');
  if (matchWinner) {
    const values = matchWinner.bet.values;
    pushMarket(
      '1x2-h',
      '1X2',
      `${homeTeam} Win`,
      values.find((v) => v.value === 'Home')?.odd,
      `Full-time match winner backing ${homeTeam} at home.`,
      matchWinner.bookmaker
    );
    pushMarket(
      '1x2-d',
      '1X2',
      'Draw',
      values.find((v) => v.value === 'Draw')?.odd,
      `Level stalemate after 90 minutes.`,
      matchWinner.bookmaker
    );
    pushMarket(
      '1x2-a',
      '1X2',
      `${awayTeam} Win`,
      values.find((v) => v.value === 'Away')?.odd,
      `Full-time match winner backing ${awayTeam} away.`,
      matchWinner.bookmaker
    );
  }

  const doubleChance = findBet(12, 'double chance');
  if (doubleChance) {
    pushMarket(
      'dc-1x',
      'Double Chance',
      '1X (Home or Draw)',
      doubleChance.bet.values.find(
        (v) => v.value === 'Home/Draw' || v.value === '1X'
      )?.odd,
      `Covers ${homeTeam} win or draw for lower slip variance.`,
      doubleChance.bookmaker
    );
    pushMarket(
      'dc-x2',
      'Double Chance',
      'X2 (Draw or Away)',
      doubleChance.bet.values.find(
        (v) => v.value === 'Draw/Away' || v.value === 'X2'
      )?.odd,
      `Covers ${awayTeam} win or draw.`,
      doubleChance.bookmaker
    );
    pushMarket(
      'dc-12',
      'Double Chance',
      '12 (Home or Away)',
      doubleChance.bet.values.find(
        (v) =>
          v.value === 'Home/Away' ||
          v.value === '12' ||
          v.value.toLowerCase() === 'home or away'
      )?.odd,
      `Either side to win; the draw loses.`,
      doubleChance.bookmaker
    );
  }

  const overUnder = findBet(5, 'goals over/under');
  if (overUnder) {
    // The feed publishes a full ladder of lines. Keep every one between 0.5
    // and 6.5 so the analytics table can compare Over/Under 1.5 through 4.5
    // instead of only the two overs the board used to show.
    const lines = new Map<string, { over?: string; under?: string }>();
    for (const value of overUnder.bet.values) {
      const match = /^\s*(over|under)\s+(\d+(?:\.\d+)?)\s*$/i.exec(value.value);
      if (!match) continue;
      const line = Number(match[2]);
      if (!Number.isFinite(line) || line < 0.5 || line > 6.5) continue;
      const entry = lines.get(match[2]) ?? {};
      if (match[1].toLowerCase() === 'over') entry.over = value.odd;
      else entry.under = value.odd;
      lines.set(match[2], entry);
    }

    for (const [line, prices] of [...lines.entries()].sort(
      (a, b) => Number(a[0]) - Number(b[0])
    )) {
      const compact = line.replace('.', '');
      if (prices.over) {
        pushMarket(
          `ou-${compact}`,
          'Goals',
          `Over ${line} Goals`,
          prices.over,
          `At least ${Number(line) + 0.5} total match goals scored.`,
          overUnder.bookmaker
        );
      }
      if (prices.under) {
        pushMarket(
          `ou-u${compact}`,
          'Goals',
          `Under ${line} Goals`,
          prices.under,
          `${Number(line) - 0.5} or fewer total match goals.`,
          overUnder.bookmaker
        );
      }
    }
  }

  const btts = findBet(8, 'both teams score');
  if (btts) {
    pushMarket(
      'btts-yes',
      'BTTS',
      'BTTS Yes',
      btts.bet.values.find((v) => v.value === 'Yes')?.odd,
      `Both ${homeTeam} and ${awayTeam} to find the net.`,
      btts.bookmaker
    );
    pushMarket(
      'btts-no',
      'BTTS',
      'BTTS No',
      btts.bet.values.find((v) => v.value.toLowerCase() === 'no')?.odd,
      `At least one of ${homeTeam} or ${awayTeam} to fail to score.`,
      btts.bookmaker
    );
  }

  const dnb = findBet(13, 'draw no bet');
  if (dnb) {
    pushMarket(
      'dnb-h',
      'Draw No Bet',
      `${homeTeam} DNB`,
      dnb.bet.values.find((v) => v.value === 'Home')?.odd,
      `${homeTeam} win with stake voided on a draw.`,
      dnb.bookmaker
    );
    pushMarket(
      'dnb-a',
      'Draw No Bet',
      `${awayTeam} DNB`,
      dnb.bet.values.find((v) => v.value === 'Away')?.odd,
      `${awayTeam} win with stake voided on a draw.`,
      dnb.bookmaker
    );
  }

  // Keep up to 5 crisp, highest-utility markets for a clean UI grid
  const priorityOrder = (m: MarketOption): number => {
    if (m.id.endsWith('1x2-h') || m.id.endsWith('1x2-a')) return 1;
    if (m.id.endsWith('ou-15')) return 2;
    if (m.id.endsWith('ou-25')) return 3;
    if (m.id.endsWith('btts-yes')) return 4;
    if (m.id.endsWith('dc-1x') || m.id.endsWith('dc-x2')) return 5;
    if (m.id.endsWith('dnb-h') || m.id.endsWith('dnb-a')) return 6;
    return 7;
  };

  markets.sort((a, b) => priorityOrder(a) - priorityOrder(b));
  // Estimate the margin from the whole priced book (the 1X2 draw included),
  // then de-vig every priced selection, not just the board shortlist.
  const allMarkets = stripMargin(markets, estimateOverround(markets));
  const boardMarkets = allMarkets
    .filter((m) =>
      BOARD_MARKET_SUFFIXES.some((suffix) => m.id.endsWith(suffix))
    )
    .slice(0, 5);

  return {
    markets: boardMarkets,
    allMarkets,
    // Attribute the fixture to the book that priced its headline pick.
    bookmakerName:
      boardMarkets.find((m) => m.id === chooseRecommendedMarket(boardMarkets))
        ?.bookmaker ?? sortedBookmakers[0]?.name,
  };
}

export function chooseRecommendedMarket(markets: MarketOption[]): string {
  if (markets.length === 0) return '';
  // Prefer the accumulator sweet spot (1.30 - 1.95)
  const sweetSpot = markets.find((m) => m.odds >= 1.3 && m.odds <= 1.95);
  if (sweetSpot) return sweetSpot.id;
  const reasonable = markets.find((m) => m.odds >= 1.18 && m.odds <= 2.35);
  return reasonable?.id ?? markets[0].id;
}

export function toFixture(
  raw: RawApiFixture,
  oddsEntry: RawApiOddsItem | undefined,
  requestedDate: string,
  nowMs: number
): Fixture {
  const fixtureId = String(raw.fixture.id);
  const homeTeam = raw.teams.home.name;
  const awayTeam = raw.teams.away.name;
  const { markets, allMarkets, bookmakerName } = buildMarketsFromOdds(
    fixtureId,
    homeTeam,
    awayTeam,
    oddsEntry
  );
  const recommendedPickId = chooseRecommendedMarket(markets);
  const status = mapFixtureStatus(raw.fixture?.status?.short);
  const kickoffTimestamp = raw.fixture?.timestamp
    ? raw.fixture.timestamp * 1000
    : undefined;
  const awaitingResult = isAwaitingFeedResult(status, kickoffTimestamp, nowMs);
  const kickoffTime = formatKickoffCat(raw.fixture.date);
  const venueParts = [raw.fixture.venue?.name, raw.fixture.venue?.city].filter(
    Boolean
  );
  const { matchDate, matchDateIso } = formatMatchDateCat(
    raw.fixture.date,
    requestedDate
  );
  const homeScore =
    status === 'Finished'
      ? raw.score?.fulltime?.home ?? raw.goals?.home ?? null
      : raw.goals?.home ?? null;
  const awayScore =
    status === 'Finished'
      ? raw.score?.fulltime?.away ?? raw.goals?.away ?? null
      : raw.goals?.away ?? null;
  const roundPrefix = raw.league.round ? `${raw.league.round} · ` : '';
  const priceQuality: Fixture['priceQuality'] =
    markets.length === 0
      ? 'unknown'
      : status === 'Void'
        ? 'unknown'
        : status === 'Scheduled' && !awaitingResult
          ? 'prematch'
          : 'live';

  let tacticalSummary: string;
  if (awaitingResult) {
    tacticalSummary =
      markets.length > 0
        ? `${roundPrefix}Kickoff passed (${kickoffTime}) — official final score has not yet been reported by the API-Football feed for this fixture. Live ${bookmakerName || 'bookmaker'} markets are listed below.`
        : `${roundPrefix}Kickoff passed (${kickoffTime}) — official score has not yet been published by the API-Football feed for this fixture.`;
  } else if (status === 'Finished' && homeScore !== null && awayScore !== null) {
    tacticalSummary =
      markets.length > 0
        ? `${roundPrefix}Full-time score ${homeScore}-${awayScore} recorded. Each market button below shows its Win, Lost, or Void settlement outcome.`
        : `${roundPrefix}Full-time score ${homeScore}-${awayScore} recorded on API-Football.`;
  } else if (status === 'Live' && homeScore !== null && awayScore !== null) {
    tacticalSummary =
      markets.length > 0
        ? `${roundPrefix}Live in play (${raw.fixture?.status?.short || 'LIVE'} ${homeScore}-${awayScore}). ${bookmakerName || 'Bookmaker'} pre-match lines shown below.`
        : `${roundPrefix}Live in play (${raw.fixture?.status?.short || 'LIVE'} ${homeScore}-${awayScore}).`;
  } else if (status === 'Live') {
    tacticalSummary = `${roundPrefix}Live in play (${
      raw.fixture?.status?.short || 'LIVE'
    }) — scoreline not yet published by the feed.`;
  } else {
    tacticalSummary =
      markets.length > 0
        ? `${roundPrefix}Live ${bookmakerName || 'bookmaker'} markets loaded. Open Tactical Brief for API-Football predictions, H2H, and team news.`
        : `${roundPrefix}Scheduled on this matchday list. Open Tactical Brief to inspect predictions or live team news.`;
  }

  return {
    id: fixtureId,
    homeTeam,
    awayTeam,
    competition: raw.league.name,
    country: raw.league.country,
    matchDate,
    matchDateIso,
    kickoffTime,
    kickoffTimestamp,
    awaitingResult,
    status,
    statusShort: raw.fixture?.status?.short || 'NS',
    statusLong: raw.fixture?.status?.long || undefined,
    score: {
      home: homeScore,
      away: awayScore,
      halftimeHome: raw.score?.halftime?.home ?? null,
      halftimeAway: raw.score?.halftime?.away ?? null,
    },
    venue: venueParts.join(', ') || raw.league.country,
    formHome: '—',
    formAway: '—',
    tacticalSummary,
    recommendedPickId,
    bookmakerName,
    hasLiveOdds: markets.length > 0,
    markets,
    allMarkets,
    priceQuality,
  };
}
