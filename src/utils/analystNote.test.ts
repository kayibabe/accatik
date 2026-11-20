import test from 'node:test';
import assert from 'node:assert/strict';
import { getAnalystNote, resolveAnalystNoteMarket } from './analystNote.ts';
import { makeFixture, makeMarket } from './testFactories.ts';

const markets = () => [
  makeMarket('f-1x2-h', 2.0, '1X2', 'Home FC Win'),
  makeMarket('f-1x2-d', 3.4, '1X2', 'Draw'),
  makeMarket('f-1x2-a', 4.0, '1X2', 'Away FC Win'),
  makeMarket('f-dc-1x', 1.4, 'Double Chance', '1X (Home or Draw)'),
  makeMarket('f-ou-15', 1.2, 'Goals', 'Over 1.5 Goals'),
  makeMarket('f-btts-y', 1.8, 'BTTS', 'BTTS Yes'),
];

const fixture = (overrides = {}) =>
  makeFixture({ id: 'f', markets: markets(), ...overrides });

test('captured note market is used before parsing the advice text', () => {
  const resolved = resolveAnalystNoteMarket(
    fixture({ analystNoteMarketId: 'f-btts-y', modelAdvice: 'Over 1.5 Goals' }),
    'Over 1.5 Goals'
  );
  assert.equal(resolved?.id, 'f-btts-y');
});

test('goals and double-chance advice map to their priced markets', () => {
  assert.equal(
    resolveAnalystNoteMarket(fixture(), 'Over 1.5 Goals')?.id,
    'f-ou-15'
  );
  assert.equal(
    resolveAnalystNoteMarket(fixture(), 'Double Chance: Home or Draw')?.id,
    'f-dc-1x'
  );
});

test('one-sided 1X2 advice maps to the matching outcome', () => {
  assert.equal(resolveAnalystNoteMarket(fixture(), 'Away Win')?.id, 'f-1x2-a');
  assert.equal(resolveAnalystNoteMarket(fixture(), 'Draw')?.id, 'f-1x2-d');
});

test('generic guidance is never treated as a pick', () => {
  assert.equal(
    resolveAnalystNoteMarket(
      fixture(),
      'Use Double Chance or Over 1.5 Goals to balance ticket variance.'
    ),
    null
  );
});

test('persisted advice wins, with the fresh API note as fallback', () => {
  assert.equal(
    getAnalystNote(
      fixture({ modelAdvice: 'Home Win', analystNoteMarketId: 'f-1x2-h' }),
      'Away Win'
    ),
    'Home Win'
  );
  assert.equal(getAnalystNote(fixture(), '  Away Win  '), 'Away Win');
});

test('every fixture gets an automatic board-derived note', () => {
  const note = getAnalystNote(fixture());
  assert.match(note ?? '', /Price board's clearest line is Over 1\.5 Goals/);
  assert.match(note ?? '', /Recent form favours Home FC/);
});

test('generic on-demand fallback does not replace the derived note', () => {
  const note = getAnalystNote(
    fixture(),
    'Use Double Chance or Over 1.5 Goals to balance ticket variance.'
  );
  assert.doesNotMatch(note ?? '', /balance ticket variance/);
});
