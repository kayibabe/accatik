import type { FrameworkStatus, ReasonCode } from './config.ts';
import { DEFAULT_FRAMEWORK_CONFIG } from './config.ts';

/**
 * Accumulator validator (§14, §17.7).
 *
 * An individually qualified selection is not automatically accumulator
 * eligible. Legs must come from different fixtures; same-fixture legs are a
 * combination priced from the scoreline matrix (§7.7), never multiplied.
 */

export interface AccumulatorLegInput {
  fixtureId: string;
  leagueId: string;
  homeTeamId: string;
  awayTeamId: string;
  status: FrameworkStatus;
  odds: number;
  value: { pModel: number; pStress: number } | null;
}

export interface AccumulatorMetrics {
  p: number;
  pStress: number;
  odds: number;
  ev: number;
  evStress: number;
}

export interface AccumulatorResult {
  status: FrameworkStatus;
  reasonCodes: ReasonCode[];
  metrics: AccumulatorMetrics | null;
}

export interface AccumulatorConfig {
  minLegs?: number;
  maxLegs?: number;
  requireDistinctLeagues?: boolean;
}

export function evaluateAccumulator(
  legs: AccumulatorLegInput[],
  config: AccumulatorConfig = {}
): AccumulatorResult {
  const minLegs = config.minLegs ?? DEFAULT_FRAMEWORK_CONFIG.minAccaLegs;
  const maxLegs = config.maxLegs ?? DEFAULT_FRAMEWORK_CONFIG.maxAccaLegs;
  const requireDistinctLeagues =
    config.requireDistinctLeagues ?? DEFAULT_FRAMEWORK_CONFIG.requireDistinctLeagues;

  if (legs.length < minLegs || legs.length > maxLegs) {
    return { status: 'REJECTED', reasonCodes: ['INVALID_LEG_COUNT'], metrics: null };
  }
  if (legs.some((leg) => leg.status !== 'QUALIFIED')) {
    return { status: 'REJECTED', reasonCodes: ['UNQUALIFIED_LEG'], metrics: null };
  }
  if (new Set(legs.map((leg) => leg.fixtureId)).size !== legs.length) {
    return { status: 'REJECTED', reasonCodes: ['SAME_FIXTURE_NOT_ACCA'], metrics: null };
  }

  let p = 1;
  let pStress = 1;
  let odds = 1;
  for (const leg of legs) {
    if (!leg.value) {
      return { status: 'REJECTED', reasonCodes: ['UNQUALIFIED_LEG'], metrics: null };
    }
    p *= leg.value.pModel;
    pStress *= leg.value.pStress;
    odds *= leg.odds;
  }
  const metrics: AccumulatorMetrics = {
    p,
    pStress,
    odds,
    ev: p * odds - 1,
    evStress: pStress * odds - 1,
  };

  if (metrics.ev <= 0 || metrics.evStress <= 0) {
    return { status: 'REJECTED', reasonCodes: ['ACCA_NON_POSITIVE_EV'], metrics };
  }

  const holds: ReasonCode[] = [];
  const teamIds = legs.flatMap((leg) => [leg.homeTeamId, leg.awayTeamId]);
  if (new Set(teamIds).size !== teamIds.length) {
    holds.push('SHARED_TEAM_DEPENDENCE');
  }
  if (
    requireDistinctLeagues &&
    new Set(legs.map((leg) => leg.leagueId)).size < legs.length
  ) {
    holds.push('SHARED_COMPETITION_DEPENDENCE');
  }

  if (holds.length > 0) {
    return { status: 'CONDITIONAL_REVIEW', reasonCodes: holds, metrics };
  }
  return { status: 'QUALIFIED', reasonCodes: [], metrics };
}
