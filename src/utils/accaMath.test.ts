import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLegsFromRefs,
  calculateCombinedImpliedProbability,
  calculatePotentialReturn,
  calculateTotalOdds,
  evaluateMarketSettlement,
  evaluateTicketSettlement,
  getFixtureMatchResultSummary,
} from './accaMath.ts';
import { makeFixture, makeLeg, makeMarket } from './testFactories.ts';

test('1X2 settles on the full-time score', () => {
  const fixture = makeFixture({ id: 'f1', score: { home: 2, away: 1 } });

  assert.equal(
    evaluateMarketSettlement(fixture, makeMarket('f1-1x2-h', 1.5, '1X2', 'Home FC Win')),
    'Win'
  );
  assert.equal(
    evaluateMarketSettlement(fixture, makeMarket('f1-1x2-d', 3.4, '1X2', 'Draw')),
    'Lost'
  );
  assert.equal(
    evaluateMarketSettlement(fixture, makeMarket('f1-1x2-a', 4.2, '1X2', 'Away FC Win')),
    'Lost'
  );
});

test('a draw settles draw and both double-chance sides', () => {
  const fixture = makeFixture({ id: 'f2', score: { home: 1, away: 1 } });

  assert.equal(
    evaluateMarketSettlement(fixture, makeMarket('f2-1x2-d', 3.1, '1X2', 'Draw')),
    'Win'
  );
  assert.equal(
    evaluateMarketSettlement(fixture, makeMarket('f2-dc-1x', 1.2, 'Double Chance', '1X (Home or Draw)')),
    'Win'
  );
  assert.equal(
    evaluateMarketSettlement(fixture, makeMarket('f2-dc-x2', 1.3, 'Double Chance', 'X2 (Draw or Away)')),
    'Win'
  );
});

test('double chance loses when the uncovered side wins', () => {
  const fixture = makeFixture({ id: 'f3', score: { home: 0, away: 2 } });

  assert.equal(
    evaluateMarketSettlement(fixture, makeMarket('f3-dc-1x', 1.4, 'Double Chance', '1X (Home or Draw)')),
    'Lost'
  );
  assert.equal(
    evaluateMarketSettlement(fixture, makeMarket('f3-dc-x2', 1.6, 'Double Chance', 'X2 (Draw or Away)')),
    'Win'
  );
});

test('draw no bet voids on a draw and wins on the backed side', () => {
  const draw = makeFixture({ id: 'f4', score: { home: 2, away: 2 } });
  const homeWin = makeFixture({ id: 'f5', score: { home: 3, away: 0 } });

  assert.equal(
    evaluateMarketSettlement(draw, makeMarket('f4-dnb-h', 1.8, 'Draw No Bet', 'Home FC DNB')),
    'Void'
  );
  assert.equal(
    evaluateMarketSettlement(homeWin, makeMarket('f5-dnb-h', 1.8, 'Draw No Bet', 'Home FC DNB')),
    'Win'
  );
});

test('goal lines read the line out of the label', () => {
  const threeGoals = makeFixture({ id: 'f6', score: { home: 2, away: 1 } });
  const twoGoals = makeFixture({ id: 'f7', score: { home: 1, away: 1 } });

  assert.equal(
    evaluateMarketSettlement(threeGoals, makeMarket('f6-ou-25', 1.9, 'Goals', 'Over 2.5 Goals')),
    'Win'
  );
  assert.equal(
    evaluateMarketSettlement(twoGoals, makeMarket('f7-ou-25', 1.9, 'Goals', 'Over 2.5 Goals')),
    'Lost'
  );
  assert.equal(
    evaluateMarketSettlement(twoGoals, makeMarket('f7-ou-u25', 2.0, 'Goals', 'Under 2.5 Goals')),
    'Win'
  );
});

test('BTTS needs both teams to score', () => {
  const both = makeFixture({ id: 'f8', score: { home: 2, away: 2 } });
  const oneSide = makeFixture({ id: 'f9', score: { home: 1, away: 0 } });

  assert.equal(
    evaluateMarketSettlement(both, makeMarket('f8-btts-yes', 1.7, 'BTTS', 'BTTS Yes')),
    'Win'
  );
  assert.equal(
    evaluateMarketSettlement(oneSide, makeMarket('f9-btts-yes', 1.7, 'BTTS', 'BTTS Yes')),
    'Lost'
  );
});

test('unplayed fixtures stay pending, live fixtures stay live, void fixtures void', () => {
  const scheduled = makeFixture({ id: 'f10', status: 'Scheduled', statusShort: 'NS', score: { home: null, away: null } });
  const live = makeFixture({ id: 'f11', status: 'Live', statusShort: '2H', score: { home: 1, away: 0 } });
  const voided = makeFixture({ id: 'f12', status: 'Void', statusShort: 'PST', score: { home: null, away: null } });

  assert.equal(
    evaluateMarketSettlement(scheduled, makeMarket('f10-1x2-h', 1.5, '1X2', 'Home FC Win')),
    'Pending'
  );
  assert.equal(
    evaluateMarketSettlement(live, makeMarket('f11-1x2-h', 1.5, '1X2', 'Home FC Win')),
    'Live'
  );
  assert.equal(
    evaluateMarketSettlement(voided, makeMarket('f12-1x2-h', 1.5, '1X2', 'Home FC Win')),
    'Void'
  );
});

test('a finished match with no published score is pending, not settled', () => {
  const fixture = makeFixture({ id: 'f13', status: 'Finished', score: { home: null, away: null } });

  assert.equal(
    evaluateMarketSettlement(fixture, makeMarket('f13-1x2-h', 1.5, '1X2', 'Home FC Win')),
    'Pending'
  );
});

test('odds maths rounds to two decimals', () => {
  assert.equal(calculateTotalOdds([]), 0);
  assert.equal(calculateTotalOdds([makeLeg('a', 'a-1x2-h', 1.5), makeLeg('b', 'b-1x2-h', 1.4)]), 2.1);
  assert.equal(calculatePotentialReturn(2500, 5.06), 12_650);
  assert.equal(calculateCombinedImpliedProbability([makeLeg('a', 'a-1x2-h', 2)]), 50);
});

test('a lost leg zeroes the ticket return', () => {
  const fixtures = [
    makeFixture({ id: 'a', score: { home: 2, away: 0 } }),
    makeFixture({ id: 'b', score: { home: 0, away: 1 } }),
  ];
  const legs = [
    makeLeg('a', 'a-1x2-h', 1.5, { marketLabel: 'Home FC Win' }),
    makeLeg('b', 'b-1x2-h', 2, { marketLabel: 'Home FC Win' }),
  ];

  const summary = evaluateTicketSettlement(legs, fixtures, 100);
  assert.equal(summary.status, 'Lost');
  assert.equal(summary.settledReturn, 0);
  assert.equal(summary.lostCount, 1);
  assert.equal(summary.winCount, 1);
});

test('a void leg reprices to 1.00 and is excluded from the payout', () => {
  const fixtures = [
    makeFixture({ id: 'a', score: { home: 2, away: 0 } }),
    makeFixture({ id: 'c', score: { home: 1, away: 1 } }),
  ];
  const legs = [
    makeLeg('a', 'a-1x2-h', 2, { marketLabel: 'Home FC Win' }),
    makeLeg('c', 'c-dnb-h', 1.5, {
      marketType: 'Draw No Bet',
      marketLabel: 'Home FC DNB',
    }),
  ];

  const summary = evaluateTicketSettlement(legs, fixtures, 100);
  assert.equal(summary.status, 'Win');
  assert.equal(summary.voidCount, 1);
  assert.equal(summary.effectiveOdds, 2);
  assert.equal(summary.settledReturn, 200);
});

test('an all-void ticket returns the stake', () => {
  const fixtures = [makeFixture({ id: 'd', status: 'Void', statusShort: 'CANC' })];
  const legs = [makeLeg('d', 'd-1x2-h', 1.8, { marketLabel: 'Home FC Win' })];

  const summary = evaluateTicketSettlement(legs, fixtures, 250);
  assert.equal(summary.status, 'Void');
  assert.equal(summary.settledReturn, 250);
});

test('a live leg keeps the ticket live', () => {
  const fixtures = [
    makeFixture({ id: 'a', score: { home: 2, away: 0 } }),
    makeFixture({ id: 'e', status: 'Live', statusShort: '1H', score: { home: 0, away: 0 } }),
  ];
  const legs = [
    makeLeg('a', 'a-1x2-h', 1.5, { marketLabel: 'Home FC Win' }),
    makeLeg('e', 'e-1x2-a', 2.5, { marketLabel: 'Away FC Win' }),
  ];

  assert.equal(evaluateTicketSettlement(legs, fixtures, 100).status, 'Live');
});

test('legs are built from refs without duplicating a fixture', () => {
  const fixture = makeFixture({
    id: 'f1',
    recommendedPickId: 'f1-1x2-h',
    markets: [
      makeMarket('f1-1x2-h', 1.5, '1X2', 'Home FC Win', 'Bet365'),
      makeMarket('f1-1x2-a', 4.2, '1X2', 'Away FC Win', 'Bet365'),
    ],
  });

  const legs = buildLegsFromRefs(
    [fixture],
    [
      { fixtureId: 'f1', marketId: 'f1-1x2-h' },
      { fixtureId: 'f1', marketId: 'f1-1x2-a' },
      { fixtureId: 'missing', marketId: 'x' },
    ]
  );

  assert.equal(legs.length, 1);
  assert.equal(legs[0].marketId, 'f1-1x2-h');
  assert.equal(legs[0].bookmaker, 'Bet365');
});

test('match result summary is human readable', () => {
  assert.equal(
    getFixtureMatchResultSummary(makeFixture({ id: 'a', score: { home: 2, away: 1 } })),
    '2 - 1 (Home FC Win)'
  );
  assert.equal(
    getFixtureMatchResultSummary(
      makeFixture({ id: 'b', status: 'Scheduled', statusShort: 'NS', score: { home: null, away: null } })
    ),
    'Scheduled'
  );
});
