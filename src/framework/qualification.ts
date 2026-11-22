import type {
  ConfidenceClass,
  FrameworkStatus,
  MarketKey,
  ReasonCode,
  SuitabilityFlag,
} from './config.ts';
import { DEFAULT_FRAMEWORK_CONFIG, RULE_ACTIONS, ruleMarketKey } from './config.ts';
import type { ThreeWayProbabilities } from './suitability.ts';
import type { ValueAssessment } from './value.ts';
import type { TeamGoalsContext } from './marketRules.ts';

/**
 * Qualification and status engine (§11, §15).
 *
 * Statuses are evaluated in the §11.2 order; the first that applies wins. A
 * selection that fails any mandatory gate is never treated as qualified, and
 * every rejected or held selection keeps its reason codes.
 */

export interface QualificationCandidate {
  market: MarketKey;
  /** Fixture/team data validation passed and no index identity failed. */
  dataOk: boolean;
  flags: SuitabilityFlag[];
  /** Null means no model-derived probability exists. */
  value: ValueAssessment | null;
  /** Validated form ratings for the Double Chance condition (§10.1). */
  formHome?: number | null;
  formAway?: number | null;
  /** Model 1X2, used for the outright model-over-draw condition (§10.2). */
  model1x2?: ThreeWayProbabilities | null;
  /** Odds are within the maximum age and captured before kickoff. */
  oddsAgeOk: boolean;
  /** Fair probability came from a complete market at one book. */
  marketComplete: boolean;
  usesProviderProb: boolean;
  providerAudited: boolean;
  criticalFlags: string[];
  confidenceOk: boolean;
  confidence?: ConfidenceClass;
  /** §10.5 context, present only for team-goals markets. */
  marketContext?: TeamGoalsContext | null;
}

export interface QualificationResult {
  status: FrameworkStatus;
  reasonCodes: ReasonCode[];
}

function outrightSide(market: MarketKey): 'home' | 'away' | null {
  if (market === '1X2-H') return 'home';
  if (market === '1X2-A') return 'away';
  return null;
}

export function qualifyCandidate(
  candidate: QualificationCandidate
): QualificationResult {
  if (!candidate.dataOk || candidate.flags.includes('INDEX_SUM_INVALID')) {
    return { status: 'INSUFFICIENT_DATA', reasonCodes: ['DATA_QUALITY_FAILURE'] };
  }

  if (candidate.value === null) {
    return { status: 'SCREEN_ONLY', reasonCodes: ['NO_MODEL_PROBABILITY'] };
  }

  const value = candidate.value;
  if (value.hardFail.length > 0) {
    return { status: 'REJECTED', reasonCodes: [...value.hardFail] };
  }

  const ruleKey = ruleMarketKey(candidate.market);
  const actions = candidate.flags.map((flag) => RULE_ACTIONS[`${ruleKey}:${flag}`]);
  if (actions.includes('reject')) {
    return { status: 'REJECTED', reasonCodes: ['MARKET_UNSUITABLE'] };
  }

  // Confidence is a rejection-class gate (Appendix B), so it precedes every
  // CONDITIONAL_REVIEW hold in the §11.2 order.
  if (!candidate.confidenceOk) {
    return { status: 'REJECTED', reasonCodes: ['INSUFFICIENT_CONFIDENCE'] };
  }

  const holds: ReasonCode[] = [];
  const formHome = candidate.formHome;
  const formAway = candidate.formAway;

  // §10.1 Double Chance: the selected side must have the stronger form.
  if (ruleKey === 'dc_1x' && (formHome == null || formAway == null || formHome <= formAway)) {
    holds.push('FORM_NOT_SUPPORTIVE');
  }
  if (ruleKey === 'dc_x2' && (formHome == null || formAway == null || formAway <= formHome)) {
    holds.push('FORM_NOT_SUPPORTIVE');
  }

  // §10.2 1X2 outright: the model must favour the team over the draw.
  const side = outrightSide(candidate.market);
  if (side && candidate.model1x2) {
    if (candidate.model1x2[side] <= candidate.model1x2.draw) {
      holds.push('SUITABILITY_REVIEW');
    }
  }

  if (value.outlier) holds.push('EDGE_OUTLIER');
  if (actions.includes('review')) holds.push('SUITABILITY_REVIEW');
  if (candidate.flags.includes('SIGNAL_CONFLICT')) holds.push('SIGNAL_CONFLICT');
  if (!candidate.oddsAgeOk) holds.push('STALE_ODDS');
  if (!candidate.marketComplete) holds.push('INCOMPLETE_MARKET');
  if (candidate.usesProviderProb && !candidate.providerAudited) {
    holds.push('PROVIDER_UNAUDITED');
  }
  if (candidate.criticalFlags.length > 0) holds.push('UNRESOLVED_RISK_FLAG');
  // §10.5: team-goal markets need lineup availability as well as the
  // statistical context; the current feed has no lineups, so they stay in
  // review instead of being assessed on incomplete inputs.
  if (candidate.marketContext && candidate.marketContext.missing.length > 0) {
    holds.push('UNRESOLVED_RISK_FLAG');
  }

  if (holds.length > 0) {
    return {
      status: 'CONDITIONAL_REVIEW',
      reasonCodes: [...new Set(holds)].sort(),
    };
  }

  return { status: 'QUALIFIED', reasonCodes: [] };
}

/** True when a confidence class clears the configured minimum. */
export function confidencePasses(
  confidence: ConfidenceClass,
  minimum: ConfidenceClass = DEFAULT_FRAMEWORK_CONFIG.minConfidence
): boolean {
  const rank: Record<ConfidenceClass, number> = {
    High: 3,
    Medium: 2,
    Low: 1,
    'Insufficient evidence': 0,
  };
  return rank[confidence] >= rank[minimum];
}
