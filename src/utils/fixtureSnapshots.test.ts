import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeFixturesIntoSnapshots,
  pruneSnapshots,
  resolveSettlementPool,
  withSnapshot,
  type FixtureSnapshots,
} from './fixtureSnapshots.ts';
import { makeFixture, makeLeg, makeTicket } from './testFactories.ts';

function slate(dateIso: string) {
  return [
    makeFixture({
      id: `${dateIso}-1`,
      matchDateIso: dateIso,
      score: { home: 1, away: 0 },
    }),
  ];
}

function seed(dates: string[]): FixtureSnapshots {
  const snapshots: FixtureSnapshots = {};
  for (const date of dates) snapshots[date] = slate(date);
  return snapshots;
}

const EIGHT = [
  '2026-11-01',
  '2026-11-02',
  '2026-11-03',
  '2026-11-04',
  '2026-11-05',
  '2026-11-06',
  '2026-11-07',
  '2026-11-08',
];

test('keeps every matchday while under the retention window', () => {
  const snapshots = seed(EIGHT);
  assert.equal(Object.keys(pruneSnapshots(snapshots)).length, 8);
});

test('pruning drops the oldest matchdays first', () => {
  const snapshots = seed([...EIGHT, '2026-11-09']);
  assert.deepEqual(
    Object.keys(pruneSnapshots(snapshots)).sort(),
    EIGHT.slice(1).concat('2026-11-09')
  );
});

test('a saved slip keeps its matchday past the retention window', () => {
  const snapshots = seed([...EIGHT, '2026-11-09']);
  const kept = pruneSnapshots(snapshots, ['2026-11-01']);

  assert.ok(kept['2026-11-01'], 'saved slip matchday survives');
  assert.ok(kept['2026-11-09'], 'newest matchday survives');
  assert.equal(Object.keys(kept).length, 8);
});

test('a snapshot is not stored for an empty matchday', () => {
  assert.deepEqual(withSnapshot({}, '2026-11-10', []), {});
});

function scheduledFixture(id: string, matchDateIso = '2026-11-16') {
  return makeFixture({
    id,
    matchDateIso,
    status: 'Scheduled',
    statusShort: 'NS',
    score: { home: null, away: null },
  });
}

function finishedFixture(id: string, matchDateIso = '2026-11-16') {
  return makeFixture({
    id,
    matchDateIso,
    status: 'Finished',
    statusShort: 'FT',
    score: { home: 2, away: 0 },
  });
}

test('a finished live fixture outranks the slip’s pre-kickoff snapshot', () => {
  const ticket = makeTicket({
    id: 'slip',
    dateIso: '2026-11-16',
    legs: [makeLeg('f1', 'f1-1x2-h', 1.5)],
  });
  const snapshots: FixtureSnapshots = { '2026-11-16': [scheduledFixture('f1')] };

  const pool = resolveSettlementPool(ticket, snapshots, [finishedFixture('f1')]);

  assert.equal(pool.length, 1);
  assert.equal(pool[0].status, 'Finished');
  assert.equal(pool[0].score?.home, 2);
});

test('a finished copy in any snapshot settles the leg', () => {
  const ticket = makeTicket({
    id: 'slip',
    dateIso: '2026-11-16',
    legs: [makeLeg('f1', 'f1-1x2-h', 1.5)],
  });
  const snapshots: FixtureSnapshots = {
    '2026-11-16': [scheduledFixture('f1')],
    '2026-11-17': [finishedFixture('f1', '2026-11-17')],
  };

  const pool = resolveSettlementPool(ticket, snapshots, []);
  assert.equal(pool[0]?.status, 'Finished');
});

test('a stale scheduled snapshot never downgrades a finished result', () => {
  const ticket = makeTicket({
    id: 'slip',
    dateIso: '2026-11-16',
    legs: [makeLeg('f1', 'f1-1x2-h', 1.5)],
  });
  const snapshots: FixtureSnapshots = {
    '2026-11-16': [scheduledFixture('f1')],
    '2026-11-18': [finishedFixture('f1', '2026-11-18')],
    '2026-11-19': [scheduledFixture('f1', '2026-11-19')],
  };

  const pool = resolveSettlementPool(ticket, snapshots, []);
  assert.equal(pool[0]?.status, 'Finished');
});

test('the settlement pool only carries fixtures referenced by the slip', () => {
  const ticket = makeTicket({
    id: 'slip',
    dateIso: '2026-11-16',
    legs: [makeLeg('f1', 'f1-1x2-h', 1.5), makeLeg('f2', 'f2-1x2-h', 1.6)],
  });
  const snapshots: FixtureSnapshots = {
    '2026-11-16': [
      finishedFixture('f1'),
      finishedFixture('f2'),
      finishedFixture('unrelated'),
    ],
  };

  assert.deepEqual(
    resolveSettlementPool(ticket, snapshots, [])
      .map((fixture) => fixture.id)
      .sort(),
    ['f1', 'f2']
  );
});

test('refreshed results are merged into the local snapshot archive', () => {
  const snapshots: FixtureSnapshots = { '2026-11-16': [scheduledFixture('f1')] };

  const merged = mergeFixturesIntoSnapshots(snapshots, [
    finishedFixture('f1'),
    finishedFixture('f2'),
  ]);

  assert.equal(merged['2026-11-16'][0].status, 'Finished');
  assert.equal(merged['2026-11-16'][1].id, 'f2');
  assert.equal(snapshots['2026-11-16'][0].status, 'Scheduled');
});

test('a refresh can never replace a result with an older scheduled copy', () => {
  const snapshots: FixtureSnapshots = { '2026-11-16': [finishedFixture('f1')] };

  const merged = mergeFixturesIntoSnapshots(snapshots, [scheduledFixture('f1')]);
  assert.equal(merged, snapshots);
});

test('a refreshed result for an unknown matchday adds that matchday', () => {
  const merged = mergeFixturesIntoSnapshots({}, [finishedFixture('f9', '2026-11-15')]);
  assert.equal(merged['2026-11-15'][0].id, 'f9');
});
