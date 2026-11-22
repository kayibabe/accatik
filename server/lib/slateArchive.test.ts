import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chunkFixturesForStorage,
  isFixtureFinal,
  isSlateSettled,
  mergeArchivedPrices,
  parseArchiveFixturePayloads,
  recaptureFixturePrices,
} from './slateArchive.ts';
import { appendFeaturedPickSnapshots } from '../../src/utils/featuredPickSnapshot.ts';
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

test('an explicit recapture replaces kicked-off prices and restamps them', () => {
  const archived = priced('a', {
    status: 'Finished',
    score: { home: 1, away: 1 },
    recommendedPickId: 'a-ou-25',
    priceQuality: 'prematch',
    pricedAt: '2026-11-21T08:18:00.000Z',
    modelDataAt: '2026-11-21T08:00:00.000Z',
    modelAdvice: 'Home',
  });
  const fresh = priced('a', {
    status: 'Finished',
    score: { home: 1, away: 1 },
    markets: [makeMarket('a-1x2-a', 1.25, '1X2', 'Away Win')],
    recommendedPickId: 'a-1x2-a',
    priceQuality: 'live',
    formHome: '—',
  });

  const [recaptured] = recaptureFixturePrices([fresh], [archived], NOW);

  assert.deepEqual(
    recaptured.markets.map((market) => market.id),
    ['a-1x2-a']
  );
  assert.equal(recaptured.recommendedPickId, 'a-1x2-a');
  assert.equal(recaptured.priceQuality, 'live');
  assert.equal(recaptured.pricedAt, new Date(NOW).toISOString());
  assert.equal(recaptured.modelDataAt, archived.modelDataAt);
  assert.equal(recaptured.modelAdvice, archived.modelAdvice);
  assert.equal(recaptured.formHome, archived.formHome);
});

test('recapture carries the captured pick history into the new price era', () => {
  const archived = appendFeaturedPickSnapshots([priced('a')], NOW)[0];
  const fresh = priced('a', {
    markets: [makeMarket('a-1x2-a', 1.35, '1X2', 'Away Win')],
    recommendedPickId: 'a-1x2-a',
  });

  const [recaptured] = recaptureFixturePrices([fresh], [archived], NOW + HOUR);
  assert.equal(recaptured.featuredPickSnapshots?.length, 5);

  const [merged] = mergeArchivedPrices([archived], [fresh]);
  assert.equal(merged.featuredPickSnapshots?.length, 5);
});

test('recapture leaves an unpriced fixture unstamped', () => {
  const fresh = priced('a', { markets: [], recommendedPickId: '' });
  const [recaptured] = recaptureFixturePrices([fresh], [], NOW);
  assert.equal(recaptured.pricedAt, undefined);
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

test('archive chunks stay under the Appwrite document limit and round-trip', () => {
  const fixtures = Array.from({ length: 12 }, (_, index) =>
    makeFixture({
      id: `fixture-${index}`,
      kickoffTimestamp: index,
      markets: [makeMarket(`market-${index}`, 1.8 + index / 100)],
    })
  );
  const maxChars = 1200;

  const chunks = chunkFixturesForStorage(fixtures, maxChars);

  assert.ok(chunks.length > 1, 'expected more than one chunk');
  for (const chunk of chunks) {
    assert.ok(JSON.stringify(chunk).length <= maxChars);
  }
  assert.deepEqual(
    parseArchiveFixturePayloads(chunks).map((fixture) => fixture.id),
    fixtures.map((fixture) => fixture.id)
  );
});

test('an empty slate still writes one distinguishable chunk', () => {
  assert.deepEqual(chunkFixturesForStorage([]), ['[]']);
});

test('archive parsing prefers chunked copies and ignores corrupt documents', () => {
  const legacy = makeFixture({ id: 'shared', homeTeam: 'Legacy FC' });
  const chunked = makeFixture({
    id: 'shared',
    homeTeam: 'Chunked FC',
    kickoffTimestamp: 1,
  });
  const later = makeFixture({ id: 'later', kickoffTimestamp: 2 });

  const fixtures = parseArchiveFixturePayloads([
    JSON.stringify(legacy),
    '{not valid json',
    JSON.stringify([chunked, later]),
  ]);

  assert.deepEqual(fixtures.map((fixture) => fixture.id), ['shared', 'later']);
  assert.equal(fixtures[0].homeTeam, 'Chunked FC');
});
