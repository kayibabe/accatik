import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MAX_LEGS,
  DEFAULT_TARGET_ODDS,
  MAX_LEG_LIMIT,
  MIN_TARGET_ODDS,
  parseMatchDetailRequest,
  parseMaxLegs,
  parseResultFixtureIds,
  parseTargetOdds,
} from './fixtures.ts';

test('result IDs accept strings and numbers and drop duplicates', () => {
  assert.deepEqual(
    parseResultFixtureIds([' 12 ', 13, '12', 'abc', '', '14']),
    ['12', '13', '14']
  );
});

test('a results request never exceeds the upstream ID limit', () => {
  const ids = Array.from({ length: 30 }, (_, index) => index + 1);
  assert.equal(parseResultFixtureIds(ids).length, 20);
});

test('a malformed results body yields no IDs', () => {
  assert.deepEqual(parseResultFixtureIds(undefined), []);
  assert.deepEqual(parseResultFixtureIds('12'), []);
  assert.deepEqual(parseResultFixtureIds({ fixtureIds: ['12'] }), []);
});

test('match detail requires a real matchday and at least one fixture', () => {
  assert.deepEqual(
    parseMatchDetailRequest({ dateIso: '2026-11-17', fixtureIds: ['12'] }),
    { dateIso: '2026-11-17', fixtureIds: ['12'] }
  );

  assert.equal(
    parseMatchDetailRequest({ dateIso: '17/11/2026', fixtureIds: ['12'] }),
    null
  );
  assert.equal(
    parseMatchDetailRequest({ dateIso: '2026-11-17', fixtureIds: [] }),
    null
  );
  assert.equal(parseMatchDetailRequest(null), null);
});

test('target odds default to the balanced shape and never fall below 1.50', () => {
  assert.equal(parseTargetOdds(undefined), DEFAULT_TARGET_ODDS);
  assert.equal(parseTargetOdds('not a number'), DEFAULT_TARGET_ODDS);
  assert.equal(parseTargetOdds(1), MIN_TARGET_ODDS);
  assert.equal(parseTargetOdds(2.8), 2.8);
  assert.equal(parseTargetOdds(500), 100);
  assert.equal(parseTargetOdds(2.834), 2.83);
});

test('max legs defaults to 3 and stays within 1–8', () => {
  assert.equal(parseMaxLegs(undefined), DEFAULT_MAX_LEGS);
  assert.equal(parseMaxLegs(0), 1);
  assert.equal(parseMaxLegs(99), MAX_LEG_LIMIT);
  assert.equal(parseMaxLegs(6), 6);
  assert.equal(parseMaxLegs(3.4), 3);
});
