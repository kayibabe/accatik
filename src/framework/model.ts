import type { ConfidenceClass, FrameworkConfig } from './config.ts';
import { DEFAULT_FRAMEWORK_CONFIG } from './config.ts';

/**
 * Baseline statistical model input (§4, §6).
 *
 * This is deliberately small and transparent: league scoring baselines,
 * venue-aware attack/defence rates, exponential time decay and sample-size
 * shrinkage. It is a starting point for shadow operation, not a calibrated
 * production model; every parameter is versioned with the decision.
 */

export interface TeamMatchResult {
  /** Stable id for the fixture, used to avoid counting a match twice. */
  fixtureId?: string;
  teamId: string;
  opponentId: string;
  goalsFor: number;
  goalsAgainst: number;
  home: boolean;
  dateIso: string;
  competitionId: string;
}

export interface LeagueBaseline {
  homeGoals: number;
  awayGoals: number;
  avgGoals: number;
  matches: number;
  competitionId: string | null;
  usedFallback: boolean;
}

export interface TeamStrength {
  attack: number;
  defence: number;
  /** Weighted points per match as a 0–100 form rating. */
  form: number;
  /** Weighted share of matches where the team failed to score (§10.4). */
  failedToScore: number;
  matches: number;
  venueMatches: number;
}

export interface ProviderIndices {
  attackHome: number;
  attackAway: number;
  defenceHome: number;
  defenceAway: number;
}

export interface FrameworkModelInput {
  lambdaHome: number;
  lambdaAway: number;
  rho: number;
  attackHome: number;
  attackAway: number;
  defenceHome: number;
  defenceAway: number;
  formHome: number;
  formAway: number;
  failedToScoreHome: number;
  failedToScoreAway: number;
  sampleHome: number;
  sampleAway: number;
  leagueMatches: number;
  leagueUsedFallback: boolean;
  modelVersion: string;
  confidence: ConfidenceClass;
  dataOk: boolean;
  /** Comparative provider indices, when a provider supplied them. */
  providerIndices?: ProviderIndices;
  providerAudited: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function decayWeight(dateIso: string, asOfIso: string, decayPerDay: number): number {
  if (decayPerDay <= 0) return 1;
  const ageDays = Math.max(0, (parseDate(asOfIso) - parseDate(dateIso)) / DAY_MS);
  return Math.exp(-decayPerDay * ageDays);
}

function pointsFor(result: TeamMatchResult): number {
  if (result.goalsFor > result.goalsAgainst) return 3;
  if (result.goalsFor === result.goalsAgainst) return 1;
  return 0;
}

/**
 * League scoring baseline. Uses the competition when it has enough matches,
 * otherwise the whole result set (recorded as a fallback).
 */
export function buildLeagueBaseline(
  results: TeamMatchResult[],
  competitionId: string,
  config: Partial<FrameworkConfig> = {}
): LeagueBaseline {
  const cfg = { ...DEFAULT_FRAMEWORK_CONFIG, ...config };
  const inCompetition = results.filter(
    (result) => result.competitionId === competitionId && result.home
  );
  const fallback = inCompetition.length < cfg.minLeagueMatches;
  const sample = fallback
    ? results.filter((result) => result.home)
    : inCompetition;

  if (sample.length === 0) {
    return {
      homeGoals: 1.35,
      awayGoals: 1.1,
      avgGoals: 1.225,
      matches: 0,
      competitionId: fallback ? null : competitionId,
      usedFallback: fallback,
    };
  }

  const homeGoals =
    sample.reduce((sum, result) => sum + result.goalsFor, 0) / sample.length;
  const awayResults = fallback
    ? results.filter((result) => !result.home)
    : results.filter(
        (result) => !result.home && result.competitionId === competitionId
      );
  const awayGoals =
    awayResults.length > 0
      ? awayResults.reduce((sum, result) => sum + result.goalsFor, 0) /
        awayResults.length
      : homeGoals;

  return {
    homeGoals,
    awayGoals,
    avgGoals: (homeGoals + awayGoals) / 2,
    matches: sample.length,
    competitionId: fallback ? null : competitionId,
    usedFallback: fallback,
  };
}

/**
 * Venue-aware attack and defensive strength with exponential time decay and
 * shrinkage towards the league average (1.0). Returns null without data.
 */
export function buildTeamStrength(
  results: TeamMatchResult[],
  teamId: string,
  venue: 'home' | 'away' | 'all',
  baseline: LeagueBaseline,
  asOfIso: string,
  config: Partial<FrameworkConfig> = {}
): TeamStrength | null {
  const cfg = { ...DEFAULT_FRAMEWORK_CONFIG, ...config };
  const teamResults = results.filter(
    (result) => result.teamId === teamId && result.dateIso < asOfIso
  );
  if (teamResults.length === 0) return null;

  const venueResults =
    venue === 'all'
      ? teamResults
      : teamResults.filter((result) => result.home === (venue === 'home'));
  const useVenue = venue !== 'all' && venueResults.length >= 3;
  const sample = useVenue ? venueResults : teamResults;

  let weightSum = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  let points = 0;
  let failedToScore = 0;
  for (const result of sample) {
    const weight = decayWeight(result.dateIso, asOfIso, cfg.formDecayPerDay);
    weightSum += weight;
    goalsFor += weight * result.goalsFor;
    goalsAgainst += weight * result.goalsAgainst;
    points += weight * pointsFor(result);
    failedToScore += weight * (result.goalsFor === 0 ? 1 : 0);
  }
  if (weightSum <= 0) return null;

  const scoringRate = goalsFor / weightSum;
  const concedingRate = goalsAgainst / weightSum;

  const scoringReference = useVenue
    ? venue === 'home'
      ? baseline.homeGoals
      : baseline.awayGoals
    : baseline.avgGoals;
  const concedingReference = useVenue
    ? venue === 'home'
      ? baseline.awayGoals
      : baseline.homeGoals
    : baseline.avgGoals;

  const rawAttack = scoringReference > 0 ? scoringRate / scoringReference : 1;
  const rawDefence = concedingReference > 0 ? concedingRate / concedingReference : 1;
  const n = sample.length;
  const k = cfg.shrinkageStrength;
  const attack = (n * rawAttack + k) / (n + k);
  const defence = (n * rawDefence + k) / (n + k);

  return {
    attack: Math.min(Math.max(attack, 0.2), 3),
    defence: Math.min(Math.max(defence, 0.2), 3),
    form: (points / (3 * weightSum)) * 100,
    failedToScore: failedToScore / weightSum,
    matches: n,
    venueMatches: venueResults.length,
  };
}

function confidenceFor(
  sampleHome: number,
  sampleAway: number,
  leagueMatches: number
): ConfidenceClass {
  const sample = Math.min(sampleHome, sampleAway);
  if (sample >= 10 && leagueMatches >= 50) return 'High';
  if (sample >= 5 && leagueMatches >= 20) return 'Medium';
  if (sample >= 2 && leagueMatches >= 8) return 'Low';
  return 'Insufficient evidence';
}

export interface BuildModelInputArgs {
  homeTeamId: string;
  awayTeamId: string;
  competitionId: string;
  asOfIso: string;
  results: TeamMatchResult[];
  config?: Partial<FrameworkConfig>;
  providerIndices?: ProviderIndices;
}

/**
 * Builds the model input for one fixture using only results strictly before
 * the decision date (point-in-time integrity, §19.2).
 */
export function buildModelInput({
  homeTeamId,
  awayTeamId,
  competitionId,
  asOfIso,
  results,
  config = {},
  providerIndices,
}: BuildModelInputArgs): FrameworkModelInput | null {
  const cfg = { ...DEFAULT_FRAMEWORK_CONFIG, ...config };
  // Point-in-time integrity: nothing on or after the decision date may enter
  // the baseline or the team strengths (§19.2).
  const pointInTime = results.filter((result) => result.dateIso < asOfIso);
  const baseline = buildLeagueBaseline(pointInTime, competitionId, cfg);
  if (baseline.matches < cfg.minLeagueMatches) return null;

  const home = buildTeamStrength(pointInTime, homeTeamId, 'home', baseline, asOfIso, cfg);
  const away = buildTeamStrength(pointInTime, awayTeamId, 'away', baseline, asOfIso, cfg);
  if (!home || !away) return null;

  const sampleHome = home.matches;
  const sampleAway = away.matches;
  const confidence = confidenceFor(sampleHome, sampleAway, baseline.matches);
  if (confidence === 'Insufficient evidence') return null;

  const lambdaHome = Math.min(
    Math.max(baseline.homeGoals * home.attack * away.defence, 0.05),
    6
  );
  const lambdaAway = Math.min(
    Math.max(baseline.awayGoals * away.attack * home.defence, 0.05),
    6
  );

  return {
    lambdaHome,
    lambdaAway,
    rho: cfg.rho,
    attackHome: home.attack,
    attackAway: away.attack,
    defenceHome: home.defence,
    defenceAway: away.defence,
    formHome: home.form,
    formAway: away.form,
    failedToScoreHome: home.failedToScore,
    failedToScoreAway: away.failedToScore,
    sampleHome,
    sampleAway,
    leagueMatches: baseline.matches,
    leagueUsedFallback: baseline.usedFallback,
    modelVersion: cfg.modelVersion,
    confidence,
    dataOk: true,
    providerIndices,
    providerAudited: cfg.providerAudited,
  };
}
