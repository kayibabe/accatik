import type { FrameworkConfig, MarketKey } from './config.ts';
import { DEFAULT_FRAMEWORK_CONFIG } from './config.ts';

/**
 * Scoreline modelling (§6). Poisson marginals with the Dixon-Coles low-score
 * adjustment, a recorded omitted-tail mass, and market probabilities derived
 * from one normalised matrix (§7).
 */

export interface ScorelineMatrix {
  /** `matrix[home][away]`, already normalised. */
  matrix: number[][];
  /** Mass omitted by truncating at `maxGoals`, measured before normalisation. */
  tail: number;
  /** Sum of the truncated cells before normalisation. */
  truncatedMass: number;
  maxGoals: number;
}

export function poissonPmf(k: number, lambda: number): number {
  if (!Number.isInteger(k) || k < 0) {
    throw new Error('invalid input: k must be a non-negative integer');
  }
  if (!Number.isFinite(lambda) || lambda < 0) {
    throw new Error('invalid input: lambda must be non-negative');
  }
  let factorial = 1;
  for (let i = 2; i <= k; i += 1) factorial *= i;
  return Math.exp(-lambda) * lambda ** k / factorial;
}

/** Dixon-Coles τ, applied only to the four low-score cells (§6.3). */
export function dcTau(
  homeGoals: number,
  awayGoals: number,
  lambdaHome: number,
  lambdaAway: number,
  rho: number
): number {
  if (homeGoals === 0 && awayGoals === 0) {
    return 1 - lambdaHome * lambdaAway * rho;
  }
  if (homeGoals === 0 && awayGoals === 1) {
    return 1 + lambdaHome * rho;
  }
  if (homeGoals === 1 && awayGoals === 0) {
    return 1 + lambdaAway * rho;
  }
  if (homeGoals === 1 && awayGoals === 1) {
    return 1 - rho;
  }
  return 1;
}

/**
 * Builds the joint scoreline matrix. A negative cell means rho is outside its
 * valid range for these lambdas: fail loudly rather than hide it in a
 * normalisation step (§6.3, R-01).
 */
export function buildScorelineMatrix(
  lambdaHome: number,
  lambdaAway: number,
  rho = 0,
  maxGoals = DEFAULT_FRAMEWORK_CONFIG.maxGoals
): ScorelineMatrix {
  if (!Number.isFinite(lambdaHome) || lambdaHome < 0) {
    throw new Error('invalid lambdaHome');
  }
  if (!Number.isFinite(lambdaAway) || lambdaAway < 0) {
    throw new Error('invalid lambdaAway');
  }
  if (!Number.isInteger(maxGoals) || maxGoals < 0) {
    throw new Error('invalid maxGoals');
  }

  const matrix: number[][] = [];
  let truncatedMass = 0;
  for (let home = 0; home <= maxGoals; home += 1) {
    const row: number[] = [];
    for (let away = 0; away <= maxGoals; away += 1) {
      const cell =
        poissonPmf(home, lambdaHome) *
        poissonPmf(away, lambdaAway) *
        dcTau(home, away, lambdaHome, lambdaAway, rho);
      if (cell < 0) {
        throw new Error('rho produces negative probabilities');
      }
      row.push(cell);
      truncatedMass += cell;
    }
    matrix.push(row);
  }

  if (truncatedMass <= 0) throw new Error('invalid matrix');

  const tail = Math.max(0, 1 - truncatedMass);
  return {
    matrix: matrix.map((row) => row.map((cell) => cell / truncatedMass)),
    tail,
    truncatedMass,
    maxGoals,
  };
}

export type ScorelinePredicate = (homeGoals: number, awayGoals: number) => boolean;

/** Sums matrix mass over the cells matching `predicate`. */
export function matrixProbability(
  matrix: number[][],
  predicate: ScorelinePredicate
): number {
  let total = 0;
  for (let home = 0; home < matrix.length; home += 1) {
    for (let away = 0; away < matrix[home].length; away += 1) {
      if (predicate(home, away)) total += matrix[home][away];
    }
  }
  return total;
}

/** Same-fixture combinations are always priced from the joint matrix (§7.7). */
export function sameFixtureCombination(
  matrix: number[][],
  predicate: ScorelinePredicate
): number {
  return matrixProbability(matrix, predicate);
}

const GOAL_LINES = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5];
const TEAM_GOAL_LINES = [0.5, 1.5, 2.5];

/**
 * Every market probability the framework supports, derived from one matrix.
 * Keys match the app's canonical selection keys so the assessment layer can
 * join them to priced selections without a second mapping table.
 */
export function deriveMarketProbabilities(
  matrix: number[][]
): Record<MarketKey, number> {
  const homeWin = matrixProbability(matrix, (home, away) => home > away);
  const draw = matrixProbability(matrix, (home, away) => home === away);
  const awayWin = matrixProbability(matrix, (home, away) => home < away);
  const bttsYes = matrixProbability(matrix, (home, away) => home > 0 && away > 0);

  const probabilities: Record<MarketKey, number> = {
    '1X2-H': homeWin,
    '1X2-D': draw,
    '1X2-A': awayWin,
    'DC-1X': homeWin + draw,
    'DC-X2': draw + awayWin,
    'DC-12': homeWin + awayWin,
    'BTTS-YES': bttsYes,
    'BTTS-NO': 1 - bttsYes,
  };

  for (const line of GOAL_LINES) {
    const over = matrixProbability(matrix, (home, away) => home + away > line);
    probabilities[`GOALS-O${line}`] = over;
    probabilities[`GOALS-U${line}`] = 1 - over;
  }

  for (const line of TEAM_GOAL_LINES) {
    const homeOver = matrixProbability(matrix, (home) => home > line);
    const awayOver = matrixProbability(matrix, (_home, away) => away > line);
    probabilities[`TEAM-H-O${line}`] = homeOver;
    probabilities[`TEAM-H-U${line}`] = 1 - homeOver;
    probabilities[`TEAM-A-O${line}`] = awayOver;
    probabilities[`TEAM-A-U${line}`] = 1 - awayOver;
  }

  return probabilities;
}

/**
 * Consistency checks from §7.6. Returns the failed checks rather than throwing
 * so the caller can record them as data-quality failures.
 */
export function matrixConsistencyFailures(
  probabilities: Record<MarketKey, number>,
  tolerance = 1e-6
): string[] {
  const failures: string[] = [];
  const close = (a: number, b: number): boolean => Math.abs(a - b) <= tolerance;

  if (!close(probabilities['1X2-H'] + probabilities['1X2-D'] + probabilities['1X2-A'], 1)) {
    failures.push('1X2 does not sum to 1');
  }
  if (!close(probabilities['DC-1X'], probabilities['1X2-H'] + probabilities['1X2-D'])) {
    failures.push('DC-1X is not the 1X2 sum');
  }
  if (!close(probabilities['DC-X2'], probabilities['1X2-D'] + probabilities['1X2-A'])) {
    failures.push('DC-X2 is not the 1X2 sum');
  }
  if (!close(probabilities['DC-12'], probabilities['1X2-H'] + probabilities['1X2-A'])) {
    failures.push('DC-12 is not the 1X2 sum');
  }
  for (const line of GOAL_LINES) {
    if (!close(probabilities[`GOALS-O${line}`] + probabilities[`GOALS-U${line}`], 1)) {
      failures.push(`Over/Under ${line} are not complements`);
    }
  }
  if (!close(probabilities['BTTS-YES'] + probabilities['BTTS-NO'], 1)) {
    failures.push('BTTS Yes/No are not complements');
  }
  for (const line of TEAM_GOAL_LINES) {
    for (const side of ['H', 'A']) {
      if (!close(probabilities[`TEAM-${side}-O${line}`] + probabilities[`TEAM-${side}-U${line}`], 1)) {
        failures.push(`Team ${side} Over/Under ${line} are not complements`);
      }
    }
  }
  for (const [key, value] of Object.entries(probabilities)) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      failures.push(`${key} is outside [0, 1]`);
    }
  }
  return failures;
}

/** Convenience wrapper for callers that only have the config. */
export function buildMatrixFromConfig(
  lambdaHome: number,
  lambdaAway: number,
  config: Pick<FrameworkConfig, 'rho' | 'maxGoals'> = DEFAULT_FRAMEWORK_CONFIG
): ScorelineMatrix {
  return buildScorelineMatrix(lambdaHome, lambdaAway, config.rho, config.maxGoals);
}
