import test from 'node:test';
import assert from 'node:assert/strict';
import {
  combinedFairProbability,
  estimateOverround,
  mostLikelyMarket,
  sortFixturesByProbability,
  sortMarketsByProbability,
  withFairProbabilities,
} from './probability.ts';
import { makeFixture, makeLeg, makeMarket } from './testFactories.ts';

test('strips the bookmaker margin using the 1X2 trio', () => {
  const markets = [
    makeMarket('f-1x2-h', 2.0),
    makeMarket('f-1x2-d', 3.5),
    makeMarket('f-1x2-a', 4.0),
  ];

  assert.ok(Math.abs(estimateOverround(markets) - 1.0357) < 0.001);

  const priced = withFairProbabilities(markets);
  assert.ok(Math.abs((priced[0].fairProbability ?? 0) - 48.3) < 0.2);

  // The de-vigged trio has to add back up to 100%.
  const total = priced.reduce(
    (sum, market) => sum + (market.fairProbability ?? 0),
    0
  );
  assert.ok(Math.abs(total - 100) < 0.5);
});

test('double chance is never used to estimate the margin', () => {
  const markets = [
    makeMarket('f-dc-1x', 1.2, 'Double Chance', '1X (Home or Draw)'),
    makeMarket('f-dc-x2', 1.25, 'Double Chance', 'X2 (Draw or Away)'),
  ];

  // 1X and X2 both win on a draw, so their implied total cannot reveal margin.
  assert.equal(estimateOverround(markets), 1.06);
});

test('a single priced outcome falls back to a typical margin', () => {
  const markets = [makeMarket('f-ou-15', 1.25, 'Goals', 'Over 1.5 Goals')];

  assert.equal(estimateOverround(markets), 1.06);
  const [priced] = withFairProbabilities(markets);
  assert.ok(Math.abs((priced.fairProbability ?? 0) - 75.5) < 0.2);
});

test('probability never collapses to zero or certainty', () => {
  const priced = withFairProbabilities([
    makeMarket('a-1x2-h', 1.01),
    makeMarket('a-1x2-d', 1.01),
    makeMarket('a-1x2-a', 1.01),
  ]);

  for (const market of priced) {
    assert.ok((market.fairProbability ?? 0) >= 1);
    assert.ok((market.fairProbability ?? 0) <= 99);
  }
});

test('the most likely market is the highest margin-adjusted probability', () => {
  const fixture = makeFixture({
    id: 'ml',
    markets: withFairProbabilities([
      makeMarket('ml-1x2-h', 1.55, '1X2', 'Home FC Win'),
      makeMarket('ml-ou-15', 1.22, 'Goals', 'Over 1.5 Goals'),
      makeMarket('ml-btts-yes', 1.8, 'BTTS', 'BTTS Yes'),
    ]),
  });

  assert.equal(mostLikelyMarket(fixture)?.id, 'ml-ou-15');
});

test('fixtures rank by their best pick, unpriced fixtures last', () => {  const short = makeFixture({
    id: 'short',
    markets: [makeMarket('short-ou-15', 1.2, 'Goals')],
  });
  const long = makeFixture({
    id: 'long',
    markets: [makeMarket('long-1x2-a', 3.4)],
  });
  const unpriced = makeFixture({ id: 'unpriced', markets: [] });

  const sorted = sortFixturesByProbability([unpriced, long, short]);
  assert.deepEqual(
    sorted.map((fixture) => fixture.id),
    ['short', 'long', 'unpriced']
  );
});

test('combined fair probability multiplies the legs', () => {
  const legs = [
    makeLeg('a', 'a-1x2-h', 1.5, { fairProbability: 60 }),
    makeLeg('b', 'b-1x2-h', 2, { fairProbability: 50 }),
  ];

  assert.equal(combinedFairProbability(legs), 30);
  assert.equal(combinedFairProbability([]), null);
});

test('combined fair probability falls back to implied for older legs', () => {
  const legacyLegs = [
    makeLeg('a', 'a-1x2-h', 2, { impliedProbability: 50 }),
  ];

  assert.equal(combinedFairProbability(legacyLegs), 50);
});

test('markets rank highest probability first within a fixture', () => {
  const markets = withFairProbabilities([
    makeMarket('r-1x2-h', 1.9, '1X2', 'Home Win'),
    makeMarket('r-ou-15', 1.25, 'Goals', 'Over 1.5 Goals'),
    makeMarket('r-btts-yes', 2.4, 'BTTS', 'BTTS Yes'),
    makeMarket('r-dc-1x', 1.15, 'Double Chance', '1X (Home or Draw)'),
  ]);

  const ranked = sortMarketsByProbability(markets);

  assert.deepEqual(
    ranked.map((market) => market.id),
    ['r-dc-1x', 'r-ou-15', 'r-1x2-h', 'r-btts-yes']
  );
});

test('market ranking leaves the caller array untouched', () => {
  const markets = [
    makeMarket('u-1x2-h', 1.9),
    makeMarket('u-ou-15', 1.25, 'Goals'),
  ];
  const original = markets.map((market) => market.id);

  sortMarketsByProbability(markets);

  assert.deepEqual(
    markets.map((market) => market.id),
    original
  );
});

test('equally priced markets keep the bookmaker order', () => {
  const markets = [
    makeMarket('t-a', 2.0, '1X2', 'A Win'),
    makeMarket('t-b', 2.0, 'Goals', 'Over 2.5 Goals'),
    makeMarket('t-c', 2.0, 'BTTS', 'BTTS Yes'),
  ];

  assert.deepEqual(
    sortMarketsByProbability(markets).map((market) => market.id),
    ['t-a', 't-b', 't-c']
  );
});

test('raw implied and fair probability produce the same order', () => {
  const markets = withFairProbabilities([
    makeMarket('s-1x2-h', 2.4),
    makeMarket('s-1x2-d', 3.4),
    makeMarket('s-1x2-a', 2.9),
  ]);

  const byFair = sortMarketsByProbability(markets).map((m) => m.id);
  const byImplied = [...markets]
    .sort((a, b) => b.impliedProbability - a.impliedProbability)
    .map((m) => m.id);

  assert.deepEqual(byFair, byImplied);
});
