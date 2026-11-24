import type { ConfidenceClass, FrameworkStatus } from '../framework/config.ts';
import { DEFAULT_FRAMEWORK_CONFIG } from '../framework/config.ts';
import { confidencePasses } from '../framework/qualification.ts';
import type {
  AccaLeg,
  Fixture,
  MarketOption,
  TicketGuardSummary,
} from '../types/fixtures.ts';
import { fmtFixed, fmtPercent } from './format.ts';
import { frameworkDecisionCopy } from './frameworkCopy.ts';
import { isPreMatchFixture } from './priceQuality.ts';
import {
  angleConfidence,
  buildRecommendedAngle,
  type AngleConfidence,
} from './recommendedAngle.ts';
import { guardTicket, type TicketGuardResult } from './ticketGuard.ts';

/**
 * "How to choose the actual picks" as an executable checklist.
 *
 * The board's Recommended Angle card says *what* a pick is and how likely it
 * is. This layer decides *whether it is allowed into a long-term ticket* and
 * what job it can do there. It deliberately reuses the framework's own value,
 * confidence and ticket-guard output instead of inventing a second opinion.
 */

export interface GradePlan {
  band: string;
  role: string;
  slot: string;
  guidance: string;
}

export const GRADE_PLAN: Record<AngleConfidence, GradePlan> = {
  High: {
    band: '≥ 70% fair chance',
    role: 'Anchor leg',
    slot: 'Leg 1',
    guidance: 'Short-price 1X2 / Double Chance / short goals lines.',
  },
  Solid: {
    band: '52–70% fair chance',
    role: 'Core leg',
    slot: 'Leg 2',
    guidance: 'Acceptable as leg 2.',
  },
  Moderate: {
    band: '38–52% fair chance',
    role: 'Middle leg',
    slot: 'Leg 3 only',
    guidance: 'Only when the other two legs are High or Solid.',
  },
  Speculative: {
    band: '< 38% fair chance',
    role: 'Do not use',
    slot: '—',
    guidance: 'No place in a long-term ticket.',
  },
};

const GRADE_RANK: Record<AngleConfidence, number> = {
  High: 3,
  Solid: 2,
  Moderate: 1,
  Speculative: 0,
};

/** Downgrades that mean the evidence is stale or too thin to trust the edge. */
const WEAK_EVIDENCE_DOWNGRADES = new Set([
  'ODDS_FRESHNESS',
  'SAMPLE_UNCERTAINTY',
  'MARKET_CALIBRATION_SAMPLE',
]);

export type PickFilterId = 'status' | 'value' | 'confidence' | 'market' | 'timing';

export interface PickFilterCheck {
  id: PickFilterId;
  label: string;
  passed: boolean;
  detail: string;
}

export interface PickCandidate {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  country: string;
  kickoffTime: string;
  market: MarketOption;
  /** Fair chance from the Recommended Angle card, in percent. */
  probability: number;
  grade: AngleConfidence;
  role: string;
  checks: PickFilterCheck[];
  eligible: boolean;
  rejectionReasons: string[];
  frameworkStatus: FrameworkStatus | null;
  edgePts: number | null;
  ev: number | null;
  evStress: number | null;
  confidence: ConfidenceClass | null;
  confidenceDowngrades: string[];
  marketComplete: boolean;
  /** Assigned only when this candidate survives the shortlist assembly. */
  selectedSlot: number | null;
}

export interface PickSelectionOptions {
  /** The guide builds a three-leg teaching shape by default. */
  maxLegs?: number;
}

export interface PickSelection {
  candidates: PickCandidate[];
  eligible: PickCandidate[];
  shortlist: PickCandidate[];
  legs: AccaLeg[];
  guard: TicketGuardResult;
  /** Eligible picks held back by the one-market / diversity / middle-leg rules. */
  held: Array<{ fixtureId: string; reason: string }>;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

const edgePtsOf = (edge: number | null | undefined): number | null =>
  typeof edge === 'number' && Number.isFinite(edge)
    ? round1(edge * 100)
    : null;

const normalise = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Grades and hard-filters one fixture's Recommended Angle card.
 * Returns null when the fixture has no priced angle at all.
 */
export function evaluatePickCandidate(
  fixture: Fixture,
  strategy: Parameters<typeof buildRecommendedAngle>[1]
): PickCandidate | null {
  const angle = buildRecommendedAngle(fixture, strategy);
  if (!angle) return null;

  const { market } = angle;
  const framework = market.framework;
  const edgePts = edgePtsOf(framework?.edge);
  const ev = framework?.ev ?? null;
  const evStress = framework?.evStress ?? null;
  const confidence = framework?.confidence ?? null;
  const confidenceDowngrades = framework?.confidenceDowngrades ?? [];
  const marketComplete =
    framework?.marketComplete === true &&
    Number.isFinite(market.fairProbability) &&
    Number.isFinite(framework?.pFair ?? Number.NaN);
  const weakEvidence = confidenceDowngrades.filter((code) =>
    WEAK_EVIDENCE_DOWNGRADES.has(code)
  );
  const requiredEdgePts = round1(DEFAULT_FRAMEWORK_CONFIG.minEdge * 100);

  const valueOk =
    edgePts !== null &&
    edgePts >= requiredEdgePts &&
    ev !== null &&
    ev > 0 &&
    evStress !== null &&
    evStress > 0;
  const confidenceOk =
    confidence !== null && confidencePasses(confidence) && weakEvidence.length === 0;

  const checks: PickFilterCheck[] = [
    {
      id: 'status',
      label: 'Framework status is QUALIFIED',
      passed: framework?.status === 'QUALIFIED',
      detail: framework
        ? frameworkDecisionCopy(framework.status, framework.reasonCodes)
        : 'No framework decision attached to this market',
    },
    {
      id: 'value',
      label: `Model edge ≥ ${fmtFixed(requiredEdgePts, 0)}pp, EV % > 0 and stressed EV % > 0`,
      passed: valueOk,
      detail:
        edgePts === null
          ? 'No framework value assessment'
          : `Model edge ${fmtFixed(edgePts, 1, { sign: true })} pp · EV ${fmtPercent(
              ev === null ? null : ev * 100,
              1
            )} · stressed EV ${fmtPercent(
              evStress === null ? null : evStress * 100,
              1
            )}`,
    },
    {
      id: 'confidence',
      label: 'Confidence ≥ Low, no stale-odds or thin-sample downgrade',
      passed: confidenceOk,
      detail:
        confidence === null
          ? 'No framework confidence assessment'
          : `${confidence}${
              confidenceDowngrades.length
                ? ` · downgraded: ${confidenceDowngrades.join(', ')}`
                : ' · no downgrades'
            }`,
    },
    {
      id: 'market',
      label: 'Fair probability from a complete book, not a one-sided approximation',
      passed: marketComplete,
      detail: marketComplete
        ? `Fair ${fmtPercent(angle.probability)} via ${
            framework?.benchmarkBook ?? 'complete book'
          }`
        : 'No de-vigged probability from a complete book',
    },
    {
      id: 'timing',
      label: 'Price is still pre-match',
      passed: isPreMatchFixture(fixture),
      detail: isPreMatchFixture(fixture)
        ? `${fixture.kickoffTime} kickoff`
        : 'Match is live, finished or awaiting a result',
    },
  ];

  const grade = angleConfidence(angle.probability);
  return {
    fixtureId: fixture.id,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    competition: fixture.competition,
    country: fixture.country,
    kickoffTime: fixture.kickoffTime,
    market,
    probability: angle.probability,
    grade,
    role: GRADE_PLAN[grade].role,
    checks,
    eligible: checks.every((check) => check.passed),
    rejectionReasons: checks.filter((check) => !check.passed).map((check) => check.label),
    frameworkStatus: framework?.status ?? null,
    edgePts,
    ev,
    evStress,
    confidence,
    confidenceDowngrades,
    marketComplete,
    selectedSlot: null,
  };
}

function toLeg(fixture: Fixture, candidate: PickCandidate): AccaLeg {
  const { market } = candidate;
  return {
    fixtureId: candidate.fixtureId,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    competition: fixture.competition,
    matchDate: fixture.matchDate,
    kickoffTime: fixture.kickoffTime,
    marketId: market.id,
    marketLabel: market.label,
    marketType: market.marketType,
    odds: market.odds,
    impliedProbability: market.impliedProbability,
    fairProbability: market.fairProbability,
    rationale: market.rationale,
    bookmaker: market.bookmaker,
    framework: market.framework,
  };
}

/**
 * Builds the teaching shortlist from this slate's angle cards: highest grade
 * first, one market per fixture, distinct competitions and teams, and a
 * Moderate leg only after two High/Solid legs are already in the shape.
 */
export function buildPickSelection(
  fixtures: Fixture[],
  strategy: Parameters<typeof buildRecommendedAngle>[1],
  options: PickSelectionOptions = {}
): PickSelection {
  const maxLegs = Math.max(2, Math.min(5, options.maxLegs ?? 3));
  const candidates = fixtures
    .map((fixture) => evaluatePickCandidate(fixture, strategy))
    .filter((candidate): candidate is PickCandidate => candidate !== null);
  const eligible = candidates.filter((candidate) => candidate.eligible);
  const ranked = [...eligible].sort((a, b) => {
    const gradeDiff = GRADE_RANK[b.grade] - GRADE_RANK[a.grade];
    if (gradeDiff !== 0) return gradeDiff;
    const edgeDiff = (b.edgePts ?? -Infinity) - (a.edgePts ?? -Infinity);
    if (edgeDiff !== 0) return edgeDiff;
    const probDiff = b.probability - a.probability;
    if (probDiff !== 0) return probDiff;
    return a.homeTeam.localeCompare(b.homeTeam);
  });

  const shortlist: PickCandidate[] = [];
  const held: PickSelection['held'] = [];
  const competitions = new Set<string>();
  const teams = new Set<string>();

  for (const candidate of ranked) {
    if (shortlist.length >= maxLegs) break;
    const higherGraded = shortlist.filter(
      (leg) => leg.grade === 'High' || leg.grade === 'Solid'
    ).length;
    if (candidate.grade === 'Moderate' && higherGraded < 2) {
      held.push({
        fixtureId: candidate.fixtureId,
        reason: 'Middle leg needs two High/Solid legs first',
      });
      continue;
    }
    const candidateTeams = [candidate.homeTeam, candidate.awayTeam].map(normalise);
    const competitionKey = normalise(candidate.competition);
    if (competitions.has(competitionKey)) {
      held.push({ fixtureId: candidate.fixtureId, reason: 'Competition already used' });
      continue;
    }
    if (candidateTeams.some((team) => teams.has(team))) {
      held.push({ fixtureId: candidate.fixtureId, reason: 'Team already used' });
      continue;
    }

    candidate.selectedSlot = shortlist.length + 1;
    shortlist.push(candidate);
    competitions.add(competitionKey);
    candidateTeams.forEach((team) => teams.add(team));
  }

  const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const legs = shortlist
    .map((candidate) => {
      const fixture = fixtureById.get(candidate.fixtureId);
      return fixture ? toLeg(fixture, candidate) : null;
    })
    .filter((leg): leg is AccaLeg => leg !== null);
  const guard = guardTicket(legs, { maxLegs });

  return { candidates, eligible, shortlist, legs, guard, held };
}

/** The two ticket-level figures the guide asks you to read before saving. */
export function guardEconomics(guard: TicketGuardSummary | TicketGuardResult) {
  return {
    fairChance: guard.economics.fairChance,
    breakEvenChance: guard.economics.breakEvenChance,
    edgePts: guard.economics.edgePts,
    expectedRoi: guard.economics.expectedRoi,
    basis: guard.economics.basis,
    recommended: guard.recommended,
    reason: guard.reason,
  };
}
