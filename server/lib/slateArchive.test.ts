import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isFixtureFinal,
  isSlateSettled,
  mergeArchivedPrices,
} from './slateArchive.ts';
import { makeFixture, makeMarket } from '../../src/utils/testFactories.ts';

const HOUR = 1000 * 60 * 60;
const NOW = Date.UTC(2026, 10, 17, 20, 0);

function priced(id: string, overrides = {}) {
  return makeFixture({
    id,
    status: 'Scheduled',
    score: { home: null, away: null },
    kickoffTimestamp: NOW + HOUR,
    markets: [
      makeMarket(`${id}-1x2-h`, 1.6, '1X2', 'Home Win'),
      makeMarket(`${id}-ou-25`, 1.9, 'Goals', 'Over 2.5 Goals'),
    ],
    recommendedPickId: `${id}-1x2-h`,
    ...overrides,
  });
}

test('a future matchday is not settled', () => {
  assert.equal(isFixtureFinal(priced('a'), NOW), false);
  assert.equal(isSlateSettled([priced('a'), priced('b')], NOW), false);
});

test('a finished matchday is settled', () => {
  const finished = priced('a', {
    status: 'Finished',
    statusShort: 'FT',
    score: { home: 2, away: 1 },
  });
  assert.equal(isSlateSettled([finished], NOW), true);
});

test('a match the feed never resolved is sealed after the grace window', () => {
  const stale = priced('a', {
    status: 'Scheduled',
    awaitingResult: true,
    kickoffTimestamp: NOW - 40 * HOUR,
  });
  assert.equal(isFixtureFinal(stale, NOW), true);
});

test('an empty slate is never treated as settled', () => {
  assert.equal(isSlateSettled([], NOW), false);
});

test('a kicked-off fixture keeps the prices it was archived with', () => {
  const archived = priced('a', {
    recommendedPickId: 'a-ou-25',
    priceQuality: 'prematch',
  });
  const fresh = priced('a', {
    status: 'Finished',
    statusShort: 'FT',
    score: { home: 1, away: 1 },
    markets: [makeMarket('a-1x2-h', 1.2, '1X2', 'Home Win')],
    recommendedPickId: 'a-1x2-h',
    priceQuality: 'live',
  });

  const [merged] = mergeArchivedPrices([archived], [fresh]);

  assert.deepEqual(
    merged.markets.map((m) => m.id),
    ['a-1x2-h', 'a-ou-25']
  );
  assert.equal(merged.recommendedPickId, 'a-ou-25');
  assert.equal(merged.status, 'Finished');
  assert.equal(merged.score?.home, 1);
  assert.equal(merged.priceQuality, 'prematch');
});

test('a scheduled fixture still takes the fresh book', () => {
  const archived = priced('a');
  const fresh = priced('a', {
    markets: [makeMarket('a-1x2-h', 1.75, '1X2', 'Home Win')],
    recommendedPickId: 'a-1x2-h',
  });

  const [merged] = mergeArchivedPrices([archived], [fresh]);
  assert.equal(merged.markets[0].odds, 1.75);
});

test('a fixture archived without prices accepts the fresh book', () => {
  const archived = priced('a', {
    status: 'Finished',
    markets: [],
    recommendedPickId: '',
  });
  const fresh = priced('a', { status: 'Finished' });

  const [merged] = mergeArchivedPrices([archived], [fresh]);
  assert.equal(merged.markets.length, 2);
});

test('fixtures that were not archived pass through untouched', () => {
  const fresh = priced('new');
  const [merged] = mergeArchivedPrices([], [fresh]);
  assert.equal(merged, fresh);
});
