import test from 'node:test';
import assert from 'node:assert/strict';
import type { Fixture } from '../types/fixtures.ts';
import {
  formatModelXg,
  formatXg,
  getModelXg,
  getXgDisplay,
  MARKET_XG_TITLE,
  xgTitle,
} from './modelXg.ts';
import { makeFixture, makeMarket } from './testFactories.ts';

function withModelXg(lambdaHome: unknown, lambdaAway: unknown): Fixture {
  return makeFixture({
    id: 'xg-fixture',
    framework: {
      model: { lambdaHome, lambdaAway },
    } as unknown as Fixture['framework'],
  });
}

test('reads the model expected-goals pair from an assessed fixture', () => {
  const fixture = withModelXg(1.234, 0.867);
  assert.deepEqual(getModelXg(fixture), { home: 1.234, away: 0.867 });
});

test('reads persisted model xG on settled fixtures without a framework', () => {
  const fixture = makeFixture({
    id: 'settled-xg',
    modelXgHome: 2.1,
    modelXgAway: 0.4,
  });
  assert.deepEqual(getModelXg(fixture), { home: 2.1, away: 0.4 });
});

test('prefers persisted model xG over a newer assessment', () => {
  const fixture = withModelXg(1.2, 1.3);
  fixture.modelXgHome = 1.8;
  fixture.modelXgAway = 0.9;
  assert.deepEqual(getModelXg(fixture), { home: 1.8, away: 0.9 });
});

test('hides xG when the fixture has no framework model', () => {
  assert.equal(getModelXg(makeFixture({ id: 'no-framework' })), null);
  assert.equal(
    getModelXg(withModelXg(null, 1.2)),
    null,
    'missing lambda is not shown'
  );
  assert.equal(
    getModelXg(withModelXg(1.2, Number.NaN)),
    null,
    'invalid lambda is not shown'
  );
});

test('display falls back to a labelled market estimate', () => {
  const marketFixture = makeFixture({
    id: 'market-only',
    markets: [
      { ...makeMarket('1-1x2-h', 2.4, '1X2', 'Home Win'), fairProbability: 41.3 },
      { ...makeMarket('1-1x2-d', 2.8, '1X2', 'Draw'), fairProbability: 31.7 },
      { ...makeMarket('1-1x2-a', 3.3, '1X2', 'Away Win'), fairProbability: 26.9 },
      {
        ...makeMarket('1-ou-25', 2.62, 'Goals', 'Over 2.5 Goals'),
        fairProbability: 33.9,
      },
      {
        ...makeMarket('1-ou-u25', 1.44, 'Goals', 'Under 2.5 Goals'),
        fairProbability: 61.7,
      },
    ],
  });

  const display = getXgDisplay(marketFixture);
  assert.ok(display);
  assert.equal(display.source, 'market');
  assert.match(formatXg(display), /^xG \(market estimate\): Home /);
  assert.equal(xgTitle(display), MARKET_XG_TITLE);

  const withFramework = {
    ...withModelXg(1.2, 1.3),
    markets: marketFixture.markets,
  };
  assert.equal(getXgDisplay(withFramework)?.source, 'framework');
});

test('formats the pair with home and away labels', () => {
  const xg = getModelXg(withModelXg(1.234, 0.867));
  assert.ok(xg);
  assert.equal(formatModelXg(xg), 'xG (model): Home 1.23 / Away 0.87');
});
