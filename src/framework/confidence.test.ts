import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessMarketConfidence,
  probabilityStandardError,
  type MarketConfidenceInput,
} from './confidence.ts';

const baseInput: MarketConfidenceInput = {
  base: 'High',
  market: '1X2-H',
  pModel: 0.7,
  sampleSize: 20,
  oddsAgeSeconds: 0,
};

// These cases assert the downgrade rules themselves, so pin the original
// thresholds instead of inheriting the product's relaxed defaults.
const strictConfig = {
  confidenceStandardErrorCeiling: 0.15,
  maxOddsAgeSeconds: 2 * 60 * 60,
  minMarketCalibrationSamples: 100,
  marketCalibrationBrierCeiling: 0.25,
};

test('probability uncertainty is the standard error of a proportion', () => {
  assert.equal(probabilityStandardError(0.5, 100), 0.05);
  assert.ok(probabilityStandardError(0.5, 10) > probabilityStandardError(0.9, 10));
  assert.equal(probabilityStandardError(0.5, 0), Number.POSITIVE_INFINITY);
});

test('a noisy market probability degrades fixture confidence', () => {
  const result = assessMarketConfidence(
    { ...baseInput, pModel: 0.5, sampleSize: 10 },
    strictConfig
  );
  assert.equal(result.confidence, 'Medium');
  assert.deepEqual(result.downgrades, ['SAMPLE_UNCERTAINTY']);
});

test('stale or unknown odds age degrades market confidence', () => {
  const stale = assessMarketConfidence(
    { ...baseInput, oddsAgeSeconds: 4000 },
    strictConfig
  );
  assert.equal(stale.confidence, 'Medium');
  assert.deepEqual(stale.downgrades, ['ODDS_FRESHNESS']);

  const unknown = assessMarketConfidence(
    { ...baseInput, oddsAgeSeconds: null },
    strictConfig
  );
  assert.equal(unknown.confidence, 'Medium');
  assert.deepEqual(unknown.downgrades, ['ODDS_FRESHNESS']);
});

test('poor or thin market calibration degrades confidence twice', () => {
  const result = assessMarketConfidence(
    {
      ...baseInput,
      calibration: { settled: 20, brier: 0.3 },
    },
    strictConfig
  );
  assert.equal(result.confidence, 'Low');
  assert.deepEqual(result.downgrades, [
    'MARKET_CALIBRATION_SAMPLE',
    'MARKET_CALIBRATION_BRIER',
  ]);
});

test('confidence never falls below insufficient evidence', () => {
  const result = assessMarketConfidence(
    {
      ...baseInput,
      base: 'Low',
      pModel: 0.5,
      sampleSize: 2,
      oddsAgeSeconds: null,
      calibration: { settled: 1, brier: 0.4 },
    },
    strictConfig
  );
  assert.equal(result.confidence, 'Insufficient evidence');
  assert.equal(result.downgrades.length, 4);
});

test('a clean, well sampled market keeps its baseline confidence', () => {
  const result = assessMarketConfidence(baseInput);
  assert.equal(result.confidence, 'High');
  assert.deepEqual(result.downgrades, []);
  assert.equal(result.calibrationUnavailable, true);
});
