import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  FeaturedAnalyticsRow,
  FeaturedPickSample,
  PickAnalyticsResponse,
  RoiPromotionConfig,
  RoiRegistryEntry,
} from '../../src/types/analytics.ts';
import {
  applyRoiPromotion,
  clusterRoiCi,
  DEFAULT_ROI_PROMOTION_CONFIG,
  promotedWhitelist,
  registryKey,
  wilson,
} from './roiPromotion.ts';

function row(overrides: Partial<FeaturedAnalyticsRow> = {}): FeaturedAnalyticsRow {
  return {
    key: 'angle:1X2-H',
    label: 'Home Win',
    source: 'angle',
    selectionKey: '1X2-H',
    marketType: '1X2',
    settled: 78,
    wins: 69,
    losses: 9,
    voids: 0,
    hitRate: 88.5,
    stake: 78,
    returns: 86.25,
    netPnl: 8.25,
    roi: 10.6,
    avgOdds: 1.25,
    avgProbability: 75,
    firstDateIso: '2026-10-01',
    lastDateIso: '2026-11-20',
    ...overrides,
  };
}

function samples(
  wins: number,
  losses: number,
  endIso = '2026-11-20',
  spreadDays = 11
): FeaturedPickSample[] {
  const dates = Array.from({ length: spreadDays }, (_, i) => {
    const date = new Date(`${endIso}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (spreadDays - 1 - i));
    return date.toISOString().slice(0, 10);
  });
  const outcomes = [
    ...Array.from({ length: wins }, () => true),
    ...Array.from({ length: losses }, () => false),
  ];
  return outcomes.map((won, i) => ({
    key: 'angle:1X2-H',
    dateIso: dates[i % spreadDays],
    odds: 1.25,
    won,
  }));
}

function analytics(
  rows: FeaturedAnalyticsRow[],
  picks: FeaturedPickSample[],
  generatedAt = '2026-11-20T03:00:00.000Z'
): PickAnalyticsResponse {
  return {
    strategy: 'balanced',
    generatedAt,
    firstDateIso: '2026-10-01',
    lastDateIso: '2026-11-20',
    sampleDates: 11,
    sampleFixtures: 935,
    marketPicks: 3000,
    stakePerPick: 1,
    priceQuality: { prematch: 3000, live: 0, unknown: 0 },
    featured: [],
    featuredBySelection: rows,
    marketsByType: [],
    marketsBySelection: [],
    daily: [],
    featuredSelectionSamples: picks,
  };
}

test('Wilson and clustered ROI intervals are computed in percentage points', () => {
  assert.deepEqual(wilson(0, 0), [0, 0]);
  const [low, high] = wilson(69, 78);
  assert.ok(low > 70 && high < 100);
  assert.ok(low < 88.5 && high > 88.5);

  const alwaysWins = Array.from({ length: 30 }, (_, i) => ({
    dateIso: `2026-11-${String((i % 11) + 10).padStart(2, '0')}`,
    odds: 1.2,
    won: true,
  }));
  assert.deepEqual(clusterRoiCi(alwaysWins), [20, 20]);
  // A single matchday cannot be clustered, and an empty sample proves nothing.
  assert.deepEqual(clusterRoiCi(alwaysWins.slice(0, 3).map((row) => ({ ...row, dateIso: '2026-11-20' }))), [0, 0]);
  assert.deepEqual(clusterRoiCi([], 10), [0, 0]);
});

test('a one-pick positive row is never promoted', () => {
  const result = applyRoiPromotion(
    [],
    analytics(
      [row({ key: 'note:1X2-A', source: 'note', selectionKey: '1X2-A', settled: 1, wins: 1, losses: 0, roi: 38, avgOdds: 1.38, firstDateIso: '2026-11-20', lastDateIso: '2026-11-20' })],
      []
    ),
    'balanced'
  );

  assert.equal(result.entries[0].status, 'watch');
  assert.equal(result.promotedKeys.length, 0);
  assert.match(result.entries[0].reason, /settled picks/);
});

test('promotion needs two consecutive qualifying snapshots', () => {
  const data = analytics([row()], samples(69, 9));
  const first = applyRoiPromotion([], data, 'balanced', DEFAULT_ROI_PROMOTION_CONFIG, '2026-11-20');
  assert.equal(first.entries[0].status, 'watch');
  assert.equal(first.entries[0].qualifyingStreak, 1);

  const second = applyRoiPromotion(
    first.entries,
    analytics([row()], samples(69, 9), '2026-11-21T03:00:00.000Z'),
    'balanced',
    DEFAULT_ROI_PROMOTION_CONFIG,
    '2026-11-21'
  );
  assert.equal(second.entries[0].status, 'promoted');
  assert.equal(second.entries[0].promotedAt, '2026-11-21');
  assert.deepEqual(promotedWhitelist(second.entries), new Set(['angle:1X2-H']));
});

test('a promoted row survives one bad snapshot and demotes after three', () => {
  const good = applyRoiPromotion([], analytics([row()], samples(69, 9)), 'balanced', undefined, '2026-11-20');
  const promoted = applyRoiPromotion(good.entries, analytics([row()], samples(69, 9), '2026-11-21T03:00:00.000Z'), 'balanced', undefined, '2026-11-21');
  assert.equal(promoted.entries[0].status, 'promoted');

  const badRow = row({ roi: -4, wins: 40, losses: 38, netPnl: -4 });
  const badSamples = samples(40, 38);
  let state = promoted.entries;
  let day = 21;
  for (let i = 0; i < 3; i += 1) {
    day += 1;
    const date = `2026-11-${day}`;
    const next = applyRoiPromotion(
      state,
      analytics([badRow], badSamples, `${date}T03:00:00.000Z`),
      'balanced',
      undefined,
      date
    );
    state = next.entries;
    if (i < 2) assert.equal(state[0].status, 'promoted');
  }
  assert.equal(state[0].status, 'demoted');
});

test('rows with no new settled picks for seven days are retired, not deleted', () => {
  const first = applyRoiPromotion([], analytics([row()], samples(69, 9)), 'balanced', undefined, '2026-11-01');
  const stale = applyRoiPromotion(
    first.entries,
    analytics([row({ settled: 78 })], samples(69, 9), '2026-11-10T03:00:00.000Z'),
    'balanced',
    undefined,
    '2026-11-10'
  );

  assert.equal(stale.entries.length, 1);
  assert.equal(stale.entries[0].status, 'retired');
  assert.match(stale.entries[0].reason, /days old/);
});

test('promotions are isolated by strategy', () => {
  const a = applyRoiPromotion([], analytics([row()], samples(69, 9)), 'balanced', undefined, '2026-11-20');
  const promotedA = applyRoiPromotion(a.entries, analytics([row()], samples(69, 9), '2026-11-21T03:00:00.000Z'), 'balanced', undefined, '2026-11-21');

  const bData = analytics([row()], samples(69, 9));
  bData.strategy = 'goals';
  const b = applyRoiPromotion(promotedA.entries, bData, 'goals', undefined, '2026-11-20');
  const b2 = applyRoiPromotion(b.entries, { ...bData, generatedAt: '2026-11-21T03:00:00.000Z' }, 'goals', undefined, '2026-11-21');

  assert.ok(promotedA.entries.some((entry) => entry.status === 'promoted'));
  assert.ok(b.entries.some((entry) => entry.status === 'watch'));
  assert.ok(b2.entries.some((entry) => entry.status === 'promoted'));
  assert.equal(registryKey('balanced', 'angle', '1X2-H'), 'balanced::angle::1X2-H');
});

test('a selection with a zero-crossing ROI interval cannot promote', () => {
  const config: RoiPromotionConfig = { ...DEFAULT_ROI_PROMOTION_CONFIG };
  const mixed = samples(10, 10);
  const result = applyRoiPromotion(
    [],
    analytics([row({ settled: 20, wins: 10, losses: 10, roi: 2 })], mixed),
    'balanced',
    config,
    '2026-11-20'
  );
  assert.equal(result.entries[0].status, 'watch');
  assert.match(result.entries[0].reason, /interval crosses zero/);
});

test('retired rows disappear from the whitelist', () => {
  const entry: RoiRegistryEntry = {
    strategy: 'balanced', source: 'angle', selectionKey: '1X2-H', marketType: '1X2',
    label: 'Home Win', settled: 78, wins: 69, losses: 9, roi: 10.6, roiCiLow: 5, roiCiHigh: 15,
    hitRateCiLow: 70, hitRateCiHigh: 95, avgOdds: 1.25, firstDateIso: '2026-10-01',
    lastDateIso: '2026-11-20', status: 'retired', promotedAt: null, lastSeenDateIso: '2026-10-01',
    qualifyingStreak: 0, failingStreak: 3, reason: 'stale', snapshotDateIso: '2026-11-20',
  };
  assert.deepEqual(promotedWhitelist([entry]), new Set());
});
