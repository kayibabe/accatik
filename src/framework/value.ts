import type { FrameworkConfig, ReasonCode } from './config.ts';
import { DEFAULT_FRAMEWORK_CONFIG } from './config.ts';

/**
 * Bookmaker probability and value engine (§9).
 *
 * Fair probabilities come from one complete market at one book. When only one
 * side is available, the fair probability is the proportional approximation
 * and the caller must cap the selection at CONDITIONAL_REVIEW.
 */

export function impliedProbability(odds: number): number {
  if (!Number.isFinite(odds) || odds <= 1) return 0;
  return 1 / odds;
}

/** Proportional de-vig of a complete, mutually exclusive market (§9.1). */
export function devig(odds: Record<string, number>): Record<string, number> {
  const entries = Object.entries(odds);
  if (entries.length < 2) throw new Error('invalid odds: a complete market needs at least two outcomes');
  if (entries.some(([, value]) => !Number.isFinite(value) || value <= 1)) {
    throw new Error('invalid odds: every price must be above 1.00');
  }
  const implied = entries.map(([key, value]) => [key, 1 / value] as const);
  const total = implied.reduce((sum, [, value]) => sum + value, 0);
  if (!(total > 0)) throw new Error('invalid odds');
  return Object.fromEntries(implied.map(([key, value]) => [key, value / total]));
}

/**
 * One-sided fair probability (§9.2). `overround` is the complete market's
 * implied total minus 1, estimated from complete books in the same market.
 * This ignores favourite-longshot bias; the caller flags INCOMPLETE_MARKET.
 */
export function fairFromOneSide(odds: number, overround: number): number {
  if (!Number.isFinite(odds) || odds <= 1) throw new Error('invalid odds');
  if (!Number.isFinite(overround) || overround < 0) throw new Error('invalid overround');
  return (1 / odds) / (1 + overround);
}

/** Keeps a model probability strictly inside (0, 1) (§3.5, R-03). */
export function clipProbability(
  probability: number,
  epsilon = DEFAULT_FRAMEWORK_CONFIG.epsilon
): number {
  if (!Number.isFinite(probability)) return epsilon;
  return Math.min(Math.max(probability, epsilon), 1 - epsilon);
}

export interface ValueInput {
  pModel: number;
  pFair: number;
  odds: number;
  config?: Partial<FrameworkConfig>;
}

export interface ValueAssessment {
  pModel: number;
  pFair: number;
  edge: number;
  relativeEdge: number;
  ev: number;
  pStress: number;
  evStress: number;
  fairOdds: number;
  hardFail: ReasonCode[];
  outlier: boolean;
}

/**
 * Edge, EV and stressed EV (§9.3, §9.5). Edge is returned as a fraction; the
 * UI multiplies by 100 to show percentage points.
 */
export function evaluateValue({
  pModel,
  pFair,
  odds,
  config = {},
}: ValueInput): ValueAssessment {
  const cfg = { ...DEFAULT_FRAMEWORK_CONFIG, ...config };
  const model = clipProbability(pModel, cfg.epsilon);
  const fair = clipProbability(pFair, cfg.epsilon);
  if (!Number.isFinite(odds) || odds <= 1) {
    throw new Error('invalid execution odds');
  }

  const edge = model - fair;
  const ev = model * odds - 1;
  const pStress = model - cfg.stressShrinkage * (model - fair);
  const evStress = pStress * odds - 1;

  const hardFail: ReasonCode[] = [];
  if (odds < cfg.minOdds) hardFail.push('ODDS_BELOW_MIN');
  if (edge < cfg.minEdge) hardFail.push('EDGE_BELOW_MIN');
  if (ev <= 0) hardFail.push('NON_POSITIVE_EV');
  if (evStress <= 0) hardFail.push('STRESS_EV_NON_POSITIVE');

  return {
    pModel: model,
    pFair: fair,
    edge,
    relativeEdge: model / fair - 1,
    ev,
    pStress,
    evStress,
    fairOdds: 1 / model,
    hardFail,
    outlier: edge > cfg.outlierEdge,
  };
}

/** Percentage-point view used by reports and the UI. */
export function edgeInPoints(value: Pick<ValueAssessment, 'edge'>): number {
  return value.edge * 100;
}

/** Combined accumulator EV from leg probabilities (§14.2). */
export function combinedEv(
  legs: Array<{ pModel: number; pStress: number; odds: number }>
): { p: number; pStress: number; odds: number; ev: number; evStress: number } {
  let p = 1;
  let pStress = 1;
  let odds = 1;
  for (const leg of legs) {
    p *= leg.pModel;
    pStress *= leg.pStress;
    odds *= leg.odds;
  }
  return { p, pStress, odds, ev: p * odds - 1, evStress: pStress * odds - 1 };
}
