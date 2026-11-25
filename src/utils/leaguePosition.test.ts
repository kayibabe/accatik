import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtOrdinal, formatLeaguePosition } from './leaguePosition.ts';

test('ordinals use the right suffix, including the teen exception', () => {
  assert.equal(fmtOrdinal(1), '1st');
  assert.equal(fmtOrdinal(2), '2nd');
  assert.equal(fmtOrdinal(3), '3rd');
  assert.equal(fmtOrdinal(4), '4th');
  assert.equal(fmtOrdinal(11), '11th');
  assert.equal(fmtOrdinal(12), '12th');
  assert.equal(fmtOrdinal(13), '13th');
  assert.equal(fmtOrdinal(21), '21st');
  assert.equal(fmtOrdinal(null), '—');
  assert.equal(fmtOrdinal(undefined), '—');
});

test('formats both league positions on one line', () => {
  assert.equal(
    formatLeaguePosition({ positionHome: 4, positionAway: 11 }),
    'League position: Home 4th / Away 11th'
  );
});

test('keeps the line when only one side has a position', () => {
  assert.equal(
    formatLeaguePosition({ positionHome: 2, positionAway: null }),
    'League position: Home 2nd / Away —'
  );
});

test('hides the line when no standings were captured', () => {
  assert.equal(
    formatLeaguePosition({ positionHome: null, positionAway: undefined }),
    null
  );
});
