import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fmtCount,
  fmtFixed,
  fmtMwk,
  fmtOdds,
  fmtPercent,
  fmtShortDate,
  fmtSignedPercent,
  fmtUnits,
} from './format.ts';

test('missing numbers render as an em dash everywhere', () => {
  assert.equal(fmtFixed(null), '—');
  assert.equal(fmtFixed(undefined), '—');
  assert.equal(fmtFixed(Number.NaN), '—');
  assert.equal(fmtPercent(null), '—');
  assert.equal(fmtUnits(undefined), '—');
  assert.equal(fmtOdds(null), '—');
});

test('percentages and signed percentages agree on precision', () => {
  assert.equal(fmtPercent(64.28), '64.3%');
  assert.equal(fmtSignedPercent(5.42), '+5.4%');
  assert.equal(fmtSignedPercent(-5.42), '-5.4%');
  assert.equal(fmtSignedPercent(0), '0.0%');
});

test('units and odds carry consistent signs and precision', () => {
  assert.equal(fmtUnits(2.4), '+2.40u');
  assert.equal(fmtUnits(-0.567), '-0.57u');
  assert.equal(fmtOdds(2.5), '2.50');
});

test('money uses grouped thousands and the existing MK prefix', () => {
  assert.equal(fmtMwk(1234567.5), 'MK 1,234,567.50');
  assert.equal(fmtCount(1280), '1,280');
});

test('short date is stable for ISO input', () => {
  assert.equal(fmtShortDate('2026-11-22T10:00:00Z'), '22 Nov');
  assert.equal(fmtShortDate(undefined), '—');
});
