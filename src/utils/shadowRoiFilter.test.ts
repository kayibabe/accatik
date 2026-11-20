import test from 'node:test';
import assert from 'node:assert/strict';
import type { LedgerBreakdownRow } from '../types/ledger.ts';
import {
  SHADOW_ROI_SHORTLIST,
  qualifiesForShadowRoiShortlist,
  selectShadowRoiShortlist,
} from './shadowRoiFilter.ts';

function row(
  label: string,
  overrides: Partial<LedgerBreakdownRow> = {}
): LedgerBreakdownRow {
  return {
    key: label,
    label,
    tickets: 10,
    won: 7,
    lost: 3,
    voided: 0,
    live: 0,
    pending: 0,
    decided: 10,
    hitRate: 70,
    breakEvenHitRate: 50,
    settledStake: 10,
    returns: 12,
    netPnl: 2,
    roi: 20,
    avgOdds: 2,
    avgLegs: 3,
    avgFairProbability: 55,
    avgClv: 0.5,
    ...overrides,
  };
}

test('applies all three monitoring thresholds', () => {
  assert.equal(
    qualifiesForShadowRoiShortlist(row('qualifies', { roi: 25, hitRate: 60, avgClv: 0 })),
    true
  );
  assert.equal(qualifiesForShadowRoiShortlist(row('low roi', { roi: 24.9 })), false);
  assert.equal(qualifiesForShadowRoiShortlist(row('low hit', { hitRate: 59.9 })), false);
  assert.equal(qualifiesForShadowRoiShortlist(row('negative clv', { avgClv: -0.1 })), false);
});

test('excludes rows with unknown ROI, hit rate or CLV', () => {
  assert.equal(qualifiesForShadowRoiShortlist(row('no roi', { roi: null })), false);
  assert.equal(qualifiesForShadowRoiShortlist(row('no hit', { hitRate: null })), false);
  assert.equal(qualifiesForShadowRoiShortlist(row('no clv', { avgClv: null })), false);
});

test('produces the extracted table ranked by ROI descending', () => {
  const rows = [
    row('Most Likely · 3 legs', { roi: 25.6, hitRate: 100, avgClv: 0.6 }),
    row('Goals · 3 legs', { roi: 130.3, hitRate: 66.7, avgClv: 1 }),
    row('Value · 3 legs', { roi: 123.2, hitRate: 60, avgClv: 0.4 }),
    row('No edge', { roi: -10, hitRate: 80, avgClv: 2 }),
  ];

  const selected = selectShadowRoiShortlist(rows);

  assert.deepEqual(
    selected.map((entry) => entry.label),
    ['Goals · 3 legs', 'Value · 3 legs', 'Most Likely · 3 legs']
  );
  assert.deepEqual(rows.map((entry) => entry.label), [
    'Most Likely · 3 legs',
    'Goals · 3 legs',
    'Value · 3 legs',
    'No edge',
  ]);
});

test('uses stable tie-breakers for equal ROI', () => {
  const selected = selectShadowRoiShortlist([
    row('b', { roi: 30, hitRate: 70 }),
    row('a', { roi: 30, hitRate: 70 }),
    row('high hit', { roi: 30, hitRate: 90 }),
  ]);
  assert.deepEqual(selected.map((entry) => entry.label), ['high hit', 'a', 'b']);
});

test('thresholds stay the documented extracted-table rule', () => {
  assert.deepEqual(SHADOW_ROI_SHORTLIST, {
    minRoiPct: 25,
    minHitPct: 60,
    minAvgClvPct: 0,
  });
});
