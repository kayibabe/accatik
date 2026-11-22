import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAppSearch, parseAppUrlState } from './urlState.ts';

test('unknown tabs fall back to the slate', () => {
  assert.equal(parseAppUrlState('?tab=nope').tab, 'slate');
  assert.equal(parseAppUrlState('?tab=analytics').tab, 'analytics');
});

test('dates are validated and fall back to the supplied default', () => {
  assert.equal(parseAppUrlState('?date=2026-11-22').date, '2026-11-22');
  assert.equal(parseAppUrlState('?date=javascript:alert', '2026-11-21').date, '2026-11-21');
});

test('search round-trips tab, date, preset and section', () => {
  const state = {
    tab: 'analytics' as const,
    date: '2026-11-22',
    preset: 'safe' as const,
    section: 'markets',
  };
  assert.deepEqual(parseAppUrlState(buildAppSearch(state)), state);
});

test('default preset is omitted from the URL', () => {
  assert.equal(
    buildAppSearch({ tab: 'slate', preset: 'default' }),
    '?tab=slate'
  );
});
