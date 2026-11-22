import type {
  ConfidenceClass,
  FrameworkStatus,
  MarketKey,
  ReasonCode,
} from './config.ts';
import { CONFIDENCE_RANK, DEFAULT_FRAMEWORK_CONFIG } from './config.ts';
import type { ValueAssessment } from './value.ts';

/**
 * Slate controller (§13.3, §17.6).
 *
 * Screening a large slate across many markets is a multiple-comparisons
 * problem. The controller stakes at most one qualified market per fixture and
 * applies league, team and daily caps. Selections cut by a cap stay qualified
 * on merit but are not staked; they carry SLATE_CAP_EXCEEDED.
 */

export interface SlateCandidate {
  fixtureId: string;
  /** Stable price-row id; distinguishes duplicate selection keys on one fixture. */
  marketId?: string;
  leagueId: string;
  homeTeamId: string;
  awayTeamId: string;
  market: MarketKey;
  status: FrameworkStatus;
  reasonCodes: ReasonCode[];
  value: ValueAssessment | null;
  confidence: ConfidenceClass;
  oddsAgeSeconds: number;
  staked?: boolean;
}

export interface SlateCapConfig {
  maxDailySelections: number;
  maxWeeklyExposureUnits: number;
  /** Units already staked earlier in the same ISO week (§13.3). */
  priorWeeklyStakeUnits: number;
  maxPerLeague: number;
  maxPerTeam: number;
}

export interface SlateRunSummary {
  candidatesTested: number;
  qualified: number;
  held: number;
  cutByCaps: number;
  priorWeeklyStakeUnits: number;
  remainingWeeklyExposureUnits: number;
}

export interface SlateResult<T extends SlateCandidate> {
  candidates: T[];
  summary: SlateRunSummary;
}

/**
 * Applies the deterministic ranking and the caps. The input array is not
 * mutated; the returned candidates are copies.
 */
export function applySlateCaps<T extends SlateCandidate>(
  candidates: T[],
  config: Partial<SlateCapConfig> = {}
): SlateResult<T> {
  const cfg = { ...DEFAULT_FRAMEWORK_CONFIG, ...config };
  const working = candidates.map((candidate) => ({
    ...candidate,
    reasonCodes: [...candidate.reasonCodes],
    staked: false,
  }));

  const qualified = working
    .filter((candidate) => candidate.status === 'QUALIFIED')
    .sort((a, b) => {
      const evDiff =
        (b.value?.evStress ?? Number.NEGATIVE_INFINITY) -
        (a.value?.evStress ?? Number.NEGATIVE_INFINITY);
      if (evDiff !== 0) return evDiff;
      const confidenceDiff =
        CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
      if (confidenceDiff !== 0) return confidenceDiff;
      if (a.oddsAgeSeconds !== b.oddsAgeSeconds) {
        return a.oddsAgeSeconds - b.oddsAgeSeconds;
      }
      // Stable final tie-break so repeated runs rank identically.
      return `${a.fixtureId}:${a.marketId ?? ''}:${a.market}`.localeCompare(
        `${b.fixtureId}:${b.marketId ?? ''}:${b.market}`
      );
    });

  const fixtures = new Set<string>();
  const leagues = new Map<string, number>();
  const teams = new Map<string, number>();
  let staked = 0;
  const remainingWeekly = Math.max(
    0,
    cfg.maxWeeklyExposureUnits - cfg.priorWeeklyStakeUnits
  );
  const selectionLimit = Math.min(cfg.maxDailySelections, remainingWeekly);

  for (const candidate of qualified) {
    if (fixtures.has(candidate.fixtureId)) {
      candidate.status = 'CONDITIONAL_REVIEW';
      candidate.reasonCodes.push('SAME_FIXTURE_SECONDARY');
      continue;
    }
    fixtures.add(candidate.fixtureId);

    const sideTeams = [candidate.homeTeamId, candidate.awayTeamId];
    const capReached =
      staked >= selectionLimit ||
      (leagues.get(candidate.leagueId) ?? 0) >= cfg.maxPerLeague ||
      sideTeams.some((team) => (teams.get(team) ?? 0) >= cfg.maxPerTeam);

    if (capReached) {
      candidate.reasonCodes.push('SLATE_CAP_EXCEEDED');
      continue;
    }

    staked += 1;
    leagues.set(candidate.leagueId, (leagues.get(candidate.leagueId) ?? 0) + 1);
    for (const team of sideTeams) {
      teams.set(team, (teams.get(team) ?? 0) + 1);
    }
    candidate.staked = true;
  }

  return {
    candidates: working,
    summary: {
      candidatesTested: working.length,
      qualified: working.filter((candidate) => candidate.status === 'QUALIFIED').length,
      held: working.filter((candidate) => candidate.status === 'CONDITIONAL_REVIEW').length,
      cutByCaps: working.filter((candidate) =>
        candidate.reasonCodes.includes('SLATE_CAP_EXCEEDED')
      ).length,
      priorWeeklyStakeUnits: cfg.priorWeeklyStakeUnits,
      remainingWeeklyExposureUnits: Math.max(0, remainingWeekly - staked),
    },
  };
}
