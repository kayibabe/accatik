import test from 'node:test';
import assert from 'node:assert/strict';
import type { Fixture } from '../../src/types/fixtures.ts';
import type { RoiRegistryEntry } from '../../src/types/analytics.ts';
import { buildQualifiedPickRows } from './qualifiedPicks.ts';
import { makeFixture, makeMarket } from '../../src/utils/testFactories.ts';

function entry(source: 'angle' | 'cover' | 'note', selectionKey: string, status: RoiRegistryEntry['status'] = 'promoted'): RoiRegistryEntry {
  return {
    strategy: 'balanced', source, selectionKey, marketType: '1X2', label: selectionKey,
    settled: 78, wins: 69, losses: 9, roi: 10.6, roiCiLow: 1, roiCiHigh: 18,
    hitRateCiLow: 70, hitRateCiHigh: 95, avgOdds: 1.25, firstDateIso: '2026-10-01',
    lastDateIso: '2026-11-20', status, promotedAt: status === 'promoted' ? '2026-11-20' : null,
    lastSeenDateIso: '2026-11-20', qualifyingStreak: 2, failingStreak: 0,
    reason: status === 'promoted' ? 'Promoted: positive clustered ROI.' : 'Not qualified yet.',
    snapshotDateIso: '2026-11-20',
  };
}

function fixture(): Fixture {
  return makeFixture({
    id: 'q',
    status: 'Scheduled',
    statusShort: 'NS',
    priceQuality: 'prematch',
    score: { home: null, away: null },
    kickoffTimestamp: Date.UTC(2026, 10, 20, 16),
    recommendedPickId: 'q-1x2-h',
    modelAdvice: 'Away Win',
    analystNoteMarketId: 'q-1x2-a',
    markets: [
      makeMarket('q-1x2-h', 1.35, '1X2', 'Home FC Win'),
      makeMarket('q-ou-25', 1.2, 'Goals', 'Over 2.5 Goals'),
      makeMarket('q-1x2-a', 2.3, '1X2', 'Away FC Win'),
    ],
  });
}

const now = Date.UTC(2026, 10, 20, 10);

test('joins all three cards and promotes only whitelisted pairs', () => {
  const rows = buildQualifiedPickRows(
    [fixture()],
    [entry('angle', '1X2-H'), entry('cover', 'GOALS-O2.5', 'watch')],
    'balanced',
    now
  );

  assert.deepEqual(
    rows.map((row) => `${row.source}:${row.selectionKey}`),
    ['angle:1X2-H', 'cover:GOALS-O2.5', 'note:1X2-A']
  );
  assert.equal(rows[0].eligibleForAcca, true);
  assert.equal(rows[0].status, 'promoted');
  assert.equal(rows[0].fairProbability, null);
  assert.equal(rows[1].eligibleForAcca, false);
  assert.match(rows[1].reason, /Not qualified yet/);
  assert.equal(rows[2].status, 'untracked');
  assert.match(rows[2].reason, /No registry row/);
});

test('excludes started fixtures and non-prematch prices', () => {
  const started = fixture();
  started.kickoffTimestamp = now - 1000;
  const live = fixture();
  live.id = 'live';
  live.priceQuality = 'live';

  const rows = buildQualifiedPickRows(
    [started, live],
    [entry('angle', '1X2-H'), entry('cover', 'GOALS-O2.5'), entry('note', '1X2-A')],
    'balanced',
    now
  );

  assert.equal(rows.length, 6);
  assert.ok(rows.every((row) => !row.eligibleForAcca));
  assert.ok(rows.some((row) => row.reason.includes('already kicked off')));
  assert.ok(rows.some((row) => row.reason.includes('not prematch-confirmed')));
});

test('uses stored model advice only, never a derived note', () => {
  const noAdvice = fixture();
  noAdvice.modelAdvice = undefined;
  noAdvice.analystNoteMarketId = undefined;
  const rows = buildQualifiedPickRows([noAdvice], [], 'balanced', now);
  assert.equal(rows.some((row) => row.source === 'note'), false);
});
