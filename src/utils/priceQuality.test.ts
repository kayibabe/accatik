import test from 'node:test';
import assert from 'node:assert/strict';
import {
  combinePriceQuality,
  inferPriceQuality,
  isPreMatchFixture,
} from './priceQuality.ts';
import { makeFixture, makeMarket } from './testFactories.ts';

const KICKOFF = Date.UTC(2026, 10, 19, 18, 0);

test('an explicit price quality wins over inference', () => {
  assert.equal(
    inferPriceQuality(
      makeFixture({
        id: 'a',
        status: 'Scheduled',
        priceQuality: 'live',
        pricedAt: new Date(KICKOFF - 60_000).toISOString(),
        kickoffTimestamp: KICKOFF,
        markets: [makeMarket('a-1x2-h', 1.5)],
      })
    ),
    'live'
  );
});

test('a price captured before kickoff is pre-match', () => {
  assert.equal(
    inferPriceQuality(
      makeFixture({
        id: 'a',
        status: 'Scheduled',
        pricedAt: new Date(KICKOFF - 60_000).toISOString(),
        kickoffTimestamp: KICKOFF,
        markets: [makeMarket('a-1x2-h', 1.5)],
      })
    ),
    'prematch'
  );
});

test('a backfilled price captured after kickoff is not pre-match', () => {
  assert.equal(
    inferPriceQuality(
      makeFixture({
        id: 'a',
        status: 'Finished',
        pricedAt: new Date(KICKOFF + 60_000).toISOString(),
        kickoffTimestamp: KICKOFF,
        markets: [makeMarket('a-1x2-h', 1.5)],
      })
    ),
    'live'
  );
});

test('a price with no capture time cannot be verified', () => {
  assert.equal(
    inferPriceQuality(
      makeFixture({
        id: 'a',
        status: 'Scheduled',
        kickoffTimestamp: KICKOFF,
        markets: [makeMarket('a-1x2-h', 1.5)],
      })
    ),
    'unknown'
  );
});

test('a ticket is only pre-match when every leg is', () => {
  assert.equal(combinePriceQuality(['prematch', 'prematch']), 'prematch');
  assert.equal(combinePriceQuality(['prematch', 'unknown']), 'unknown');
  assert.equal(combinePriceQuality(['prematch', 'live']), 'live');
  assert.equal(combinePriceQuality([]), 'unknown');
});

test('only scheduled, resolved fixtures accept new bets', () => {
  assert.equal(
    isPreMatchFixture({ status: 'Scheduled', awaitingResult: false }),
    true
  );
  assert.equal(
    isPreMatchFixture({ status: 'Scheduled', awaitingResult: true }),
    false
  );
  assert.equal(isPreMatchFixture({ status: 'Live' }), false);
  assert.equal(isPreMatchFixture({ status: 'Finished' }), false);
});
