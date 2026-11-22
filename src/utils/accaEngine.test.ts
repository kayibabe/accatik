import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecommendedAcca, completeAccaToTargetOdds } from './accaEngine.ts';
import { calculateTotalOdds } from './accaMath.ts';
import { withFairProbabilities } from './probability.ts';
import { makeFixture, makeLeg, makeMarket } from './testFactories.ts';
import type { Fixture, MarketOption } from '../types/fixtures.ts';

function frameworkSummary(
  status: NonNullable<Fixture['framework']>['status']
): NonNullable<Fixture['framework']> {
  return {
    version: '1.2',
    modelVersion: 'test-model',
    status,
    confidence: 'Medium',
    dataOk: true,
    flags: [],
    reasonCodes: [],
    model: null,
    summary: 'test summary',
    counts: {
      qualified: status === 'QUALIFIED' ? 1 : 0,
      review: 0,
      screenOnly: 0,
      rejected: status === 'REJECTED' ? 1 : 0,
      insufficient: 0,
    },
  };
}

function marketFramework(
  marketId: string,
  status: NonNullable<MarketOption['framework']>['status']
): NonNullable<MarketOption['framework']> {
  return {
    marketId,
    selectionKey: '1X2-H',
    status,
    reasonCodes: status === 'REJECTED' ? ['EDGE_BELOW_MIN'] : [],
    pModel: 0.5,
    pFair: 0.45,
    edge: 0.05,
    relativeEdge: 0.11,
    ev: 0.05,
    evStress: 0.01,
    pStress: 0.48,
    fairOdds: 2,
    confidence: 'Medium',
    confidenceDowngrades: [],
    flags: [],
    marketContext: null,
    oddsAgeSeconds: 0,
    marketComplete: true,
    benchmarkBook: 'Book A',
    executionBook: 'Book A',
    value: null,
  };
}

function pricedFixture(id: string, odds: number, overrides: Partial<Fixture> = {}) {
  return makeFixture({
    id,
    status: 'Scheduled',
    statusShort: 'NS',
    score: { home: null, away: null },
    markets: [makeMarket(`${id}-1x2-h`, odds, '1X2', `${id} Win`)],
    ...overrides,
  });
}

test('builds a ticket that reaches the target without repeating a fixture', () => {
  const fixtures = ['a', 'b', 'c', 'd', 'e'].map((id) => pricedFixture(id, 1.75));

  const legs = buildRecommendedAcca(fixtures, 5, 'balanced', 8);

  assert.ok(calculateTotalOdds(legs) >= 5, 'target odds reached');
  assert.equal(new Set(legs.map((leg) => leg.fixtureId)).size, legs.length);
});

test('stops at the three-leg cap when the target is unreachable', () => {
  const fixtures = Array.from({ length: 10 }, (_, index) =>
    pricedFixture(`f${index}`, 1.2)
  );

  const legs = buildRecommendedAcca(fixtures, 100, 'balanced', 4);

  assert.equal(legs.length, 3);
  assert.ok(calculateTotalOdds(legs) < 100);
});

test('skips void fixtures and fixtures without prices', () => {
  const voided = pricedFixture('void', 2, { status: 'Void', statusShort: 'PST' });
  const unpriced = makeFixture({ id: 'free', status: 'Scheduled', statusShort: 'NS', markets: [] });
  const playable = pricedFixture('play', 1.5);

  const legs = buildRecommendedAcca([voided, unpriced, playable], 1.4, 'balanced');

  assert.deepEqual(
    legs.map((leg) => leg.fixtureId),
    ['play']
  );
});

test('never tops up a pre-match ticket with live or finished fixtures', () => {
  const upcoming = ['u1', 'u2', 'u3'].map((id, index) =>
    pricedFixture(id, 1.5, { kickoffTimestamp: Date.UTC(2026, 10, 16, 16 + index) })
  );
  const finished = ['p1', 'p2'].map((id) =>
    makeFixture({
      id,
      status: 'Finished',
      statusShort: 'FT',
      score: { home: 1, away: 0 },
      markets: [makeMarket(`${id}-1x2-h`, 1.5, '1X2', `${id} Win`)],
    })
  );

  const legs = buildRecommendedAcca([...finished, ...upcoming], 5, 'balanced', 8);

  // 1.5^3 = 3.375, so the target stays unmet. The old builder would have
  // reached 5.00 by adding a match that had already kicked off.
  assert.deepEqual(
    legs.map((leg) => leg.fixtureId),
    ['u1', 'u2', 'u3']
  );
  assert.ok(calculateTotalOdds(legs) < 5);
});

test('the goals strategy prefers goal markets over match winners', () => {
  const fixture = makeFixture({
    id: 'g',
    status: 'Scheduled',
    statusShort: 'NS',
    score: { home: null, away: null },
    markets: [
      makeMarket('g-1x2-h', 1.6, '1X2', 'Home FC Win'),
      makeMarket('g-ou-25', 1.9, 'Goals', 'Over 2.5 Goals'),
    ],
  });

  const legs = buildRecommendedAcca([fixture], 1.5, 'goals');

  assert.equal(legs[0].marketType, 'Goals');
});

test('only framework-qualified markets are eligible for the recommended acca', () => {
  const fixture = makeFixture({
    id: 'fw',
    status: 'Scheduled',
    statusShort: 'NS',
    score: { home: null, away: null },
    markets: [
      {
        ...makeMarket('fw-1x2-h', 1.6, '1X2', 'Home FC Win'),
        framework: marketFramework('fw-1x2-h', 'REJECTED'),
      },
      {
        ...makeMarket('fw-ou-25', 1.9, 'Goals', 'Over 2.5 Goals'),
        framework: marketFramework('fw-ou-25', 'QUALIFIED'),
      },
    ],
    framework: frameworkSummary('QUALIFIED'),
  });

  const legs = buildRecommendedAcca([fixture], 1.4, 'balanced');

  assert.equal(legs.length, 1);
  assert.equal(legs[0].marketId, 'fw-ou-25');
  assert.equal(legs[0].framework?.status, 'QUALIFIED');
});

test('a fixture with no framework-qualified market contributes no leg', () => {
  const fixture = makeFixture({
    id: 'none',
    status: 'Scheduled',
    statusShort: 'NS',
    score: { home: null, away: null },
    markets: [
      {
        ...makeMarket('none-1x2-h', 1.6, '1X2', 'Home FC Win'),
        framework: marketFramework('none-1x2-h', 'REJECTED'),
      },
    ],
    framework: frameworkSummary('REJECTED'),
  });

  const legs = buildRecommendedAcca([fixture], 1.4, 'balanced');

  assert.deepEqual(legs, []);
});

test('an unreachable target never swaps a chosen market for a longer price', () => {
  const fixture = makeFixture({
    id: 'u',
    status: 'Scheduled',
    statusShort: 'NS',
    score: { home: null, away: null },
    markets: [
      makeMarket('u-1x2-h', 1.2, '1X2', 'Home FC Win'),
      makeMarket('u-ou-25', 2, 'Goals', 'Over 2.5 Goals'),
    ],
  });

  const locked = completeAccaToTargetOdds(
    [fixture],
    [makeLeg('u', 'u-1x2-h', 1.2, { locked: true })],
    5,
    'balanced'
  );
  assert.equal(locked[0].odds, 1.2);

  const unlocked = completeAccaToTargetOdds(
    [fixture],
    [makeLeg('u', 'u-1x2-h', 1.2)],
    5,
    'balanced'
  );
  assert.equal(unlocked[0].odds, 1.2);
  assert.equal(unlocked[0].marketId, 'u-1x2-h');
});

test('an existing ticket already past the target is returned untouched', () => {
  const legs = completeAccaToTargetOdds(
    [pricedFixture('a', 1.5)],
    [makeLeg('x', 'x-1x2-h', 2.6)],
    2.5,
    'balanced'
  );

  assert.equal(legs.length, 1);
  assert.equal(legs[0].odds, 2.6);
});

test('each leg carries the bookmaker that priced it', () => {
  const fixture = makeFixture({
    id: 'b',
    status: 'Scheduled',
    statusShort: 'NS',
    score: { home: null, away: null },
    markets: [makeMarket('b-1x2-h', 1.5, '1X2', 'Home FC Win', 'Bet365')],
    recommendedPickId: 'b-1x2-h',
  });

  const legs = buildRecommendedAcca([fixture], 1.4, 'balanced');

  assert.equal(legs[0].bookmaker, 'Bet365');
});

test('the curated slip and the builder share one algorithm', () => {
  const fixtures = ['a', 'b', 'c', 'd'].map((id, index) =>
    pricedFixture(id, 1.5, { kickoffTimestamp: Date.UTC(2026, 10, 16, 16 + index) })
  );

  assert.deepEqual(
    buildRecommendedAcca(fixtures, 5, 'balanced', 7),
    completeAccaToTargetOdds(fixtures, [], 5, 'balanced', 7)
  );
});

test('bigger leagues break ties between equally priced picks', () => {
  const fixtures = [
    pricedFixture('small', 1.5, { competition: 'National League', country: 'England' }),
    pricedFixture('big', 1.5, { competition: 'Premier League', country: 'England' }),
  ];

  const legs = buildRecommendedAcca(fixtures, 1.4, 'balanced');

  assert.equal(legs[0].fixtureId, 'big');
});

test('the probability strategy takes the most likely outcome on each fixture', () => {
  const fixtures = [
    makeFixture({
      id: 'p1',
      status: 'Scheduled',
      statusShort: 'NS',
      score: { home: null, away: null },
      markets: withFairProbabilities([
        makeMarket('p1-1x2-h', 2.2, '1X2', 'Home FC Win'),
        makeMarket('p1-ou-15', 1.24, 'Goals', 'Over 1.5 Goals'),
      ]),
      recommendedPickId: 'p1-1x2-h',
    }),
  ];

  const legs = buildRecommendedAcca(fixtures, 1.2, 'probability');

  assert.equal(legs[0].marketId, 'p1-ou-15');
  assert.ok((legs[0].fairProbability ?? 0) > 70);
});

test('the probability strategy orders legs from highest to lowest probability', () => {
  const fixtures = [
    makeFixture({
      id: 'fav',
      status: 'Scheduled',
      statusShort: 'NS',
      score: { home: null, away: null },
      markets: withFairProbabilities([
        makeMarket('fav-1x2-h', 1.4, '1X2', 'Fav Win'),
      ]),
      kickoffTimestamp: Date.UTC(2026, 10, 16, 18),
    }),
    makeFixture({
      id: 'outsider',
      status: 'Scheduled',
      statusShort: 'NS',
      score: { home: null, away: null },
      markets: withFairProbabilities([
        makeMarket('out-1x2-h', 2.4, '1X2', 'Out Win'),
      ]),
      kickoffTimestamp: Date.UTC(2026, 10, 16, 16),
    }),
  ];

  // Kickoff order puts the outsider first; probability must override it.
  const legs = buildRecommendedAcca(fixtures, 3, 'probability', 4);

  assert.deepEqual(
    legs.map((leg) => leg.fixtureId),
    ['fav', 'outsider']
  );
  const probabilities = legs.map((leg) => leg.fairProbability ?? 0);
  assert.deepEqual(probabilities, [...probabilities].sort((a, b) => b - a));
});

test('the most likely picks are kept even when the target is unreachable', () => {
  const make = (id: string, likelyOdds: number, likelyFair: number, longOdds: number, longFair: number) =>
    makeFixture({
      id,
      status: 'Scheduled',
      statusShort: 'NS',
      score: { home: null, away: null },
      markets: [
        {
          ...makeMarket(`${id}-1x2-h`, likelyOdds, '1X2', `${id} Win`),
          fairProbability: likelyFair,
        },
        {
          ...makeMarket(`${id}-ou-25`, longOdds, 'Goals', 'Over 2.5 Goals'),
          fairProbability: longFair,
        },
      ],
    });

  // Pick order is a, b, c. The target is unreachable inside five legs, and
  // the builder must leave it unmet rather than upgrading to 3.00 longshots.
  const fixtures = [
    make('a', 1.18, 80.9, 3.0, 33),
    make('b', 1.3, 73.5, 2.4, 40),
    make('c', 1.42, 67.3, 2.0, 47),
  ];

  const legs = buildRecommendedAcca(fixtures, 12, 'probability', 5);

  assert.deepEqual(
    legs.map((leg) => leg.fixtureId),
    ['a', 'b', 'c']
  );
  assert.deepEqual(
    legs.map((leg) => leg.odds),
    [1.18, 1.3, 1.42]
  );
  assert.ok(calculateTotalOdds(legs) < 12);
  const probabilities = legs.map((leg) => leg.fairProbability ?? 0);
  assert.deepEqual(probabilities, [...probabilities].sort((x, y) => y - x));
});

test('probability legs carry the de-vigged value through to the ticket', () => {
  const fixture = makeFixture({
    id: 'carry',
    status: 'Scheduled',
    statusShort: 'NS',
    score: { home: null, away: null },
    markets: withFairProbabilities([
      makeMarket('carry-ou-15', 1.25, 'Goals', 'Over 1.5 Goals'),
    ]),
  });

  const [leg] = buildRecommendedAcca([fixture], 1.1, 'probability');

  assert.equal(typeof leg.fairProbability, 'number');
  // Margin removed, so the fair figure sits below the raw 80% implied price.
  assert.ok((leg.fairProbability ?? 0) < leg.impliedProbability);
  assert.ok((leg.fairProbability ?? 0) > 70);
});
