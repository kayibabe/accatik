import test from 'node:test';
import assert from 'node:assert/strict';
import type { Fixture } from '../types/fixtures.ts';
import {
  appendFeaturedPickSnapshots,
  resolveFeaturedPick,
} from './featuredPickSnapshot.ts';
import { makeFixture, makeMarket } from './testFactories.ts';

const CAPTURE_MS = Date.UTC(2026, 10, 16, 10, 0);

function fixtureWithCover(): Fixture {
  return makeFixture({
    id: 'f',
    recommendedPickId: 'f-1x2-h',
    markets: [
      makeMarket('f-1x2-h', 1.8, '1X2', 'Home Win'),
      makeMarket('f-dc-1x', 1.25, 'Double Chance', '1X (Home or Draw)'),
    ],
  });
}

test('a capture freezes the cover for every strategy', () => {
  const captured = appendFeaturedPickSnapshots([fixtureWithCover()], CAPTURE_MS)[0];
  const snapshots = captured.featuredPickSnapshots ?? [];

  assert.equal(snapshots.length, 5);
  assert.deepEqual(
    snapshots.map((snapshot) => snapshot.strategy).sort(),
    ['balanced', 'favorites', 'goals', 'high-yield', 'probability']
  );
  assert.equal(snapshots[0].cover?.marketId, 'f-dc-1x');
  assert.equal(snapshots[0].cover?.odds, 1.25);
  assert.equal(snapshots[0].cover?.selectionKey, 'DC-1X');
});

test('re-appending the same capture does not duplicate history', () => {
  const first = appendFeaturedPickSnapshots([fixtureWithCover()], CAPTURE_MS)[0];
  const second = appendFeaturedPickSnapshots([first], CAPTURE_MS)[0];

  assert.equal(second.featuredPickSnapshots?.length, 5);
});

test('a recapture keeps the earlier cover as a settleable pick', () => {
  const captured = appendFeaturedPickSnapshots([fixtureWithCover()], CAPTURE_MS)[0];
  const recaptured = appendFeaturedPickSnapshots(
    [
      {
        ...captured,
        // The new book no longer offers a higher-probability different-type
        // outcome, so a live recompute would find no cover at all.
        markets: [makeMarket('f-1x2-a', 1.05, '1X2', 'Away Win')],
      },
    ],
    CAPTURE_MS + 60_000
  )[0];

  assert.equal(recaptured.featuredPickSnapshots?.length, 10);
  const cover = resolveFeaturedPick(recaptured, 'balanced', 'cover');
  assert.equal(cover?.id, 'f-dc-1x');
  assert.equal(cover?.odds, 1.25);
  assert.equal(cover?.label, '1X (Home or Draw)');
});

test('a repriced live market cannot rewrite the captured odds', () => {
  const captured = appendFeaturedPickSnapshots([fixtureWithCover()], CAPTURE_MS)[0];
  const repriced = {
    ...captured,
    markets: [
      makeMarket('f-1x2-h', 1.7, '1X2', 'Home Win'),
      makeMarket('f-dc-1x', 1.1, 'Double Chance', '1X (Home or Draw)'),
    ],
  };

  const cover = resolveFeaturedPick(repriced, 'balanced', 'cover');
  assert.equal(cover?.id, 'f-dc-1x');
  assert.equal(cover?.odds, 1.25);
});

test('archives without snapshots still recompute the cover', () => {
  const cover = resolveFeaturedPick(fixtureWithCover(), 'balanced', 'cover');
  assert.equal(cover?.id, 'f-dc-1x');
});
