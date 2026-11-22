import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeFilterCount,
  detectFilterPreset,
  presetFilters,
} from './slateFilterPresets.ts';
import { DEFAULT_SLATE_FILTER_STATE } from './slateFilterState.ts';

test('presets return fresh copies of their filter set', () => {
  const first = presetFilters('safe');
  first.marketSelections.push('1X2-H');
  assert.deepEqual(presetFilters('safe').marketSelections, []);
});

test('preset detection recognises each preset and edits', () => {
  assert.equal(detectFilterPreset(DEFAULT_SLATE_FILTER_STATE), 'default');
  assert.equal(detectFilterPreset(presetFilters('value')), 'value');
  assert.equal(
    detectFilterPreset({ ...presetFilters('value'), minProbability: 60 }),
    'custom'
  );
});

test('active count covers every dimension and the advanced subset', () => {
  const filters = {
    ...DEFAULT_SLATE_FILTER_STATE,
    minProbability: 70,
    minModelEdge: 5,
    minOddsInput: '1.80',
    marketSelections: ['1X2-H'],
  };
  assert.equal(activeFilterCount(filters), 4);
  assert.equal(activeFilterCount(filters, 'advanced'), 2);
  assert.equal(activeFilterCount(DEFAULT_SLATE_FILTER_STATE), 0);
});
