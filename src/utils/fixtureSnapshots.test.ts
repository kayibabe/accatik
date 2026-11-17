import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pruneSnapshots,
  withSnapshot,
  type FixtureSnapshots,
} from './fixtureSnapshots.ts';
import { makeFixture } from './testFactories.ts';

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
