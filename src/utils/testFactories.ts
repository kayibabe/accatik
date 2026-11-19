import type {
  AccaLeg,
  Fixture,
  MarketOption,
  MarketType,
  SavedTicket,
} from '../types/fixtures.ts';

/** Test-only builders. Not imported by the app bundle. */

export function makeFixture(overrides: Partial<Fixture> & { id: string }): Fixture {
  const base: Fixture = {
    id: overrides.id,
    homeTeam: 'Home FC',
    awayTeam: 'Away FC',
    competition: 'Premier League',
    country: 'England',
    matchDate: '16 Nov 2026',
    matchDateIso: '2026-11-16',
    kickoffTime: '18:00 CAT',
    kickoffTimestamp: Date.UTC(2026, 10, 16, 16, 0),
    awaitingResult: false,
    status: 'Finished',
    statusShort: 'FT',
    score: { home: 2, away: 1, halftimeHome: 1, halftimeAway: 0 },
    venue: 'Test Ground',
    formHome: 'W-W-D-W-W',
    formAway: 'L-W-L-D-W',
    tacticalSummary: '',
    recommendedPickId: '',
    hasLiveOdds: true,
    markets: [],
  };

  // Partial score overrides intentionally keep the base value for omitted halves.
  const score = {
    ...base.score,
    ...(overrides.score ?? {}),
  } as Fixture['score'];

  return {
    ...base,
    ...overrides,
    score,
  };
}

export function makeTicket(
  overrides: Partial<SavedTicket> & { id: string }
): SavedTicket {
  const base: SavedTicket = {
    id: overrides.id,
    name: 'Test Slip',
    createdAt: '2026-11-18T08:00:00.000Z',
    date: '18 Nov 2026',
    dateIso: '2026-11-18',
    stake: 1000,
    totalOdds: 2,
    legs: [],
  };

  return { ...base, ...overrides };
}

export function makeMarket(
  id: string,
  odds: number,
  marketType: MarketType = '1X2',
  label: string = id,
  bookmaker?: string
): MarketOption {
  return {
    id,
    marketType,
    label,
    odds,
    impliedProbability: Math.round((1 / odds) * 1000) / 10,
    rationale: `${label} rationale`,
    bookmaker,
  };
}

export function makeLeg(
  fixtureId: string,
  marketId: string,
  odds: number,
  overrides: Partial<AccaLeg> = {}
): AccaLeg {
  return {
    fixtureId,
    homeTeam: 'Home FC',
    awayTeam: 'Away FC',
    competition: 'Premier League',
    matchDate: '16 Nov 2026',
    kickoffTime: '18:00 CAT',
    marketId,
    marketLabel: marketId,
    marketType: '1X2',
    odds,
    impliedProbability: Math.round((1 / odds) * 1000) / 10,
    rationale: 'test rationale',
    locked: false,
    ...overrides,
  };
}
