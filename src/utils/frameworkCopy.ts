import type { FrameworkStatus, ReasonCode } from '../framework/config.ts';

/**
 * User-facing wording for framework decisions. The engine's status and reason
 * codes are stable API identifiers, not explanations: anything shown to a user
 * goes through here so raw keys never leak into tooltips or tables.
 */
export const FRAMEWORK_STATUS_LABEL: Record<FrameworkStatus, string> = {
  QUALIFIED: 'Clears the value and confidence gates',
  CONDITIONAL_REVIEW: 'Held for a condition to clear',
  SCREEN_ONLY: 'Shown for context, not a pick',
  REJECTED: 'Fails a hard gate',
  INSUFFICIENT_DATA: 'Not enough data for a decision',
};

/** Compact visible label for dense chips and table cells. */
export const FRAMEWORK_STATUS_SHORT: Record<FrameworkStatus, string> = {
  QUALIFIED: 'Clears gates',
  CONDITIONAL_REVIEW: 'Review',
  SCREEN_ONLY: 'Screen only',
  REJECTED: 'Rejected',
  INSUFFICIENT_DATA: 'No decision',
};

export function frameworkStatusLabel(status: string | null | undefined): string {
  return (status && FRAMEWORK_STATUS_SHORT[status as FrameworkStatus]) || 'No decision';
}

export const REASON_CODE_LABEL: Record<ReasonCode, string> = {
  ODDS_BELOW_MIN: 'Price below the minimum odds',
  EDGE_BELOW_MIN: 'Model edge below the required margin',
  NON_POSITIVE_EV: 'Expected value is not positive',
  STRESS_EV_NON_POSITIVE: 'Stressed expected value is not positive',
  MARKET_UNSUITABLE: 'Market unsuitable for this match',
  INSUFFICIENT_CONFIDENCE: 'Confidence below the minimum',
  EDGE_OUTLIER: 'Edge looks too large to trust',
  SIGNAL_CONFLICT: 'Signals disagree',
  SUITABILITY_REVIEW: 'Match context needs review',
  STALE_ODDS: 'Odds are stale',
  INCOMPLETE_MARKET: 'Book is one-sided',
  PROVIDER_UNAUDITED: 'Provider not audited',
  UNRESOLVED_RISK_FLAG: 'A risk flag is still open',
  NO_MODEL_PROBABILITY: 'No model probability available',
  DATA_QUALITY_FAILURE: 'Not enough completed matches',
  INDEX_SUM_INVALID: 'Provider indices do not reconcile',
  SLATE_CAP_EXCEEDED: 'Daily exposure cap reached',
  FORM_NOT_SUPPORTIVE: 'Form does not support this side',
  SAME_FIXTURE_SECONDARY: 'Second market on the same fixture',
  INVALID_LEG_COUNT: 'Invalid number of legs',
  UNQUALIFIED_LEG: 'A leg is not qualified',
  SAME_FIXTURE_NOT_ACCA: 'Two legs share a fixture',
  ACCA_NON_POSITIVE_EV: 'Combined expected value is not positive',
  SHARED_TEAM_DEPENDENCE: 'Legs share a team',
  SHARED_COMPETITION_DEPENDENCE: 'Legs share a competition',
};

/** One short, human-readable line; unknown codes are dropped, never printed. */
export function frameworkDecisionCopy(
  status: string | null | undefined,
  reasonCodes: readonly string[] = []
): string {
  if (!status) return 'No framework decision attached';
  const label = FRAMEWORK_STATUS_LABEL[status as FrameworkStatus] ?? 'Framework decision';
  const reasons = reasonCodes
    .map((code) => REASON_CODE_LABEL[code as ReasonCode])
    .filter((text): text is string => Boolean(text));
  return reasons.length > 0 ? `${label} · ${reasons.slice(0, 2).join(' · ')}` : label;
}
