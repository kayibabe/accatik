import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ODDS_BANDS,
  buildDailyPerformance,
  buildMarketTypePerformance,
  buildOddsBandPerformance,
  buildSlipAnalytics,
  slipNetPnl,
} from './slipAnalytics.ts';
import type { SlipSettlementInput } from './slipAnalytics.ts';
import type { MarketType, SettlementStatus } from '../types/fixtures.ts';

function makeRow(
  overrides: Partial<SlipSettlementInput> & { id: string }
): SlipSettlementInput {
  return {
    dateIso: '2026-11-18',
    createdAt: '2026-11-18T08:00:00.000Z',
    stake: 100,
    effectiveOdds: 2,
    legCount: 3,
    status: 'Pending',
    settledReturn: 0,
    ...overrides,
  };
}

const mixedRows: SlipSettlementInput[] = [
  makeRow({
    id: 'win',
    stake: 100,
    effectiveOdds: 2,
    status: 'Win',
    settledReturn: 200,
    createdAt: '2026-11-18T08:00:00.000Z',
  }),
  makeRow({
    id: 'lost',
    stake: 50,
    effectiveOdds: 3,
    status: 'Lost',
    createdAt: '2026-11-18T09:00:00.000Z',
  }),
  makeRow({
    id: 'void',
    stake: 30,
    effectiveOdds: 1,
    status: 'Void',
    settledReturn: 30,
    dateIso: '2026-11-17',
    createdAt: '2026-11-17T07:00:00.000Z',
  }),
  makeRow({
    id: 'live',
    stake: 20,
    status: 'Live',
    dateIso: '2026-11-19',
    createdAt: '2026-11-19T10:00:00.000Z',
  }),
  makeRow({
    id: 'pending',
    stake: 10,
    status: 'Pending',
    dateIso: '2026-11-20',
    createdAt: '2026-11-20T11:00:00.000Z',
  }),
];

test('an empty archive reports zeroes and null ratios, not NaN', () => {
  const analytics = buildSlipAnalytics([]);

  assert.equal(analytics.total, 0);
  assert.equal(analytics.decided, 0);
  assert.equal(analytics.open, 0);
  assert.equal(analytics.settledStake, 0);
  assert.equal(analytics.voidedStake, 0);
  assert.equal(analytics.returns, 0);
  assert.equal(analytics.netPnl, 0);
  assert.equal(analytics.grossProfit, 0);
  assert.equal(analytics.grossLoss, 0);
  assert.equal(analytics.profitFactor, null);
  assert.equal(analytics.roi, null);
  assert.equal(analytics.hitRate, null);
  assert.equal(analytics.voidRate, 0);
  assert.equal(analytics.avgStake, 0);
  assert.equal(analytics.avgOdds, 0);
  assert.equal(analytics.avgLegs, 0);
  assert.deepEqual(analytics.equity, [{ dateIso: '', value: 0 }]);
  assert.deepEqual(analytics.currentStreak, { kind: null, length: 0 });

  assert.deepEqual(buildDailyPerformance([]), []);
  assert.deepEqual(buildMarketTypePerformance([]), []);
  assert.deepEqual(
    buildOddsBandPerformance([]).map((band) => [band.slips, band.netPnl, band.roi]),
    ODDS_BANDS.map(() => [0, 0, null])
  );
});

test('wins, losses, voids and open slips land in separate buckets', () => {
  const analytics = buildSlipAnalytics(mixedRows);

  assert.equal(analytics.total, 5);
  assert.equal(analytics.won, 1);
  assert.equal(analytics.lost, 1);
  assert.equal(analytics.voided, 1);
  assert.equal(analytics.live, 1);
  assert.equal(analytics.pending, 1);
  assert.equal(analytics.open, 2);
  assert.equal(analytics.decided, 2);

  // ROI only ever divides by the Win/Lost stake.
  assert.equal(analytics.settledStake, 150);
  assert.equal(analytics.voidedStake, 30);
  assert.equal(analytics.totalStaked, 210);
  assert.equal(analytics.returns, 230);
  assert.equal(analytics.netPnl, 50);
  assert.equal(analytics.grossProfit, 100);
  assert.equal(analytics.grossLoss, 50);
  assert.equal(analytics.profitFactor, 2);
  assert.equal(analytics.roi, 33.3);

  assert.equal(analytics.hitRate, 50);
  assert.equal(analytics.voidRate, 33.3);
  assert.equal(analytics.avgStake, 75);
  assert.equal(analytics.avgOdds, 2.5);
  assert.equal(analytics.avgLegs, 3);
  assert.equal(analytics.avgWinningOdds, 2);
  assert.equal(analytics.avgLosingOdds, 3);
  assert.equal(analytics.biggestWin, 100);
  assert.equal(analytics.biggestLoss, 50);
});

test('a void-only archive has no hit rate and breaks even', () => {
  const analytics = buildSlipAnalytics([
    makeRow({
      id: 'void',
      stake: 40,
      status: 'Void',
      settledReturn: 40,
      effectiveOdds: 1,
    }),
    makeRow({ id: 'open', stake: 10, status: 'Live' }),
  ]);

  assert.equal(analytics.hitRate, null);
  assert.equal(analytics.roi, null);
  assert.equal(analytics.netPnl, 0);
  assert.equal(analytics.returns, 40);
  assert.equal(analytics.voidedStake, 40);
});

test('streaks follow save order, not archive order', () => {
  const statuses: SettlementStatus[] = ['Win', 'Win', 'Lost', 'Lost', 'Lost', 'Win'];
  const rows = statuses.map((status, index) =>
    makeRow({
      id: `row-${index}`,
      status,
      stake: 10,
      effectiveOdds: 2,
      settledReturn: status === 'Win' ? 20 : status === 'Void' ? 10 : 0,
      createdAt: `2026-11-18T0${index}:00:00.000Z`,
    })
  );

  const analytics = buildSlipAnalytics([...rows].reverse());

  assert.equal(analytics.longestWinStreak, 2);
  assert.equal(analytics.longestLossStreak, 3);
  assert.deepEqual(analytics.currentStreak, { kind: 'Win', length: 1 });
});

test('the equity curve starts at zero and skips open slips', () => {
  const analytics = buildSlipAnalytics(mixedRows);

  assert.deepEqual(analytics.equity, [
    { dateIso: '', value: 0 },
    { dateIso: '2026-11-17', value: 0 },
    { dateIso: '2026-11-18', value: 100 },
    { dateIso: '2026-11-18', value: 50 },
  ]);
});

test('daily performance groups money and keeps void days flat', () => {
  const days = buildDailyPerformance(mixedRows);

  assert.deepEqual(
    days.map((day) => day.dateIso),
    ['2026-11-20', '2026-11-19', '2026-11-18', '2026-11-17']
  );

  const settledDay = days.find((day) => day.dateIso === '2026-11-18')!;
  assert.equal(settledDay.slips, 2);
  assert.equal(settledDay.won, 1);
  assert.equal(settledDay.lost, 1);
  assert.equal(settledDay.settledStake, 150);
  assert.equal(settledDay.voidedStake, 0);
  assert.equal(settledDay.returns, 200);
  assert.equal(settledDay.netPnl, 50);
  assert.equal(settledDay.roi, 33.3);

  const voidDay = days.find((day) => day.dateIso === '2026-11-17')!;
  assert.equal(voidDay.voided, 1);
  assert.equal(voidDay.voidedStake, 30);
  assert.equal(voidDay.returns, 30);
  assert.equal(voidDay.netPnl, 0);
  assert.equal(voidDay.roi, null);

  const openDay = days.find((day) => day.dateIso === '2026-11-19')!;
  assert.equal(openDay.open, 1);
  assert.equal(openDay.returns, 0);
  assert.equal(openDay.roi, null);
});

test('odds bands split at 5.00, 10.00 and 20.00 and ignore open slips', () => {
  const rows: SlipSettlementInput[] = [
    makeRow({
      id: 'under-5',
      stake: 10,
      effectiveOdds: 4.99,
      status: 'Win',
      settledReturn: 49.9,
    }),
    makeRow({
      id: 'band-5',
      stake: 10,
      effectiveOdds: 5,
      status: 'Lost',
    }),
    makeRow({
      id: 'band-9.99',
      stake: 20,
      effectiveOdds: 9.99,
      status: 'Win',
      settledReturn: 199.8,
    }),
    makeRow({
      id: 'band-10',
      stake: 10,
      effectiveOdds: 10,
      status: 'Lost',
    }),
    makeRow({
      id: 'band-19.99',
      stake: 20,
      effectiveOdds: 19.99,
      status: 'Void',
      settledReturn: 20,
    }),
    makeRow({
      id: 'band-20',
      stake: 5,
      effectiveOdds: 20,
      status: 'Win',
      settledReturn: 100,
    }),
    makeRow({
      id: 'open-20',
      stake: 10,
      effectiveOdds: 20,
      status: 'Pending',
    }),
  ];

  const bands = buildOddsBandPerformance(rows);
  const byId = new Map(bands.map((band) => [band.id, band]));

  assert.deepEqual(
    bands.map((band) => band.id),
    ['under-5', '5-10', '10-20', 'over-20']
  );

  const under5 = byId.get('under-5')!;
  assert.equal(under5.slips, 1);
  assert.equal(under5.won, 1);
  assert.equal(under5.netPnl, 39.9);
  assert.equal(under5.roi, 399);
  assert.equal(under5.hitRate, 100);

  const fiveToTen = byId.get('5-10')!;
  assert.equal(fiveToTen.slips, 2);
  assert.equal(fiveToTen.won, 1);
  assert.equal(fiveToTen.lost, 1);
  assert.equal(fiveToTen.settledStake, 30);
  assert.equal(fiveToTen.netPnl, 169.8);
  assert.equal(fiveToTen.hitRate, 50);

  const tenToTwenty = byId.get('10-20')!;
  assert.equal(tenToTwenty.slips, 2);
  assert.equal(tenToTwenty.lost, 1);
  assert.equal(tenToTwenty.voided, 1);
  assert.equal(tenToTwenty.voidedStake, 20);
  assert.equal(tenToTwenty.netPnl, -10);
  assert.equal(tenToTwenty.roi, -100);
  assert.equal(tenToTwenty.hitRate, 0);

  const over20 = byId.get('over-20')!;
  assert.equal(over20.slips, 1);
  assert.equal(over20.netPnl, 95);
  assert.equal(over20.roi, 1900);
});

test('leg hit rates group by market type, busiest first', () => {
  const legs: Array<{ marketType: MarketType; status: SettlementStatus }> = [
    { marketType: '1X2', status: 'Win' },
    { marketType: '1X2', status: 'Win' },
    { marketType: '1X2', status: 'Lost' },
    { marketType: 'Goals', status: 'Win' },
    { marketType: 'Goals', status: 'Void' },
    { marketType: 'BTTS', status: 'Pending' },
  ];

  const rows = buildMarketTypePerformance(legs);

  assert.deepEqual(
    rows.map((row) => row.marketType),
    ['1X2', 'Goals', 'BTTS']
  );

  const oneXtwo = rows[0];
  assert.equal(oneXtwo.legs, 3);
  assert.equal(oneXtwo.won, 2);
  assert.equal(oneXtwo.lost, 1);
  assert.equal(oneXtwo.hitRate, 66.7);

  const goals = rows[1];
  assert.equal(goals.legs, 2);
  assert.equal(goals.won, 1);
  assert.equal(goals.voided, 1);
  assert.equal(goals.hitRate, 100);

  const btts = rows[2];
  assert.equal(btts.open, 1);
  assert.equal(btts.hitRate, null);
});

test('per-slip P&L only counts decided slips', () => {
  assert.equal(
    slipNetPnl(makeRow({ id: 'w', status: 'Win', stake: 10, settledReturn: 25 })),
    15
  );
  assert.equal(slipNetPnl(makeRow({ id: 'l', status: 'Lost', stake: 10 })), -10);
  assert.equal(
    slipNetPnl(
      makeRow({ id: 'v', status: 'Void', stake: 10, settledReturn: 10 })
    ),
    0
  );
  assert.equal(slipNetPnl(makeRow({ id: 'o', status: 'Live', stake: 10 })), 0);
});
