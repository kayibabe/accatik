import test from 'node:test';
import assert from 'node:assert/strict';
import { aiPicksSummary } from './aiPicksSummary.ts';

const pick = (aiScore: number, evStress: number, band: 'High' | 'Speculative') => ({ aiScore, evStress, band });

test('ranked-picks summary counts only the picks behind the current score bar', () => {
  const summary = aiPicksSummary(
    [pick(79, 0.143, 'Speculative'), pick(65, 0.09, 'High')],
    'Tuesday, November 24, 2026',
    60
  );
  assert.match(summary, /^2 selections clear the model-score bar of 60/);
  assert.match(summary, /Average AI score 72\/100/);
  assert.match(summary, /best stressed EV 14\.3%/);
  assert.match(summary, /1 high\/solid-confidence estimates/);
});

test('an empty visible list never reports eligible picks as cleared', () => {
  assert.match(
    aiPicksSummary([], 'Tuesday, November 24, 2026', 80),
    /^No priced selection .* clears the model-score bar of 80/
  );
});

test('a zero score bar leaves the gate label uncluttered', () => {
  assert.match(aiPicksSummary([], 'today', 0), /clears the stressed-EV gate/);
});
