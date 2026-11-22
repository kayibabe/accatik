import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFixture, makeMarket } from './testFactories.ts';
import {
  compareSelections,
  MARKET_SELECTION_CATALOG,
  resolveMarketSelection,
} from './marketSelection.ts';

const fixture = makeFixture({
  id: 'f1',
  homeTeam: 'Alpha FC',
  awayTeam: 'Beta FC',
});

test('team-specific winner labels collapse into one Home Win selection', () => {
  const alpha = resolveMarketSelection(
    makeMarket('f1-1x2-h', 2.1, '1X2', 'Alpha FC Win'),
    fixture
  );
  const other = resolveMarketSelection(
    makeMarket('f2-1x2-h', 1.8, '1X2', 'Gamma FC Win'),
    makeFixture({ id: 'f2', homeTeam: 'Gamma FC', awayTeam: 'Delta FC' })
  );

  assert.deepEqual(alpha, {
    key: '1X2-H',
    label: 'Home Win',
    shortLabel: '1',
    marketType: '1X2',
  });
  assert.equal(other.key, alpha.key);
  assert.equal(
    resolveMarketSelection(makeMarket('f1-1x2-a', 3.2, '1X2', 'Beta FC Win'), fixture).key,
    '1X2-A'
  );
  assert.equal(
    resolveMarketSelection(makeMarket('f1-1x2-d', 3.4, '1X2', 'Draw'), fixture).key,
    '1X2-D'
  );
});

test('goal lines resolve from both the id suffix and the label', () => {
  assert.deepEqual(
    resolveMarketSelection(
      makeMarket('f1-ou-35', 2.2, 'Goals', 'Over 3.5 Goals'),
      fixture
    ),
    {
      key: 'GOALS-O3.5',
      label: 'Over 3.5 Goals',
      shortLabel: 'O3.5',
      marketType: 'Goals',
    }
  );
  assert.deepEqual(
    resolveMarketSelection(
      makeMarket('f1-ou-u45', 1.35, 'Goals', 'Under 4.5 Goals'),
      fixture
    ),
    {
      key: 'GOALS-U4.5',
      label: 'Under 4.5 Goals',
      shortLabel: 'U4.5',
      marketType: 'Goals',
    }
  );
  assert.equal(
    resolveMarketSelection(
      makeMarket('legacy-1', 1.5, 'Goals', 'Over 1.5 Goals'),
      fixture
    ).key,
    'GOALS-O1.5'
  );
});

test('BTTS, double chance and DNB sides get their own stable keys', () => {
  const keyOf = (market: ReturnType<typeof makeMarket>) =>
    resolveMarketSelection(market, fixture).key;

  assert.equal(keyOf(makeMarket('f1-btts-yes', 1.8, 'BTTS', 'BTTS Yes')), 'BTTS-YES');
  assert.equal(keyOf(makeMarket('f1-btts-no', 2.1, 'BTTS', 'BTTS No')), 'BTTS-NO');
  assert.equal(keyOf(makeMarket('f1-dc-1x', 1.4, 'Double Chance', '1X (Home or Draw)')), 'DC-1X');
  assert.equal(keyOf(makeMarket('f1-dc-12', 1.5, 'Double Chance', '12 (Home or Away)')), 'DC-12');
  assert.equal(keyOf(makeMarket('f1-dc-x2', 1.6, 'Double Chance', 'X2 (Draw or Away)')), 'DC-X2');

  const dnb = resolveMarketSelection(
    makeMarket('f1-dnb-h', 1.9, 'Draw No Bet', 'Alpha FC DNB'),
    fixture
  );
  assert.deepEqual(dnb, {
    key: 'DNB-1',
    label: '1 (DNB)',
    shortLabel: '1 (DNB)',
    marketType: 'Draw No Bet',
  });
  assert.equal(
    resolveMarketSelection(
      makeMarket('f1-dnb-a', 2.3, 'Draw No Bet', 'Beta FC DNB'),
      fixture
    ).key,
    'DNB-2'
  );
  // Legacy labels that contain "draw no bet" must still resolve to a side.
  assert.equal(
    resolveMarketSelection(
      makeMarket('v1-dnb-h', 2, 'Draw No Bet', 'Draw No Bet - Home'),
      fixture
    ).key,
    'DNB-1'
  );
});

test('unknown bets keep a distinct row instead of being discarded', () => {
  const unknown = resolveMarketSelection(
    makeMarket('f1-x', 2, 'Goals', 'OddsSpread Moneyline'),
    fixture
  );
  assert.equal(unknown.key, 'Goals|OddsSpread Moneyline');
  assert.equal(unknown.label, 'OddsSpread Moneyline');
});

test('the catalogue lists every line the collector can publish', () => {
  const keys = MARKET_SELECTION_CATALOG.map((selection) => selection.key);
  for (const key of [
    '1X2-H',
    '1X2-D',
    '1X2-A',
    'GOALS-O1.5',
    'GOALS-O2.5',
    'GOALS-O3.5',
    'GOALS-O4.5',
    'GOALS-U1.5',
    'GOALS-U2.5',
    'GOALS-U3.5',
    'GOALS-U4.5',
    'BTTS-YES',
    'BTTS-NO',
    'DC-1X',
    'DC-12',
    'DC-X2',
    'DNB-1',
    'DNB-2',
  ]) {
    assert.ok(keys.includes(key), `${key} must be in the catalogue`);
  }
});

test('selections sort by market then by betting order', () => {
  const rows = [
    resolveMarketSelection(makeMarket('f1-dnb-a', 2, 'Draw No Bet', 'Beta FC DNB'), fixture),
    resolveMarketSelection(makeMarket('f1-ou-25', 2, 'Goals', 'Over 2.5 Goals'), fixture),
    resolveMarketSelection(makeMarket('f1-1x2-a', 2, '1X2', 'Beta FC Win'), fixture),
    resolveMarketSelection(makeMarket('f1-ou-u15', 2, 'Goals', 'Under 1.5 Goals'), fixture),
    resolveMarketSelection(makeMarket('f1-btts-no', 2, 'BTTS', 'BTTS No'), fixture),
    resolveMarketSelection(makeMarket('f1-1x2-h', 2, '1X2', 'Alpha FC Win'), fixture),
  ];
  assert.deepEqual(
    rows.sort(compareSelections).map((row) => row.key),
    [
      '1X2-H',
      '1X2-A',
      'GOALS-O2.5',
      'GOALS-U1.5',
      'BTTS-NO',
      'DNB-2',
    ]
  );
});
