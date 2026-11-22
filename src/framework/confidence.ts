import type {
  ConfidenceClass,
  FrameworkConfig,
  MarketKey,
} from './config.ts';
import { DEFAULT_FRAMEWORK_CONFIG } from './config.ts';

/**
 * Market-specific confidence (§12).
 *
 * Confidence is not the outcome probability. It starts from the evidence that
 * built the model, then degrades for inputs that are weak for *this* market:
 * a noisy probability estimate at the available sample size, stale prices and
 * poor market calibration. Calibration is optional until a settled history
 * exists; its absence is recorded, not silently treated as good.
 */

const CONFIDENCE_ORDER: ConfidenceClass[] = [
  'Insufficient evidence',
  'Low',
  'Medium',
  'High',
];

export interface MarketCalibrationRecord {
  /** Settled selections for this market in the calibration window. */
  settled: number;
  /** Brier score against settled outcomes. */
  brier: number;
}

export interface MarketConfidenceInput {
  /** Evidence level of the underlying model for this fixture. */
  base: ConfidenceClass;
  market: MarketKey;
  /** Model probability for this market, before clipping. */
  pModel: number;
  /** Smaller team sample used by the model. */
  sampleSize: number;
  /** Odds age in seconds; null means the capture time is unknown. */
  oddsAgeSeconds: number | null;
  /** Optional calibration evidence for this market. */
  calibration?: MarketCalibrationRecord | null;
}

export interface MarketConfidenceAssessment {
  confidence: ConfidenceClass;
  /** Standard error of the probability estimate at the available sample. */
  standardError: number;
  /** Human-readable reasons for any downgrade, for the decision record. */
  downgrades: string[];
  /** True when no market calibration record was available. */
  calibrationUnavailable: boolean;
}

function downgrade(confidence: ConfidenceClass): ConfidenceClass {
  const index = CONFIDENCE_ORDER.indexOf(confidence);
  return CONFIDENCE_ORDER[Math.max(0, index - 1)];
}

/** Standard error of a proportion estimate, used as probability uncertainty. */
export function probabilityStandardError(
  pModel: number,
  sampleSize: number
): number {
  if (!Number.isFinite(pModel) || !Number.isFinite(sampleSize) || sampleSize <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  const p = Math.min(Math.max(pModel, 0), 1);
  return Math.sqrt((p * (1 - p)) / sampleSize);
}

export function assessMarketConfidence(
  input: MarketConfidenceInput,
  config: Partial<FrameworkConfig> = {}
): MarketConfidenceAssessment {
  const cfg = { ...DEFAULT_FRAMEWORK_CONFIG, ...config };
  const downgrades: string[] = [];
  let confidence = input.base;
  const standardError = probabilityStandardError(input.pModel, input.sampleSize);

  if (standardError > cfg.confidenceStandardErrorCeiling) {
    confidence = downgrade(confidence);
    downgrades.push('SAMPLE_UNCERTAINTY');
  }

  if (
    input.oddsAgeSeconds === null ||
    input.oddsAgeSeconds > cfg.maxOddsAgeSeconds * cfg.confidenceOddsAgeFraction
  ) {
    confidence = downgrade(confidence);
    downgrades.push('ODDS_FRESHNESS');
  }

  const calibration = input.calibration ?? null;
  const calibrationUnavailable = calibration === null;
  if (calibration) {
    if (calibration.settled < cfg.minMarketCalibrationSamples) {
      confidence = downgrade(confidence);
      downgrades.push('MARKET_CALIBRATION_SAMPLE');
    }
    if (calibration.brier > cfg.marketCalibrationBrierCeiling) {
      confidence = downgrade(confidence);
      downgrades.push('MARKET_CALIBRATION_BRIER');
    }
  }

  return { confidence, standardError, downgrades, calibrationUnavailable };
}
