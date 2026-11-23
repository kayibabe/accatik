/**
 * Football Prediction, Market Intelligence & Betting Analytics Framework
 * v1.2 — policy configuration and shared vocabulary.
 *
 * The numeric values below are the document's initial policy values, not
 * proven optima. Every one is configurable and versioned (§2.2, §24).
 */

export const FRAMEWORK_VERSION = '1.2';

/** Status order is significant: the first applicable status wins (§11.2). */
export type FrameworkStatus =
  | 'QUALIFIED'
  | 'CONDITIONAL_REVIEW'
  | 'SCREEN_ONLY'
  | 'REJECTED'
  | 'INSUFFICIENT_DATA';

export type ReasonCode =
  | 'ODDS_BELOW_MIN'
  | 'EDGE_BELOW_MIN'
  | 'NON_POSITIVE_EV'
  | 'STRESS_EV_NON_POSITIVE'
  | 'MARKET_UNSUITABLE'
  | 'INSUFFICIENT_CONFIDENCE'
  | 'EDGE_OUTLIER'
  | 'SIGNAL_CONFLICT'
  | 'SUITABILITY_REVIEW'
  | 'STALE_ODDS'
  | 'INCOMPLETE_MARKET'
  | 'PROVIDER_UNAUDITED'
  | 'UNRESOLVED_RISK_FLAG'
  | 'NO_MODEL_PROBABILITY'
  | 'DATA_QUALITY_FAILURE'
  | 'INDEX_SUM_INVALID'
  | 'SLATE_CAP_EXCEEDED'
  | 'FORM_NOT_SUPPORTIVE'
  | 'SAME_FIXTURE_SECONDARY'
  | 'INVALID_LEG_COUNT'
  | 'UNQUALIFIED_LEG'
  | 'SAME_FIXTURE_NOT_ACCA'
  | 'ACCA_NON_POSITIVE_EV'
  | 'SHARED_TEAM_DEPENDENCE'
  | 'SHARED_COMPETITION_DEPENDENCE';

/** Screening flags from §5.3 and §5.4. They are hypotheses, not probabilities. */
export type SuitabilityFlag =
  | 'ONE_SIDED_ATTACK'
  | 'DEFENSIVE_WALL_WARNING'
  | 'BALANCED_ATTACK_WEAK_DEFENCE'
  | 'FAVOURITE_WEAK_ATTACK'
  | 'SIGNAL_CONFLICT'
  | 'DRAW_RISK'
  | 'LOW_SCORING_WARNING'
  | 'FAILED_TO_SCORE_RISK'
  | 'INDEX_SUM_INVALID';

export type ConfidenceClass =
  | 'High'
  | 'Medium'
  | 'Low'
  | 'Insufficient evidence';

export const CONFIDENCE_RANK: Record<ConfidenceClass, number> = {
  High: 3,
  Medium: 2,
  Low: 1,
  'Insufficient evidence': 0,
};

/** Status precedence for a fixture-level roll-up (best first). */
export const STATUS_RANK: Record<FrameworkStatus, number> = {
  QUALIFIED: 4,
  CONDITIONAL_REVIEW: 3,
  SCREEN_ONLY: 2,
  REJECTED: 1,
  INSUFFICIENT_DATA: 0,
};

/** Market keys mirror the app's canonical selection keys where they exist. */
export type MarketKey = string;

export interface FrameworkConfig {
  /** Minimum probability edge over the de-vigged benchmark (fraction). */
  minEdge: number;
  /** Minimum execution decimal odds. */
  minOdds: number;
  /** Edge above this is held for manual review (fraction). */
  outlierEdge: number;
  /** Probability clip: every model and fair probability is kept in [ε, 1−ε]. */
  epsilon: number;
  /** Stress shrinkage: P_stress = P_model − s · (P_model − P_fair). */
  stressShrinkage: number;
  /** Maximum odds age at decision, in seconds. */
  maxOddsAgeSeconds: number;
  /** Assumed overround for one-sided markets when no complete book exists. */
  assumedOverround: number;
  /** Flat stake in units. */
  standardStakeUnits: number;
  /** Accumulator leg limits (§14.1). */
  minAccaLegs: number;
  maxAccaLegs: number;
  /** Slate-level controls (§13.3). */
  maxDailySelections: number;
  maxWeeklyExposureUnits: number;
  /** Runtime state supplied by the caller: units staked earlier this week. */
  priorWeeklyStakeUnits: number;
  maxPerLeague: number;
  maxPerTeam: number;
  /** Expected total goals below which the low-scoring screen fires (§10.3). */
  lowScoringTotalThreshold: number;
  /** Failed-to-score rate above which BTTS Yes is held (§10.4). */
  failedToScoreThreshold: number;
  /** Market confidence degrades when the probability standard error exceeds this (§12). */
  confidenceStandardErrorCeiling: number;
  /** Odds older than this fraction of the maximum age degrade confidence (§12). */
  confidenceOddsAgeFraction: number;
  /** Minimum settled samples before market calibration can raise confidence (§12). */
  minMarketCalibrationSamples: number;
  /** Brier ceiling for an acceptably calibrated market (§12). */
  marketCalibrationBrierCeiling: number;
  /** Draw-risk alert band (§5.4). */
  drawRiskBand: number;
  /** Comparative index pairs must sum to 100% within this tolerance (§5.1). */
  indexSumTolerance: number;
  /** Screening band edges (§5.2/§5.3), as fractions. */
  weakAttackThreshold: number;
  balancedLow: number;
  balancedHigh: number;
  wallThreshold: number;
  weakDefenceThreshold: number;
  favouriteWeakAttackThreshold: number;
  /** Two attack indices within this distance are treated as tied (§5.3). */
  tieTolerance: number;
  /** Minimum confidence class that may qualify. */
  minConfidence: ConfidenceClass;
  /** Accumulators require legs from different competitions when true. */
  requireDistinctLeagues: boolean;
  /** Provider probabilities are numeric only after their audit passes (§3.5). */
  providerAudited: boolean;
  /** Model version recorded with every decision (§18.1). */
  modelVersion: string;
  /** Minimum completed matches before a team is modelled. */
  minTeamMatches: number;
  /** Minimum completed matches before a competition baseline is used. */
  minLeagueMatches: number;
  /** Exponential form decay per day. Must be validated on history (§4.2). */
  formDecayPerDay: number;
  /** Sample-size shrinkage strength (§4.5). */
  shrinkageStrength: number;
  /** Dixon-Coles low-score correlation; estimate on history (§6.3). */
  rho: number;
  /** Largest goal count held in the scoreline matrix. */
  maxGoals: number;
  /** Tail mass above this is reported as a model defect. */
  maxOmittedTail: number;
}

export const DEFAULT_FRAMEWORK_CONFIG: FrameworkConfig = {
  // Relaxed from 0.15/1.45/0.5 so a model-backed price can still qualify on
  // thin slates. EV and stressed EV must still be strictly positive; these are
  // thresholds for how much edge is required, not permission to take -EV odds.
  minEdge: 0.05,
  minOdds: 1.3,
  outlierEdge: 0.35,
  epsilon: 0.005,
  stressShrinkage: 0.25,
  maxOddsAgeSeconds: 8 * 60 * 60,
  assumedOverround: 0.05,
  standardStakeUnits: 1,
  minAccaLegs: 2,
  maxAccaLegs: 5,
  maxDailySelections: 6,
  maxWeeklyExposureUnits: 20,
  priorWeeklyStakeUnits: 0,
  maxPerLeague: 2,
  maxPerTeam: 1,
  lowScoringTotalThreshold: 2.4,
  failedToScoreThreshold: 0.4,
  confidenceStandardErrorCeiling: 0.45,
  confidenceOddsAgeFraction: 0.5,
  minMarketCalibrationSamples: 100,
  marketCalibrationBrierCeiling: 0.25,
  drawRiskBand: 0.05,
  indexSumTolerance: 0.02,
  weakAttackThreshold: 0.3,
  balancedLow: 0.4,
  balancedHigh: 0.6,
  wallThreshold: 0.6,
  weakDefenceThreshold: 0.4,
  favouriteWeakAttackThreshold: 0.5,
  tieTolerance: 0.01,
  minConfidence: 'Low',
  requireDistinctLeagues: false,
  providerAudited: false,
  modelVersion: 'framework-v1.2-baseline',
  minTeamMatches: 2,
  minLeagueMatches: 8,
  formDecayPerDay: 0.01,
  shrinkageStrength: 6,
  rho: 0,
  maxGoals: 10,
  maxOmittedTail: 0.001,
};

/**
 * Per-market rule actions from §17.5. Keys are `${ruleMarket}:${flag}`.
 * `reject` is a hard value-gate failure; `review` holds the selection.
 */
export type RuleAction = 'reject' | 'review';

export const RULE_ACTIONS: Record<string, RuleAction> = {
  'btts_yes:ONE_SIDED_ATTACK': 'reject',
  'over_2_5:ONE_SIDED_ATTACK': 'review',
  'over_2_5:DEFENSIVE_WALL_WARNING': 'reject',
  'btts_yes:DEFENSIVE_WALL_WARNING': 'review',
  'over_2_5:SIGNAL_CONFLICT': 'review',
  'btts_yes:SIGNAL_CONFLICT': 'review',
  'home_win:FAVOURITE_WEAK_ATTACK': 'review',
  'away_win:FAVOURITE_WEAK_ATTACK': 'review',
  'home_win:DRAW_RISK': 'review',
  'away_win:DRAW_RISK': 'review',
  // §10.3: a low-scoring screen prompts Under evaluation; the higher Over
  // lines are held rather than rejected on the screening signal alone.
  'over_2_5:LOW_SCORING_WARNING': 'review',
  'goals_o3_5:LOW_SCORING_WARNING': 'review',
  // §10.4: failed-to-score history is a red flag for BTTS Yes, not BTTS No.
  'btts_yes:FAILED_TO_SCORE_RISK': 'review',
};

/** Maps a canonical selection key onto the rule vocabulary used above. */
export function ruleMarketKey(marketKey: MarketKey): string {
  switch (marketKey) {
    case '1X2-H':
      return 'home_win';
    case '1X2-D':
      return 'draw';
    case '1X2-A':
      return 'away_win';
    case 'DC-1X':
      return 'dc_1x';
    case 'DC-X2':
      return 'dc_x2';
    case 'DC-12':
      return 'dc_12';
    case 'GOALS-O2.5':
      return 'over_2_5';
    case 'GOALS-U2.5':
      return 'under_2_5';
    case 'BTTS-YES':
      return 'btts_yes';
    case 'BTTS-NO':
      return 'btts_no';
    default:
      return marketKey.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  }
}
