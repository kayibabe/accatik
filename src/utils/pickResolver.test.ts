import test from 'node:test';
import assert from 'node:assert/strict';
import { isPriced, resolvePick, scoreMarket } from './pickResolver.ts';
import { buildRecommendedAngle } from './recommendedAngle.ts';
import { makeFixture, makeMarket } from './testFactories.ts';
import type { AccaStrategy } from '../types/fixtures.ts';

const STRATEGIES: AccaStrategy[] = [
  'balanced',
  'favorites',
  'goals',
  'high-yield',
  'probability',
];

/** A board where the shortest price, the recommended pick and the goals pick differ. */
const book = () => [
  makeMarket('f-ou-15', 1.12, 'Goals', 'Over 1.5 Goals'),
  makeMarket('f-1x2-a', 1.42, '1X2', 'Portugal Win'),
  makeMarket('f-ou-25', 1.48, 'Goals', 'Over 2.5 Goals'),
  makeMarket('f-btts-yes', 1.4, 'BTTS', 'BTTS Yes'),
];

function favouriteFixture() {
  return makeFixture({
    id: 'f',
    markets: book(),
    recommendedPickId: 'f-1x2-a',
  });
}

test('priced markets need a playable price', () => {
  assert.equal(isPriced(makeMarket('a', 1.42)), true);
  assert.equal(isPriced(makeMarket('b', 1)), false);
  assert.equal(isPriced(makeMarket('c', 0)), false);
  assert.equal(isPriced(makeMarket('d', Number.NaN)), false);
});

test('balanced follows the recommended pick from the live book', () => {
  assert.equal(resolvePick(favouriteFixture(), 'balanced')?.id, 'f-1x2-a');
});

test('balanced falls back to the best-scoring market when the id is stale', () => {
  const fixture = makeFixture({
    id: 'f',
    markets: book(),
    recommendedPickId: '',
  });

  const expected = fixture.markets.reduce((best, market) =>
    scoreMarket(fixture, market, 'balanced') >
    scoreMarket(fixture, best, 'balanced')
      ? market
      : best
  );

  assert.equal(resolvePick(fixture, 'balanced')?.id, expected.id);
});

test('probability ignores the recommended pick and takes the shortest price', () => {
  assert.equal(resolvePick(favouriteFixture(), 'probability')?.id, 'f-ou-15');
});

test('the goals strategy prefers a goal market over the match winner', () => {
  const picked = resolvePick(favouriteFixture(), 'goals');
  assert.ok(picked);
  assert.ok(
    picked.marketType === 'Goals' || picked.marketType === 'BTTS',
    `expected a goal market, got ${picked.label}`
  );
});

test('the angle card and the ticket resolve to the same market', () => {
  const fixture = favouriteFixture();

  for (const strategy of STRATEGIES) {
    const angle = buildRecommendedAngle(fixture, strategy);
    const pick = resolvePick(fixture, strategy);

    assert.equal(
      angle?.market.id,
      pick?.id,
      `${strategy}: card and pick disagree`
    );
  }
});

test('high-yield prefers the 2.10–3.40 band and rejects longshots', () => {
  const fixture = makeFixture({
    id: 'hy',
    markets: [
      makeMarket('hy-short', 1.4, '1X2', 'Short Win'),
      makeMarket('hy-band', 2.5, '1X2', 'Band Win'),
      makeMarket('hy-long', 6.0, '1X2', 'Longshot Win'),
    ],
    // Even with the recommendation bonus, a 6.00 shot must not win.
    recommendedPickId: 'hy-long',
  });

  const picked = resolvePick(fixture, 'high-yield');

  assert.equal(picked?.id, 'hy-band');
  assert.ok(
    scoreMarket(fixture, fixture.markets[1], 'high-yield') >
      scoreMarket(fixture, fixture.markets[2], 'high-yield')
  );
});

test('the shortest price is exposed as context, not as the pick', () => {
  const angle = buildRecommendedAngle(favouriteFixture(), 'balanced');

  assert.equal(angle?.market.id, 'f-1x2-a');
  assert.equal(angle?.shortestPrice?.id, 'f-ou-15');
  assert.ok((angle?.shortestPriceProbability ?? 0) > (angle?.probability ?? 0));
});

test('unpriced fixtures resolve to nothing', () => {
  assert.equal(
    resolvePick(makeFixture({ id: 'empty', markets: [] }), 'balanced'),
    null
  );
  assert.equal(
    resolvePick(
      makeFixture({
        id: 'unpriced',
        markets: [makeMarket('u-1x2-h', 1)],
      }),
      'balanced'
    ),
    null
  );
});
