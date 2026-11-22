import type { FrameworkConfig, SuitabilityFlag } from './config.ts';
import { DEFAULT_FRAMEWORK_CONFIG } from './config.ts';

/**
 * Comparative-index screening (§5) and draw-risk alerting (§5.4).
 *
 * Provider attacking and defensive indices of the comparative type satisfy
 * Att(H) + Att(A) = 100% and Def(H) + Def(A) = 100%. Conditions are therefore
 * stated once per fixture, and per side only where the side matters.
 */

export interface IndexPair {
  home: number;
  away: number;
}

export interface ThreeWayProbabilities {
  home: number;
  draw: number;
  away: number;
}

export interface SuitabilityInput {
  attack: IndexPair;
  defence: IndexPair;
  /** The favourite's attack index, when already known. */
  favouriteAttack?: number | null;
  /** Benchmark fair 1X2, preferred for identifying the favourite. */
  fair1x2?: ThreeWayProbabilities | null;
  /** Model 1X2, used for draw risk and as the favourite fallback. */
  model1x2?: ThreeWayProbabilities | null;
  config?: Partial<FrameworkConfig>;
}

export type FavouriteSide = 'home' | 'away';

const pct = (value: number): number => Math.round(value * 100);

/** Favourite is the higher de-vigged benchmark probability, else the model. */
export function favouriteSide(
  fair1x2?: ThreeWayProbabilities | null,
  model1x2?: ThreeWayProbabilities | null
): FavouriteSide | null {
  const source = fair1x2 ?? model1x2;
  if (!source) return null;
  return source.home >= source.away ? 'home' : 'away';
}

/** The favourite's own attacking index (§5.3). */
export function favouriteAttack(
  attack: IndexPair,
  fair1x2?: ThreeWayProbabilities | null,
  model1x2?: ThreeWayProbabilities | null
): number | null {
  const side = favouriteSide(fair1x2, model1x2);
  if (!side) return null;
  return side === 'home' ? attack.home : attack.away;
}

/** Draw-risk alert: the top win probability is close to the draw (§5.4). */
export function drawRiskFlag(
  model1x2?: ThreeWayProbabilities | null,
  config: Partial<FrameworkConfig> = {}
): SuitabilityFlag | null {
  if (!model1x2) return null;
  const cfg = { ...DEFAULT_FRAMEWORK_CONFIG, ...config };
  const topSide = Math.max(model1x2.home, model1x2.away);
  return Math.abs(topSide - model1x2.draw) <= cfg.drawRiskBand ? 'DRAW_RISK' : null;
}

/**
 * Index flags only (no draw risk). Returns `INDEX_SUM_INVALID` on its own when
 * a pair fails the identity, mirroring §17.4.
 */
export function assessIndexFlags({
  attack,
  defence,
  favouriteAttack: knownFavouriteAttack,
  fair1x2,
  model1x2,
  config = {},
}: SuitabilityInput): SuitabilityFlag[] {
  const cfg = { ...DEFAULT_FRAMEWORK_CONFIG, ...config };
  if (
    Math.abs(attack.home + attack.away - 1) > cfg.indexSumTolerance ||
    Math.abs(defence.home + defence.away - 1) > cfg.indexSumTolerance
  ) {
    return ['INDEX_SUM_INVALID'];
  }

  const flags: SuitabilityFlag[] = [];
  const attackHomePct = pct(attack.home);
  const attackAwayPct = pct(attack.away);
  const weakAttackPct = pct(cfg.weakAttackThreshold);

  if (Math.min(attackHomePct, attackAwayPct) < weakAttackPct) {
    flags.push('ONE_SIDED_ATTACK');
  }

  // The wall rule tests the stronger attacker's own defence, not the larger
  // of the two defence values. Within one percentage point, both sides are S.
  const tied = Math.abs(attackHomePct - attackAwayPct) <= Math.max(1, pct(cfg.tieTolerance));
  const strongerDefences = tied
    ? [defence.home, defence.away]
    : attack.home > attack.away
      ? [defence.home]
      : [defence.away];
  if (strongerDefences.some((value) => pct(value) > pct(cfg.wallThreshold))) {
    flags.push('DEFENSIVE_WALL_WARNING');
  }

  const balanced =
    attackHomePct >= pct(cfg.balancedLow) &&
    attackHomePct <= pct(cfg.balancedHigh) &&
    attackAwayPct >= pct(cfg.balancedLow) &&
    attackAwayPct <= pct(cfg.balancedHigh);
  if (
    balanced &&
    Math.min(pct(defence.home), pct(defence.away)) < pct(cfg.weakDefenceThreshold)
  ) {
    flags.push('BALANCED_ATTACK_WEAK_DEFENCE');
  }

  if (
    flags.includes('DEFENSIVE_WALL_WARNING') &&
    flags.includes('BALANCED_ATTACK_WEAK_DEFENCE')
  ) {
    flags.push('SIGNAL_CONFLICT');
  }

  const favouriteAttackIndex =
    knownFavouriteAttack ??
    favouriteAttack(attack, fair1x2, model1x2);
  if (
    favouriteAttackIndex !== null &&
    favouriteAttackIndex !== undefined &&
    pct(favouriteAttackIndex) < pct(cfg.favouriteWeakAttackThreshold)
  ) {
    flags.push('FAVOURITE_WEAK_ATTACK');
  }

  return flags;
}

/** Full §5 assessment: index flags plus the draw-risk alert. */
export function assessMarketSuitability(input: SuitabilityInput): SuitabilityFlag[] {
  const flags = assessIndexFlags(input);
  if (flags.includes('INDEX_SUM_INVALID')) return flags;
  const drawRisk = drawRiskFlag(input.model1x2, input.config);
  if (drawRisk) flags.push(drawRisk);
  return flags;
}
