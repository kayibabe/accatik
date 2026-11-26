import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAppSearch, parseAppUrlState } from './urlState.ts';

test('unknown tabs fall back to the slate', () => {
  assert.equal(parseAppUrlState('?tab=nope').tab, 'slate');
  assert.equal(parseAppUrlState('?tab=roi').tab, 'slate');
  assert.equal(parseAppUrlState('?tab=analytics').tab, 'analytics');
  assert.equal(parseAppUrlState('?tab=pick-guide').tab, 'pick-guide');
});

test('dates are validated and fall back to the supplied default', () => {
  assert.equal(parseAppUrlState('?date=2026-11-22').date, '2026-11-22');
  assert.equal(parseAppUrlState('?date=javascript:alert', '2026-11-21').date, '2026-11-21');
});

test('ROI research deep links keep their section under the new Research page', () => {
  assert.equal(parseAppUrlState('?tab=roi-research').tab, 'roi-research');
  for (const section of ['overview', 'cards', 'table', 'combination-roi']) {
    const state = parseAppUrlState(`?tab=positive-reads&section=${section}`);
    assert.equal(state.tab, 'roi-research');
    assert.equal(state.section, section);
  }
  assert.equal(parseAppUrlState('?tab=positive-reads').tab, 'positive-reads');
});

test('interim combination ROI links open the new Research page', () => {
  const state = parseAppUrlState('?tab=combination-roi');
  assert.equal(state.tab, 'roi-research');
  assert.equal(state.section, 'combination-roi');
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
