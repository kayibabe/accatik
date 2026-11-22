import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SLATE_FILTERS,
  bestModelEdge,
  boardMarketPool,
  countAngleBands,
  countMarketSelections,
  countMarketTypes,
  countModelEdges,
  filterSlate,
  hasMarketFilters,
  MARKET_FILTERS,
  matchingMarkets,
  matchesSlateFilters,
  parseOddsInput,
  qualifyingMarket,
} from './slateFilters.ts';
import type { SlateFilters } from './slateFilters.ts';
import { buildRecommendedAngle } from './recommendedAngle.ts';
import { withFairProbabilities } from './probability.ts';
import { makeFixture, makeMarket } from './testFactories.ts';

const filters = (overrides: Partial<SlateFilters> = {}): SlateFilters => ({
  ...DEFAULT_SLATE_FILTERS,
  ...overrides,
});

/** Angle resolver used by `filterSlate`, mirroring the board. */
const angleFor = (fixture: ReturnType<typeof makeFixture>) =>
  buildRecommendedAngle(fixture, 'balanced');

/** A fixture whose recommended pick is a priced 1X2 home win. */
const homePickFixture = (id: string, odds = 1.4) =>
  makeFixture({
    id,
    markets: withFairProbabilities([
      makeMarket(`${id}-1x2-h`, odds, '1X2', 'Home Win'),
      makeMarket(`${id}-1x2-d`, 6.0, '1X2', 'Draw'),
      makeMarket(`${id}-1x2-a`, 12.0, '1X2', 'Away Win'),
    ]),
    recommendedPickId: `${id}-1x2-h`,
  });

test('default filters keep every fixture, priced or not', () => {
  const priced = homePickFixture('a');
  const unpriced = makeFixture({ id: 'b', markets: [] });

  assert.deepEqual(
    filterSlate([priced, unpriced], DEFAULT_SLATE_FILTERS, angleFor).map(
      (fixture) => fixture.id
    ),
    ['a', 'b']
  );
});

test('the qualifying market is the best price of the chosen type', () => {
  const fixture = makeFixture({
    id: 'f',
    markets: [
      makeMarket('f-1x2-h', 2.5, '1X2', 'Home Win'),
      makeMarket('f-ou-15', 1.2, 'Goals', 'Over 1.5 Goals'),
      makeMarket('f-btts-y', 1.9, 'BTTS', 'BTTS Yes'),
    ],
  });

  assert.equal(qualifyingMarket(fixture, 'all')?.id, 'f-ou-15');
  assert.equal(qualifyingMarket(fixture, '1X2')?.id, 'f-1x2-h');
  assert.equal(qualifyingMarket(fixture, 'Goals')?.id, 'f-ou-15');
  assert.equal(qualifyingMarket(fixture, 'Draw No Bet'), null);
});

test('the angle filter follows the fixture confidence band', () => {
  const strong = homePickFixture('strong', 1.2);
  const longShot = homePickFixture('long', 3.2);

  const high = filterSlate(
    [strong, longShot],
    filters({ angle: 'High' }),
    angleFor
  );
  assert.deepEqual(
    high.map((fixture) => fixture.id),
    ['strong']
  );

  const speculative = filterSlate(
    [strong, longShot],
    filters({ angle: 'Speculative' }),
    angleFor
  );
  assert.deepEqual(
    speculative.map((fixture) => fixture.id),
    ['long']
  );
});

test('a market type filter requires a priced outcome of that type', () => {
  const goalsOnly = makeFixture({
    id: 'goals',
    markets: [makeMarket('goals-ou-15', 1.3, 'Goals', 'Over 1.5 Goals')],
  });
  const homeOnly = homePickFixture('home');

  const result = filterSlate(
    [goalsOnly, homeOnly],
    filters({ marketType: '1X2' }),
    angleFor
  );
  assert.deepEqual(
    result.map((fixture) => fixture.id),
    ['home']
  );

  // An unpriced fixture never satisfies a specific type.
  assert.equal(
    matchesSlateFilters(
      makeFixture({ id: 'empty', markets: [] }),
      filters({ marketType: 'Goals' }),
      null
    ),
    false
  );
});

test('the probability floor reads the best price of the selected type', () => {
  const fixture = makeFixture({
    id: 'f',
    markets: withFairProbabilities([
      makeMarket('f-1x2-h', 2.0, '1X2', 'Home Win'),
      makeMarket('f-ou-15', 1.2, 'Goals', 'Over 1.5 Goals'),
    ]),
  });

  // Over 1.5 Goals is ~80% fair, so a 70% floor passes on Goals...
  assert.equal(
    matchesSlateFilters(
      fixture,
      filters({ marketType: 'Goals', minProbability: 70 }),
      null
    ),
    true
  );

  // ...while the 1X2 side sits near 50%, so the same floor rejects it.
  assert.equal(
    matchesSlateFilters(
      fixture,
      filters({ marketType: '1X2', minProbability: 70 }),
      null
    ),
    false
  );
});

test('the price band applies to the same qualifying market', () => {
  const fixture = makeFixture({
    id: 'f',
    markets: [
      makeMarket('f-1x2-h', 2.4, '1X2', 'Home Win'),
      makeMarket('f-ou-15', 1.2, 'Goals', 'Over 1.5 Goals'),
    ],
  });

  // Best price overall is 1.20, so a 2.00 floor rejects the fixture.
  assert.equal(
    matchesSlateFilters(fixture, filters({ minOdds: 2 }), null),
    false
  );

  // Narrowed to 1X2, the 2.40 price clears the floor and the 2.60 cap.
  assert.equal(
    matchesSlateFilters(
      fixture,
      filters({ marketType: '1X2', minOdds: 2, maxOdds: 2.6 }),
      null
    ),
    true
  );

  assert.equal(
    matchesSlateFilters(
      fixture,
      filters({ marketType: '1X2', minOdds: 2.5 }),
      null
    ),
    false
  );
});

test('filters combine and unpriced fixtures drop out with a price floor', () => {
  const solid = homePickFixture('solid', 1.65);
  const unpriced = makeFixture({ id: 'unpriced', markets: [] });

  const kept = filterSlate(
    [solid, unpriced],
    filters({ marketType: '1X2', minProbability: 50, minOdds: 1.2 }),
    angleFor
  );

  assert.deepEqual(
    kept.map((fixture) => fixture.id),
    ['solid']
  );
});

test('facet counts use fixtures, not individual markets', () => {
  const fixture = makeFixture({
    id: 'f',
    markets: [
      makeMarket('f-1x2-h', 1.5, '1X2', 'Home Win'),
      makeMarket('f-1x2-d', 4.0, '1X2', 'Draw'),
      makeMarket('f-1x2-a', 6.0, '1X2', 'Away Win'),
      makeMarket('f-ou-25', 1.9, 'Goals', 'Over 2.5 Goals'),
    ],
  });
  const unpriced = makeFixture({
    id: 'u',
    markets: [makeMarket('u-1x2-h', 1)],
  });

  const counts = countMarketTypes([fixture, unpriced]);
  assert.equal(counts['1X2'], 1);
  assert.equal(counts.Goals, 1);
  assert.equal(counts.BTTS, 0);
});

test('angle facet counts match the bands the filter uses', () => {
  const strong = homePickFixture('strong', 1.2);
  const longShot = homePickFixture('long', 3.2);
  const counts = countAngleBands([strong, longShot], angleFor);

  assert.equal(counts.High, 1);
  assert.equal(counts.Speculative, 1);
  assert.equal(counts.Solid, 0);
});

test('typed prices parse defensively', () => {
  assert.equal(parseOddsInput(''), 0);
  assert.equal(parseOddsInput('  '), 0);
  assert.equal(parseOddsInput('1'), 0);
  assert.equal(parseOddsInput('abc'), 0);
  assert.equal(parseOddsInput('1,85'), 1.85);
  assert.equal(parseOddsInput('2.10'), 2.1);
});

/** 1X2 fixture with a controlled de-vigged book and model percentages. */
const edgedFixture = (
  id: string,
  book: { home: number; draw: number; away: number },
  model: { home: number | null; draw: number | null; away: number | null }
) =>
  makeFixture({
    id,
    markets: [
      {
        ...makeMarket(`${id}-1x2-h`, 2.5, '1X2', 'Home Win'),
        fairProbability: book.home,
      },
      {
        ...makeMarket(`${id}-1x2-d`, 3.4, '1X2', 'Draw'),
        fairProbability: book.draw,
      },
      {
        ...makeMarket(`${id}-1x2-a`, 3.6, '1X2', 'Away Win'),
        fairProbability: book.away,
      },
    ],
    modelProbabilities: model,
  });

test('the model edge is the largest model-over-book gap on 1X2', () => {
  const fixture = edgedFixture(
    'edge',
    { home: 45, draw: 30, away: 25 },
    { home: 50, draw: 30, away: 25 }
  );

  assert.deepEqual(bestModelEdge(fixture), { side: 'Home', points: 5 });

  const awayEdge = edgedFixture(
    'away',
    { home: 45, draw: 30, away: 25 },
    { home: 40, draw: 28, away: 40 }
  );
  assert.deepEqual(bestModelEdge(awayEdge), { side: 'Away', points: 15 });
});

test('no model or no comparable price means no model edge', () => {
  const noModel = makeFixture({
    id: 'no-model',
    markets: [makeMarket('no-model-1x2-h', 2.5)],
  });
  assert.equal(bestModelEdge(noModel), null);

  const noPrice = makeFixture({
    id: 'no-price',
    markets: [],
    modelProbabilities: { home: 60, draw: 25, away: 15 },
  });
  assert.equal(bestModelEdge(noPrice), null);
});

test('the model-edge filter uses the best side', () => {
  const fixture = edgedFixture(
    'edge',
    { home: 45, draw: 30, away: 25 },
    { home: 50, draw: 31, away: 24 }
  );

  assert.equal(
    matchesSlateFilters(fixture, filters({ minModelEdge: 5 }), null),
    true
  );
  assert.equal(
    matchesSlateFilters(fixture, filters({ minModelEdge: 6 }), null),
    false
  );
  // A fixture without a model can never clear a positive edge filter.
  assert.equal(
    matchesSlateFilters(
      makeFixture({ id: 'plain', markets: [makeMarket('plain-1x2-h', 2.5)] }),
      filters({ minModelEdge: 3 }),
      null
    ),
    false
  );
});

test('model-edge facet counts stack thresholds', () => {
  const five = edgedFixture(
    'five',
    { home: 45, draw: 30, away: 25 },
    { home: 50, draw: 30, away: 25 }
  );
  const twelve = edgedFixture(
    'twelve',
    { home: 45, draw: 30, away: 25 },
    { home: 57, draw: 30, away: 25 }
  );

  const counts = countModelEdges([five, twelve]);
  assert.equal(counts[3], 2);
  assert.equal(counts[5], 2);
  assert.equal(counts[10], 1);
});

test('the kickoff window only keeps matches about to start', () => {
  const now = Date.UTC(2026, 10, 18, 12, 0, 0);
  const minutes = (value: number) => value * 60 * 1000;

  const soon = makeFixture({
    id: 'soon',
    kickoffTimestamp: now + minutes(90),
  });
  const later = makeFixture({
    id: 'later',
    kickoffTimestamp: now + minutes(180),
  });
  const past = makeFixture({
    id: 'past',
    kickoffTimestamp: now - minutes(30),
  });
  const unknown = makeFixture({ id: 'unknown', kickoffTimestamp: undefined });

  const twoHours = filterSlate(
    [soon, later, past, unknown],
    filters({ kickoffWindowHours: 2 }),
    angleFor,
    now
  );
  assert.deepEqual(
    twoHours.map((fixture) => fixture.id),
    ['soon']
  );

  const sixHours = filterSlate(
    [soon, later, past, unknown],
    filters({ kickoffWindowHours: 6 }),
    angleFor,
    now
  );
  assert.deepEqual(
    sixHours.map((fixture) => fixture.id),
    ['soon', 'later']
  );
});

test('a kickoff window keeps an unpriced fixture that has not started', () => {
  const now = Date.UTC(2026, 10, 18, 12, 0, 0);
  const unpricedSoon = makeFixture({
    id: 'unpriced-soon',
    markets: [],
    kickoffTimestamp: now + 30 * 60 * 1000,
  });

  assert.equal(
    matchesSlateFilters(
      unpricedSoon,
      filters({ kickoffWindowHours: 2 }),
      null,
      now
    ),
    true
  );
});

test('with no market chips every published outcome stays on the card', () => {
  const fixture = makeFixture({
    id: 'f',
    markets: [
      makeMarket('f-1x2-h', 1.33, '1X2', 'Home Win'),
      makeMarket('f-btts-y', 1.62, 'BTTS', 'BTTS Yes'),
      makeMarket('f-1x2-a', 6.5, '1X2', 'Away Win'),
    ],
  });

  assert.equal(hasMarketFilters(filters()), false);
  assert.deepEqual(
    matchingMarkets(fixture, filters()).map((market) => market.id),
    ['f-1x2-h', 'f-btts-y', 'f-1x2-a']
  );
});

test('the probability floor narrows the tiles, not just the matches', () => {
  const fixture = makeFixture({
    id: 'f',
    markets: [
      makeMarket('f-1x2-h', 1.33, '1X2', 'Home Win'),
      makeMarket('f-btts-y', 1.62, 'BTTS', 'BTTS Yes'),
      makeMarket('f-1x2-a', 6.5, '1X2', 'Away Win'),
    ],
  });

  assert.equal(hasMarketFilters(filters({ minProbability: 70 })), true);
  assert.deepEqual(
    matchingMarkets(fixture, filters({ minProbability: 70 })).map(
      (market) => market.id
    ),
    ['f-1x2-h']
  );
});

test('tile filters stack type, probability and price band', () => {
  const fixture = makeFixture({
    id: 'f',
    markets: [
      makeMarket('f-1x2-h', 1.33, '1X2', 'Home Win'),
      makeMarket('f-1x2-a', 6.5, '1X2', 'Away Win'),
      makeMarket('f-btts-y', 1.62, 'BTTS', 'BTTS Yes'),
      makeMarket('f-ou-15', 1.2, 'Goals', 'Over 1.5 Goals'),
    ],
  });

  assert.deepEqual(
    matchingMarkets(
      fixture,
      filters({ marketType: '1X2', minOdds: 1.5, maxOdds: 7 })
    ).map((market) => market.id),
    ['f-1x2-a']
  );
});

test('an unpriced tile never survives a market chip', () => {
  const fixture = makeFixture({
    id: 'f',
    markets: [
      { ...makeMarket('f-1x2-h', 1), fairProbability: 90 },
      makeMarket('f-ou-15', 1.2, 'Goals', 'Over 1.5 Goals'),
    ],
  });

  assert.deepEqual(
    matchingMarkets(fixture, filters({ marketType: '1X2' })),
    []
  );
});

/** Board shortlist hides unders; the full captured ladder keeps them. */
const ladderFixture = () =>
  makeFixture({
    id: 'f',
    recommendedPickId: 'f-1x2-h',
    markets: [makeMarket('f-1x2-h', 1.4, '1X2', 'Home Win')],
    allMarkets: [
      makeMarket('f-1x2-h', 1.4, '1X2', 'Home Win'),
      makeMarket('f-ou-u25', 1.6, 'Goals', 'Under 2.5 Goals'),
      makeMarket('f-ou-u55', 1.05, 'Goals', 'Under 5.5 Goals'),
    ],
  });

test('selection filters reach the held-back under-goals lines', () => {
  const fixture = ladderFixture();
  const under25 = filters({ marketSelections: ['GOALS-U2.5'] });

  assert.deepEqual(
    matchingMarkets(fixture, under25).map((market) => market.id),
    ['f-ou-u25']
  );
  assert.equal(qualifyingMarket(fixture, 'all', ['GOALS-U2.5'])?.id, 'f-ou-u25');
  assert.equal(countMarketSelections([fixture])['GOALS-U2.5'], 1);
  assert.equal(matchesSlateFilters(fixture, under25, null), true);
  assert.equal(
    matchesSlateFilters(
      fixture,
      filters({ marketSelections: ['GOALS-U3.5'] }),
      null
    ),
    false
  );
});

test('market chips are the exact outcome-level drill-down, in order', () => {
  assert.deepEqual(
    MARKET_FILTERS.map((selection) => selection.label),
    [
      'Home Win',
      'Away Win',
      'Over 1.5 Goals',
      'Over 2.5 Goals',
      'Over 3.5 Goals',
      'Over 4.5 Goals',
      'Under 1.5 Goals',
      'Under 2.5 Goals',
      'Under 3.5 Goals',
      'Under 4.5 Goals',
      'BTTS Yes',
      'BTTS No',
      '1X (Home or Draw)',
      'X (Draw)',
      '12 (Home or Away)',
      'X2 (Draw or Away)',
      '1 (DNB)',
      '2 (DNB)',
    ]
  );
  assert.equal(new Set(MARKET_FILTERS.map((s) => s.key)).size, 18);
});

test('the angle follows the selected markets, including unders', () => {
  const fixture = ladderFixture();
  const pool = boardMarketPool(
    fixture,
    filters({ marketSelections: ['GOALS-U2.5'] })
  );

  assert.deepEqual(pool.map((market) => market.id), ['f-ou-u25']);
  assert.equal(
    buildRecommendedAngle(fixture, 'balanced', pool)?.market.id,
    'f-ou-u25'
  );
});
