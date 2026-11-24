import assert from 'node:assert/strict';
import test from 'node:test';
import {
  frameworkDecisionCopy,
  frameworkStatusLabel,
  REASON_CODE_LABEL,
} from './frameworkCopy.ts';

test('a qualified decision reads as a decision, not an internal status', () => {
  const copy = frameworkDecisionCopy('QUALIFIED');
  assert.equal(copy, 'Clears the value and confidence gates');
  assert.ok(!copy.includes('QUALIFIED'));
});

test('compact status labels never expose internal keys', () => {
  assert.equal(frameworkStatusLabel('QUALIFIED'), 'Clears gates');
  assert.equal(frameworkStatusLabel('CONDITIONAL_REVIEW'), 'Review');
  assert.equal(frameworkStatusLabel(null), 'No decision');
  assert.equal(frameworkStatusLabel('SOMETHING_NEW'), 'No decision');
});

test('reason codes are explained in plain language', () => {
  const copy = frameworkDecisionCopy('REJECTED', ['EDGE_BELOW_MIN', 'STALE_ODDS']);
  assert.equal(
    copy,
    'Fails a hard gate · Model edge below the required margin · Odds are stale'
  );
});

test('unknown codes and missing decisions never leak raw keys', () => {
  assert.ok(!frameworkDecisionCopy('REJECTED', ['MYSTERY_CODE']).includes('MYSTERY'));
  assert.equal(frameworkDecisionCopy(null), 'No framework decision attached');
  assert.equal(frameworkDecisionCopy('SOMETHING_NEW'), 'Framework decision');
});

test('every configured reason code has user-facing wording', () => {
  const codes = [
    'ODDS_BELOW_MIN',
    'EDGE_BELOW_MIN',
    'NON_POSITIVE_EV',
    'STRESS_EV_NON_POSITIVE',
    'MARKET_UNSUITABLE',
    'INSUFFICIENT_CONFIDENCE',
    'EDGE_OUTLIER',
    'SIGNAL_CONFLICT',
    'SUITABILITY_REVIEW',
    'STALE_ODDS',
    'INCOMPLETE_MARKET',
    'PROVIDER_UNAUDITED',
    'UNRESOLVED_RISK_FLAG',
    'NO_MODEL_PROBABILITY',
    'DATA_QUALITY_FAILURE',
    'INDEX_SUM_INVALID',
    'SLATE_CAP_EXCEEDED',
    'FORM_NOT_SUPPORTIVE',
    'SAME_FIXTURE_SECONDARY',
    'INVALID_LEG_COUNT',
    'UNQUALIFIED_LEG',
    'SAME_FIXTURE_NOT_ACCA',
    'ACCA_NON_POSITIVE_EV',
    'SHARED_TEAM_DEPENDENCE',
    'SHARED_COMPETITION_DEPENDENCE',
  ] as const;
  for (const code of codes) {
    assert.ok(REASON_CODE_LABEL[code] && !/[A-Z_]{3,}/.test(REASON_CODE_LABEL[code]));
  }
});
