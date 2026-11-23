import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateValue } from './value.ts';
import type { QualificationCandidate } from './qualification.ts';
import { confidencePasses, qualifyCandidate } from './qualification.ts';

function candidate(
  overrides: Partial<QualificationCandidate> = {}
): QualificationCandidate {
  return {
    market: '1X2-H',
    dataOk: true,
    flags: [],
    value: evaluateValue({ pModel: 0.7, pFair: 0.5, odds: 2 }),
    formHome: 70,
    formAway: 50,
    model1x2: { home: 0.5, draw: 0.25, away: 0.25 },
    oddsAgeOk: true,
    marketComplete: true,
    usesProviderProb: false,
    providerAudited: false,
    criticalFlags: [],
    confidenceOk: true,
    confidence: 'Medium',
    ...overrides,
  };
}

test('a candidate that passes every gate is QUALIFIED', () => {
  assert.deepEqual(qualifyCandidate(candidate()), {
    status: 'QUALIFIED',
    reasonCodes: [],
  });
});

test('data validation failure is INSUFFICIENT_DATA before anything else', () => {
  assert.deepEqual(qualifyCandidate(candidate({ dataOk: false })), {
    status: 'INSUFFICIENT_DATA',
    reasonCodes: ['DATA_QUALITY_FAILURE'],
  });
});

test('FX-V06: an invalid index pair is INSUFFICIENT_DATA', () => {
  assert.deepEqual(
    qualifyCandidate(candidate({ flags: ['INDEX_SUM_INVALID'] })),
    { status: 'INSUFFICIENT_DATA', reasonCodes: ['DATA_QUALITY_FAILURE'] }
  );
});

test('FX-V04: no model probability is SCREEN_ONLY', () => {
  assert.deepEqual(qualifyCandidate(candidate({ value: null })), {
    status: 'SCREEN_ONLY',
    reasonCodes: ['NO_MODEL_PROBABILITY'],
  });
});

test('FX-V02: the odds floor rejects before suitability is considered', () => {
  const result = qualifyCandidate(
    candidate({
      value: evaluateValue({ pModel: 0.85, pFair: 0.65, odds: 1.29 }),
    })
  );
  assert.equal(result.status, 'REJECTED');
  assert.ok(result.reasonCodes.includes('ODDS_BELOW_MIN'));
});

test('FX-V03: the edge gate rejects a small edge', () => {
  const result = qualifyCandidate(
    candidate({
      value: evaluateValue({ pModel: 0.7, pFair: 0.652, odds: 1.5 }),
    })
  );
  assert.deepEqual(result, { status: 'REJECTED', reasonCodes: ['EDGE_BELOW_MIN'] });
});

test('a negative EV or stressed EV is rejected', () => {
  const result = qualifyCandidate(
    candidate({
      value: evaluateValue({ pModel: 0.6, pFair: 0.4, odds: 1.6 }),
    })
  );
  assert.equal(result.status, 'REJECTED');
  assert.ok(result.reasonCodes.includes('STRESS_EV_NON_POSITIVE'));
});

test('FX-V01: an outlier resting on an unaudited provider is held', () => {
  const result = qualifyCandidate(
    candidate({
      value: evaluateValue({ pModel: 0.9, pFair: 0.4, odds: 2 }),
      usesProviderProb: true,
      providerAudited: false,
    })
  );
  assert.equal(result.status, 'CONDITIONAL_REVIEW');
  assert.deepEqual(result.reasonCodes, ['EDGE_OUTLIER', 'PROVIDER_UNAUDITED']);
});

test('FX-V05: a one-sided market is held for review', () => {
  const result = qualifyCandidate(candidate({ marketComplete: false }));
  assert.deepEqual(result, {
    status: 'CONDITIONAL_REVIEW',
    reasonCodes: ['INCOMPLETE_MARKET'],
  });
});

test('stale odds hold a selection even when the value gates pass', () => {
  const result = qualifyCandidate(candidate({ oddsAgeOk: false }));
  assert.deepEqual(result, {
    status: 'CONDITIONAL_REVIEW',
    reasonCodes: ['STALE_ODDS'],
  });
});

test('an open critical flag holds a selection', () => {
  const result = qualifyCandidate(candidate({ criticalFlags: ['injury'] }));
  assert.deepEqual(result, {
    status: 'CONDITIONAL_REVIEW',
    reasonCodes: ['UNRESOLVED_RISK_FLAG'],
  });
});

test('a confidence failure is a rejection', () => {
  const result = qualifyCandidate(candidate({ confidenceOk: false }));
  assert.deepEqual(result, {
    status: 'REJECTED',
    reasonCodes: ['INSUFFICIENT_CONFIDENCE'],
  });
});

test('a reject-action suitability rule rejects the market', () => {
  const result = qualifyCandidate(
    candidate({ market: 'BTTS-YES', flags: ['ONE_SIDED_ATTACK'] })
  );
  assert.deepEqual(result, {
    status: 'REJECTED',
    reasonCodes: ['MARKET_UNSUITABLE'],
  });
});

test('a review-action suitability rule holds the market', () => {
  const result = qualifyCandidate(
    candidate({ market: 'GOALS-O2.5', flags: ['ONE_SIDED_ATTACK'] })
  );
  assert.deepEqual(result, {
    status: 'CONDITIONAL_REVIEW',
    reasonCodes: ['SUITABILITY_REVIEW'],
  });
});

test('FX-V08: a draw-risk home win is held for review', () => {
  const result = qualifyCandidate(
    candidate({
      market: '1X2-H',
      flags: ['DRAW_RISK'],
      model1x2: { home: 0.45, draw: 0.45, away: 0.1 },
    })
  );
  assert.equal(result.status, 'CONDITIONAL_REVIEW');
  assert.deepEqual(result.reasonCodes, ['SUITABILITY_REVIEW']);
});

test('FX-V09: a Double Chance side without the stronger form is held', () => {
  const result = qualifyCandidate(
    candidate({
      market: 'DC-1X',
      formHome: 40,
      formAway: 60,
    })
  );
  assert.deepEqual(result, {
    status: 'CONDITIONAL_REVIEW',
    reasonCodes: ['FORM_NOT_SUPPORTIVE'],
  });
});

test('the §10.2 model-over-draw condition is enforced', () => {
  const result = qualifyCandidate(
    candidate({
      market: '1X2-H',
      model1x2: { home: 0.4, draw: 0.45, away: 0.15 },
    })
  );
  assert.deepEqual(result, {
    status: 'CONDITIONAL_REVIEW',
    reasonCodes: ['SUITABILITY_REVIEW'],
  });
});

test('confidence classes are compared against the configured minimum', () => {
  assert.equal(confidencePasses('High', 'Low'), true);
  assert.equal(confidencePasses('Low', 'Low'), true);
  assert.equal(confidencePasses('Insufficient evidence', 'Low'), false);
});
