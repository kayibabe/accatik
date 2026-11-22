import type { FrameworkConfig, MarketKey, SuitabilityFlag } from './config.ts';
import { DEFAULT_FRAMEWORK_CONFIG } from './config.ts';
import type { FrameworkModelInput } from './model.ts';

/**
 * Market-specific screening conditions (§10.3–§10.5).
 *
 * These are screens, not probabilities. They may hold or reject a market, but
 * they never create an edge: every market still needs its own matrix-derived
 * probability and value gates.
 */

export interface TeamGoalsContext {
  side: 'home' | 'away';
  line: number;
  /** Expected goals for the selected team from the scoreline model. */
  expectedGoals: number;
  /** Opponent concession factor; above 1 means more goals conceded than average. */
  opponentConcession: number;
  /** Venue-specific form rating of the selected team. */
  venueForm: number;
  /** Comparative indices, only when a provider supplied them. */
  attackIndex: number | null;
  defenceIndex: number | null;
  /** Lineups are not available in the current data feed (§3.1). */
  lineupAvailable: boolean;
  /** Inputs that could not be assessed and keep the market in review. */
  missing: string[];
}

function parseTeamGoalKey(market: MarketKey): {
  side: 'home' | 'away';
  line: number;
} | null {
  const match = /^TEAM-(H|A)-(O|U)(\d+(?:\.\d+)?)$/.exec(market);
  if (!match) return null;
  return {
    side: match[1] === 'H' ? 'home' : 'away',
    line: Number.parseFloat(match[3]),
  };
}

/** Low-scoring screen from the model's expected total (§10.3, §20.1). */
export function lowScoringWarning(
  model: Pick<FrameworkModelInput, 'lambdaHome' | 'lambdaAway'>,
  config: Partial<FrameworkConfig> = {}
): boolean {
  const cfg = { ...DEFAULT_FRAMEWORK_CONFIG, ...config };
  return model.lambdaHome + model.lambdaAway < cfg.lowScoringTotalThreshold;
}

/** Failed-to-score screen for BTTS Yes (§10.4). */
export function failedToScoreRisk(
  model: Pick<FrameworkModelInput, 'failedToScoreHome' | 'failedToScoreAway'>,
  config: Partial<FrameworkConfig> = {}
): boolean {
  const cfg = { ...DEFAULT_FRAMEWORK_CONFIG, ...config };
  return (
    Math.max(model.failedToScoreHome, model.failedToScoreAway) >
    cfg.failedToScoreThreshold
  );
}

/**
 * Context required by §10.5 for team-goals markets. The current feed has no
 * lineup data, so those markets stay in review until that input exists; the
 * absence is recorded rather than assumed neutral.
 */
export function teamGoalsContext(
  market: MarketKey,
  model: FrameworkModelInput
): TeamGoalsContext | null {
  const parsed = parseTeamGoalKey(market);
  if (!parsed) return null;

  const home = parsed.side === 'home';
  const missing: string[] = [];
  if (!model.providerIndices) {
    missing.push('COMPARATIVE_INDICES');
  }

  return {
    side: parsed.side,
    line: parsed.line,
    expectedGoals: home ? model.lambdaHome : model.lambdaAway,
    opponentConcession: home ? model.defenceAway : model.defenceHome,
    venueForm: home ? model.formHome : model.formAway,
    attackIndex: model.providerIndices
      ? home
        ? model.providerIndices.attackHome
        : model.providerIndices.attackAway
      : null,
    defenceIndex: model.providerIndices
      ? home
        ? model.providerIndices.defenceHome
        : model.providerIndices.defenceAway
      : null,
    lineupAvailable: false,
    missing: [...missing, 'LINEUP_AVAILABILITY'],
  };
}

/** Extra screening flags for one fixture, from §10.3 and §10.4. */
export function marketScreeningFlags(
  model: FrameworkModelInput,
  config: Partial<FrameworkConfig> = {}
): SuitabilityFlag[] {
  const flags: SuitabilityFlag[] = [];
  if (lowScoringWarning(model, config)) flags.push('LOW_SCORING_WARNING');
  if (failedToScoreRisk(model, config)) flags.push('FAILED_TO_SCORE_RISK');
  return flags;
}
