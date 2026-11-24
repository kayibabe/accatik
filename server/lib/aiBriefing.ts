import type {
  AccaStrategy,
  Fixture,
  GroundingSource,
  MarketOption,
} from '../../src/types/fixtures.ts';
import type {
  CombinationRoiResponse,
  PickAnalyticsResponse,
  QualifiedPicksResponse,
  RoiRegistryEntry,
} from '../../src/types/analytics.ts';
import type { LedgerSummary } from '../../src/types/ledger.ts';
import { DEFAULT_FRAMEWORK_CONFIG, type ReasonCode } from '../../src/framework/config.ts';
import type { MarketCalibrationRecord } from '../../src/framework/confidence.ts';
import type {
  AiAccumulatorResponse,
  AiBriefingResponse,
  AiConfidenceBand,
  AiInputRead,
  AiPick,
  AiPickCalibration,
  AiRiskMode,
  AiTicketLeg,
} from '../../src/types/ai.ts';
import { resolveMarketSelection } from '../../src/utils/marketSelection.ts';

/**
 * Free, deterministic football analytics ensemble.
 *
 * This is the core "AI" of the desk: it needs no API key and makes no network
 * call. It blends five independent signals, shrinks them toward the market when
 * they disagree, and scores the result on stressed EV rather than raw EV. A
 * language model (when configured) may only *explain* these numbers; it never
 * supplies a probability of its own.
 */

export const AI_MODEL_VERSION = 'ai-ensemble-1.0';

/**
 * Framework rejections caused by data/eligibility failures stay excluded: the
 * ensemble cannot repair a stale price, a broken book or invalid provider data.
 * Value rejections (edge/EV/confidence) are different — this desk deliberately
 * re-evaluates them with its independent signals, but flags the disagreement
 * and haircuts confidence.
 */
const HARD_REJECT_CODES = new Set<ReasonCode>([
  'DATA_QUALITY_FAILURE',
  'NO_MODEL_PROBABILITY',
  'INDEX_SUM_INVALID',
  'STALE_ODDS',
  'MARKET_UNSUITABLE',
  'UNRESOLVED_RISK_FLAG',
  'PROVIDER_UNAUDITED',
]);

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function percentToFraction(value: unknown): number | null {
  return finite(value) && value >= 0 && value <= 100 ? value / 100 : null;
}

function calibrationView(
  record: MarketCalibrationRecord | null | undefined
): AiPickCalibration | null {
  if (!record) return null;
  const status: AiPickCalibration['status'] =
    record.settled < DEFAULT_FRAMEWORK_CONFIG.minMarketCalibrationSamples
      ? 'thin'
      : record.brier > DEFAULT_FRAMEWORK_CONFIG.marketCalibrationBrierCeiling
        ? 'poor'
        : 'verified';
  return {
    settled: record.settled,
    brier: Math.round(record.brier * 10_000) / 10_000,
    status,
  };
}

/* ------------------------------------------------------------------ */
/* Independent probability signals                                     */
/* ------------------------------------------------------------------ */

function poissonPmf(k: number, lambda: number): number {
  if (!(lambda > 0)) return k === 0 ? 1 : 0;
  let term = Math.exp(-lambda);
  let total = term;
  for (let i = 1; i <= k; i += 1) {
    term *= lambda / i;
    total = term;
  }
  return total;
}

/**
 * Independent Poisson scoreline matrix from the framework's fitted lambdas.
 * Deliberately omits the low-score rho term so it disagrees with the framework
 * in a useful way: large disagreement is a reason to be cautious, not a reason
 * to average more confidently.
 */
export function poissonSelectionProbability(
  selectionKey: string,
  lambdaHome: number | null | undefined,
  lambdaAway: number | null | undefined
): number | null {
  if (!finite(lambdaHome) || !finite(lambdaAway) || lambdaHome <= 0 || lambdaAway <= 0) {
    return null;
  }
  const maxGoals = 12;
  const home = Array.from({ length: maxGoals + 1 }, (_, k) => poissonPmf(k, lambdaHome));
  const away = Array.from({ length: maxGoals + 1 }, (_, k) => poissonPmf(k, lambdaAway));
  const hTotal = home.reduce((a, b) => a + b, 0);
  const aTotal = away.reduce((a, b) => a + b, 0);
  if (!(hTotal > 0) || !(aTotal > 0)) return null;
  const h = home.map((p) => p / hTotal);
  const a = away.map((p) => p / aTotal);

  const outcome = (predicate: (hg: number, ag: number) => boolean): number => {
    let sum = 0;
    for (let hg = 0; hg <= maxGoals; hg += 1) {
      for (let ag = 0; ag <= maxGoals; ag += 1) {
        if (predicate(hg, ag)) sum += h[hg] * a[ag];
      }
    }
    return clamp(sum, 0, 1);
  };

  const H = () => outcome((hg, ag) => hg > ag);
  const D = () => outcome((hg, ag) => hg === ag);
  const A = () => outcome((hg, ag) => ag > hg);

  if (selectionKey.startsWith('1X2-')) {
    if (selectionKey === '1X2-H') return H();
    if (selectionKey === '1X2-D') return D();
    if (selectionKey === '1X2-A') return A();
    return null;
  }
  if (selectionKey === 'DC-1X') return H() + D();
  if (selectionKey === 'DC-X2') return D() + A();
  if (selectionKey === 'DC-12') return H() + A();
  if (selectionKey === 'DNB-1') {
    const h = H();
    const a = A();
    return h + a > 0 ? h / (h + a) : null;
  }
  if (selectionKey === 'DNB-2') {
    const h = H();
    const a = A();
    return h + a > 0 ? a / (h + a) : null;
  }
  const goals = /^GOALS-([OU])(\d+(?:\.\d+)?)$/.exec(selectionKey);
  if (goals) {
    const line = Number(goals[2]);
    return goals[1] === 'O'
      ? outcome((hg, ag) => hg + ag > line)
      : outcome((hg, ag) => hg + ag < line);
  }
  if (selectionKey === 'BTTS-YES') return outcome((hg, ag) => hg > 0 && ag > 0);
  if (selectionKey === 'BTTS-NO') return outcome((hg, ag) => hg === 0 || ag === 0);
  return null;
}

/** Provider 1X2 percentages mapped onto the selections the board actually prices. */
export function providerSelectionProbability(
  fixture: Fixture,
  selectionKey: string
): number | null {
  const raw = fixture.modelProbabilities;
  if (!raw) return null;
  const h = percentToFraction(raw.home);
  const d = percentToFraction(raw.draw);
  const a = percentToFraction(raw.away);
  if (h === null || d === null || a === null) return null;

  switch (selectionKey) {
    case '1X2-H': return h;
    case '1X2-D': return d;
    case '1X2-A': return a;
    case 'DC-1X': return h + d;
    case 'DC-X2': return d + a;
    case 'DC-12': return h + a;
    case 'DNB-1': return h + a > 0 ? h / (h + a) : null;
    case 'DNB-2': return h + a > 0 ? a / (h + a) : null;
    default: return null;
  }
}

/* ------------------------------------------------------------------ */
/* Market and historical lookups                                       */
/* ------------------------------------------------------------------ */

function fairProbability(market: MarketOption): number | null {
  const fromMarket = percentToFraction(market.fairProbability);
  if (fromMarket !== null && fromMarket > 0) return fromMarket;
  return market.odds > 1 ? clamp(1 / market.odds, 0, 1) : null;
}

function confidenceNumber(value: string | null | undefined): number {
  switch (value) {
    case 'High': return 1;
    case 'Medium': return 0.74;
    case 'Low': return 0.48;
    case 'Insufficient evidence': return 0.2;
    default: return 0.45;
  }
}

function bandFromConfidence(confidence: number): AiConfidenceBand {
  if (confidence >= 0.8) return 'High';
  if (confidence >= 0.65) return 'Solid';
  if (confidence >= 0.5) return 'Moderate';
  return 'Speculative';
}

function stakeFor(
  decisionProbability: number,
  odds: number,
  confidence: number,
  disagreement: number,
  cap: number
): number {
  const b = odds - 1;
  if (!(b > 0)) return 0;
  const full = (decisionProbability * b - (1 - decisionProbability)) / b;
  if (!(full > 0)) return 0;
  // Bayesian-style shrinkage: the more the models disagree, the less we trust
  // the point estimate. Fractional Kelly (0.25x) is the institutional default.
  const variance = 0.01 + disagreement * 0.2;
  const shrink = 0.01 / (variance + 0.01);
  return clamp(full * 0.25 * confidence * shrink, 0, cap);
}

export interface BriefingInput {
  fixtures: Fixture[];
  dateIso: string;
  displayDate: string;
  strategy: AccaStrategy;
  marketFilter: string;
  competitionFilter: string;
  analytics: PickAnalyticsResponse | null;
  combination: CombinationRoiResponse | null;
  registry: RoiRegistryEntry[];
  qualified: QualifiedPicksResponse | null;
  ledger: LedgerSummary | null;
  calibration?: Record<string, MarketCalibrationRecord> | null;
  sources: GroundingSource[];
  narratives?: Record<string, string>;
  narrativeProvider?: string | null;
  narrativeNote?: string;
}

/** Score every priced, pre-match selection and return the strongest picks. */
export function buildBriefing(input: BriefingInput): AiBriefingResponse {
  const {
    fixtures,
    dateIso,
    displayDate,
    strategy,
    marketFilter,
    competitionFilter,
    analytics,
    registry,
    qualified,
    ledger,
    sources,
    narratives = {},
  } = input;

  const now = Date.now();
  const history = new Map(
    (analytics?.marketsBySelection ?? []).map((row) => [row.key, row])
  );
  const promotedKeys = new Set(
    registry.filter((entry) => entry.status === 'promoted').map((entry) => entry.selectionKey)
  );
  const qualifiedKeys = new Set(
    (qualified?.rows ?? [])
      .filter((row) => row.eligibleForAcca)
      .map((row) => `${row.fixtureId}:${row.marketId}`)
  );

  const diagnostics = {
    fixturesScanned: fixtures.length,
    marketsScanned: 0,
    eligibleMarkets: 0,
    excludedStarted: 0,
    excludedNoModel: 0,
    excludedNegativeEv: 0,
    cacheNote: 'Archive/cache-backed inputs only; no extra upstream football API calls.',
  };

  const picks: AiPick[] = [];

  for (const fixture of fixtures) {
    if (fixture.status !== 'Scheduled') {
      diagnostics.excludedStarted += 1;
      continue;
    }
    if (
      finite(fixture.kickoffTimestamp) &&
      (fixture.kickoffTimestamp as number) <= now
    ) {
      diagnostics.excludedStarted += 1;
      continue;
    }
    if (
      competitionFilter &&
      competitionFilter !== 'all' &&
      fixture.competition !== competitionFilter
    ) {
      continue;
    }

    const model = fixture.framework?.model ?? null;
    const lambdaHome = model?.lambdaHome ?? null;
    const lambdaAway = model?.lambdaAway ?? null;
    const priced = fixture.allMarkets?.length ? fixture.allMarkets : fixture.markets;

    for (const market of priced) {
      if (!finite(market.odds) || market.odds <= 1.01) continue;
      diagnostics.marketsScanned += 1;

      const selection = resolveMarketSelection(market, fixture);
      if (
        marketFilter !== 'all' &&
        marketFilter !== market.marketType &&
        marketFilter !== selection.key
      ) {
        continue;
      }

      const assessment = market.framework;
      const calibration = calibrationView(
        input.calibration?.[selection.key] ?? assessment?.calibration
      );
      if (
        assessment?.status === 'REJECTED' &&
        (assessment.reasonCodes ?? []).some((code) => HARD_REJECT_CODES.has(code))
      ) {
        continue;
      }

      const frameworkP = finite(assessment?.pModel)
        ? clamp(assessment!.pModel as number, 0.001, 0.999)
        : null;
      const poissonP = poissonSelectionProbability(selection.key, lambdaHome, lambdaAway);
      const providerP = providerSelectionProbability(fixture, selection.key);
      const fair = fairProbability(market);
      if (fair === null) continue;

      const contributions: Array<{ value: number; weight: number; name: string }> = [];
      if (frameworkP !== null) contributions.push({ value: frameworkP, weight: 0.34, name: 'framework' });
      if (poissonP !== null) contributions.push({ value: poissonP, weight: 0.18, name: 'poisson' });
      if (providerP !== null) contributions.push({ value: providerP, weight: 0.24, name: 'provider' });
      contributions.push({ value: fair, weight: 0.18, name: 'book' });

      if (contributions.length <= 1 || frameworkP === null) {
        diagnostics.excludedNoModel += 1;
        continue;
      }

      const weightTotal = contributions.reduce((sum, c) => sum + c.weight, 0);
      const values = contributions.map((c) => c.value);
      const pModel = clamp(
        contributions.reduce((sum, c) => sum + c.value * c.weight, 0) / weightTotal,
        0.005,
        0.995
      );
      const disagreement = clamp(Math.max(...values) - Math.min(...values), 0, 1);

      // Historical ROI is a deliberately small prior: only settled samples can
      // move the estimate, and never by more than two probability points.
      // pickAnalytics reports ROI in percentage points, so convert to a
      // fraction before using it as a probability tilt.
      const historyRow = history.get(selection.key);
      const settled = historyRow?.settled ?? 0;
      const historyRoi = finite(historyRow?.roi) ? (historyRow!.roi as number) : null;
      const historyRoiFraction = historyRoi === null ? null : historyRoi / 100;
      const historyTilt =
        historyRoiFraction !== null
          ? clamp(historyRoiFraction, -0.1, 0.1) * clamp(settled / 100, 0, 1) * 0.2
          : 0;
      const blendedP = clamp(pModel + historyTilt, 0.005, 0.995);

      const frameworkStress = finite(assessment?.pStress)
        ? clamp(assessment!.pStress as number, 0.005, 0.995)
        : null;
      const baselineStress = frameworkStress ?? clamp((blendedP + fair) / 2, 0.005, 0.995);
      const decisionP = clamp(
        Math.min(blendedP, baselineStress) - disagreement * 0.25,
        0.005,
        0.995
      );

      const ev = blendedP * market.odds - 1;
      const evStress = decisionP * market.odds - 1;
      if (!(evStress > 0)) {
        diagnostics.excludedNegativeEv += 1;
        continue;
      }

      const oddsAge = finite(assessment?.oddsAgeSeconds)
        ? (assessment!.oddsAgeSeconds as number)
        : null;
      let confidence = confidenceNumber(assessment?.confidence ?? fixture.framework?.confidence);
      if (assessment?.marketComplete) confidence += 0.04;
      if (oddsAge !== null) {
        confidence += oddsAge <= 3600 ? 0.05 : oddsAge > 7200 ? -0.15 : 0;
      }
      if ((model?.sampleHome ?? 0) >= 15 && (model?.sampleAway ?? 0) >= 15) {
        confidence += 0.04;
      }
      if (settled >= 30) confidence += 0.03;
      if (assessment?.status === 'REJECTED') confidence -= 0.2;
      confidence = clamp(confidence - disagreement * 0.6, 0.1, 1);
      const band = bandFromConfidence(confidence);

      const edge = blendedP - fair;
      const edgeScore = clamp(edge / 0.12, 0, 1);
      const evScore = clamp(evStress / 0.12, 0, 1);
      const agreementScore = clamp(1 - disagreement / 0.25, 0, 1);
      const aiScore = Math.round(
        100 * (0.26 * edgeScore + 0.34 * evScore + 0.24 * confidence + 0.16 * agreementScore)
      );

      const promoted = promotedKeys.has(selection.key);
      const risks: string[] = [];
      const reasons: string[] = [];

      const signalNames = contributions.map((c) => c.name);
      reasons.push(
        `${signalNames.length} independent models agree on a ${(blendedP * 100).toFixed(1)}% probability`
      );
      if (edge > 0) {
        reasons.push(`Model probability sits ${(edge * 100).toFixed(1)} points above the de-vigged price`);
      }
      if (evStress > 0) {
        reasons.push(`Stressed EV is +${(evStress * 100).toFixed(1)}% per unit staked`);
      }
      if (promoted) reasons.push("On the Positive ROI desk's promoted list");
      if (historyRow && settled >= 30 && historyRoi !== null) {
        reasons.push(
          `${settled} settled selections at ${historyRoi.toFixed(1)}% historical ROI (small prior only)`
        );
      }
      if (qualifiedKeys.has(`${fixture.id}:${market.id}`)) {
        reasons.push("On today's qualified-picks table");
      }

      if (disagreement > 0.15) {
        risks.push(`Models disagree by ${(disagreement * 100).toFixed(0)} points`);
      }
      if (band === 'Speculative') risks.push('Low-confidence estimate');
      if (oddsAge !== null && oddsAge > 7200) risks.push('Price more than 2 hours old');
      if (!assessment?.marketComplete) risks.push('Incomplete benchmark book');
      if (!calibration) {
        risks.push('No settled calibration for this market yet');
      } else if (calibration.status === 'poor') {
        risks.push(`Market calibration is weak (Brier ${calibration.brier.toFixed(2)})`);
      } else if (calibration.status === 'thin') {
        risks.push(`Only ${calibration.settled} settled market samples`);
      }
      if (assessment?.status === 'REJECTED') {
        const codes = (assessment.reasonCodes ?? [])
          .map((code) => code.toLowerCase().replace(/_/g, ' '))
          .join(', ');
        risks.push(`Framework rejected this market${codes ? ` (${codes})` : ''}; ensemble disagrees`);
      }
      for (const flag of assessment?.flags ?? []) {
        risks.push(flag.toLowerCase().replace(/_/g, ' '));
      }
      if (input.combination?.caveats?.length && band === 'Speculative') {
        risks.push('Historical ROI study has small samples in some bands');
      }

      const pick: AiPick = {
        fixtureId: fixture.id,
        homeTeam: fixture.homeTeam,
        awayTeam: fixture.awayTeam,
        competition: fixture.competition,
        country: fixture.country,
        kickoffTime: fixture.kickoffTime,
        kickoffTimestamp: finite(fixture.kickoffTimestamp)
          ? fixture.kickoffTimestamp
          : null,
        marketId: market.id,
        marketType: market.marketType,
        selectionKey: selection.key,
        label: market.label,
        odds: market.odds,
        bookmaker: market.bookmaker ?? fixture.bookmakerName ?? null,
        pModel: blendedP,
        pStress: decisionP,
        pFair: fair,
        edge,
        ev,
        evStress,
        aiScore,
        band,
        confidence,
        disagreement,
        stakePct: stakeFor(decisionP, market.odds, confidence, disagreement, 0.02),
        frameworkStatus: assessment?.status ?? fixture.framework?.status ?? null,
        frameworkConfidence: assessment?.confidence ?? fixture.framework?.confidence ?? null,
        calibration,
        signals: {
          framework: frameworkP,
          poisson: poissonP,
          provider: providerP,
          bookFair: fair,
          historyRoi,
          historySample: settled,
          promoted,
        },
        reasons,
        risks,
      };
      const narrative = narratives[`${fixture.id}:${market.id}`];
      if (narrative) pick.narrative = narrative;
      picks.push(pick);
      diagnostics.eligibleMarkets += 1;
    }
  }

  picks.sort((a, b) => b.aiScore - a.aiScore || b.evStress - a.evStress);
  const top = picks.slice(0, 60);

  const avgScore = top.length
    ? top.reduce((sum, pick) => sum + pick.aiScore, 0) / top.length
    : 0;
  const bestEv = top.length ? Math.max(...top.map((pick) => pick.evStress)) : 0;
  const strong = top.filter((pick) => pick.band === 'High' || pick.band === 'Solid').length;
  const summary = top.length
    ? `${top.length} selections cleared the stressed-EV gate on ${displayDate}. ` +
      `Average AI score ${avgScore.toFixed(0)}/100, best stressed EV ` +
      `${(bestEv * 100).toFixed(1)}%, ${strong} high/solid-confidence estimates. ` +
      `Ranked by stressed EV and model agreement, never by hit rate alone.`
    : `No priced selection on ${displayDate} cleared the stressed-EV gate. ` +
      'That is a valid result: a quiet day is not a reason to force a pick.';

  const promotedCount = registry.filter((entry) => entry.status === 'promoted').length;
  const inputs: AiInputRead[] = [
    {
      page: 'Matchday Slate',
      label: 'Prices, form and framework',
      detail: `${fixtures.length} fixtures · ${diagnostics.marketsScanned} priced selections assessed`,
      records: diagnostics.marketsScanned,
    },
    {
      page: 'Analytics',
      label: 'Historical selection performance',
      detail: `${analytics?.sampleDates ?? 0} matchdays · ${analytics?.marketsBySelection.length ?? 0} selection records`,
      records: analytics?.marketsBySelection.length ?? 0,
    },
    {
      page: 'Positive ROI',
      label: 'Promoted selections and daily table',
      detail: `${promotedCount} promoted of ${registry.length} tracked · ${qualified?.rows.length ?? 0} daily rows`,
      records: registry.length,
    },
    {
      page: 'My Activity / Ledger',
      label: 'Shadow-ticket record and closing line',
      detail: `${ledger?.decided ?? 0} settled tickets · ROI ${
        ledger?.roi === null || ledger?.roi === undefined
          ? 'n/a'
          : `${ledger.roi.toFixed(1)}%`
      } · avg CLV ${
        ledger?.avgClv === null || ledger?.avgClv === undefined
          ? 'n/a'
          : `${ledger.avgClv.toFixed(2)}%`
      }`,
      records: ledger?.tickets ?? 0,
    },
    {
      page: 'Sources',
      label: 'Data provenance',
      detail: `${sources.length} grounded links captured with the slate`,
      records: sources.length,
    },
    {
      page: 'AI Models',
      label: 'Free local ensemble',
      detail: 'Framework scoreline · Poisson · provider 1X2 · de-vigged book · shrunken historical prior',
      records: 5,
    },
  ];

  return {
    dateIso,
    displayDate,
    strategy,
    generatedAt: new Date().toISOString(),
    modelVersion: AI_MODEL_VERSION,
    narrativeProvider: input.narrativeProvider ?? null,
    narrativeNote:
      input.narrativeNote ??
      'Plain-English notes are optional. All probabilities come from the local ensemble already in the workbench.',
    avgClv: finite(ledger?.avgClv) ? (ledger!.avgClv as number) : null,
    marketFilter,
    competitionFilter,
    summary,
    inputs,
    picks: top,
    diagnostics,
    disclaimer:
      'Research and decision support only. Model probabilities are estimates, not certainties. ' +
      'Accumulators multiply uncertainty; never stake more than you can lose. 18+.',
  };
}

/* ------------------------------------------------------------------ */
/* Accumulator builder                                                 */
/* ------------------------------------------------------------------ */

export interface AccumulatorInput {
  dateIso: string;
  picks: AiPick[];
  targetOdds: number;
  maxLegs: number;
  riskMode: AiRiskMode;
  /** Same 0..100 bar the desk uses to shortlist picks; 0 keeps every pick. */
  minScore?: number;
}

interface CandidateSet {
  legs: AiPick[];
  totalOdds: number;
  probability: number;
  ev: number;
  avgScore: number;
  avgConfidence: number;
  sharedCompetitions: number;
}

/** Hard ceiling for AI desk accumulators, matching the framework's five-leg cap. */
export const MAX_AI_ACCUMULATOR_LEGS = 5;

/** Enumerate small leg sets, then pick the best risk-adjusted combination. */
export function buildAiAccumulator(input: AccumulatorInput): AiAccumulatorResponse {
  const { dateIso, picks, riskMode } = input;
  const maxLegs = clamp(Math.floor(input.maxLegs), 2, MAX_AI_ACCUMULATOR_LEGS);
  const targetOdds = clamp(input.targetOdds, 1.5, 100);
  const minScore = clamp(input.minScore ?? 0, 0, 100);

  const minBand: AiConfidenceBand[] =
    riskMode === 'conservative'
      ? ['High', 'Solid']
      : riskMode === 'balanced'
        ? ['High', 'Solid', 'Moderate']
        : ['High', 'Solid', 'Moderate', 'Speculative'];
  // A small model edge does not justify a near-lottery ticket. Even the wide
  // mode keeps a floor on the combined hit chance before odds are considered.
  // That floor is deliberately on the *combined* chance: a five-leg ticket needs
  // stronger per-leg confidence than a two-leg one, so raising the leg ceiling
  // never quietly turns a conservative desk into a lottery ticket generator.
  const minHitProbability =
    riskMode === 'conservative' ? 0.12 : riskMode === 'balanced' ? 0.06 : 0.03;
  // The score bar excludes picks from the ticket exactly as it does from the
  // ranked list on screen; without this the ticket could include picks the
  // user had filtered out.
  const pool = picks
    .filter(
      (pick) =>
        pick.aiScore >= minScore && pick.evStress > 0 && minBand.includes(pick.band)
    )
    .slice(0, 22);

  const maxPerCompetition = riskMode === 'conservative' ? 1 : 2;
  const candidates: CandidateSet[] = [];

  const evaluate = (legs: AiPick[]): void => {
    const totalOdds = legs.reduce((product, leg) => product * leg.odds, 1);
    const probability = legs.reduce((product, leg) => product * leg.pStress, 1);
    const ev = probability * totalOdds - 1;
    const counts = new Map<string, number>();
    for (const leg of legs) counts.set(leg.competition, (counts.get(leg.competition) ?? 0) + 1);
    const sharedCompetitions = [...counts.values()].filter((count) => count > 1).length;
    candidates.push({
      // Copy: the recursive builder reuses and pops `chosen` after each visit.
      legs: [...legs],
      totalOdds,
      probability,
      ev,
      avgScore: legs.reduce((sum, leg) => sum + leg.aiScore, 0) / legs.length,
      avgConfidence: legs.reduce((sum, leg) => sum + leg.confidence, 0) / legs.length,
      sharedCompetitions,
    });
  };

  const visit = (start: number, chosen: AiPick[], competitionCounts: Map<string, number>): void => {
    if (chosen.length >= 2) evaluate(chosen);
    if (chosen.length === maxLegs) return;
    for (let index = start; index < pool.length; index += 1) {
      const leg = pool[index];
      if (chosen.some((existing) => existing.fixtureId === leg.fixtureId)) continue;
      const inLeague = competitionCounts.get(leg.competition) ?? 0;
      if (inLeague >= maxPerCompetition) continue;
      competitionCounts.set(leg.competition, inLeague + 1);
      chosen.push(leg);
      visit(index + 1, chosen, competitionCounts);
      chosen.pop();
      competitionCounts.set(leg.competition, inLeague);
    }
  };
  visit(0, [], new Map());

  const scoreSet = (set: CandidateSet): number =>
    set.ev * 2.2 +
    (set.avgScore / 100) * 0.3 +
    Math.log(set.totalOdds) * 0.05 -
    set.sharedCompetitions * 0.04 -
    (set.legs.length === 2 && maxLegs > 2 ? 0.02 : 0);

  const admissible = candidates.filter((set) => set.probability >= minHitProbability);
  const onTarget = admissible.filter((set) => set.totalOdds >= targetOdds);
  const ranked = [...(onTarget.length ? onTarget : admissible)].sort(
    (a, b) => scoreSet(b) - scoreSet(a)
  );
  const best = ranked[0];

  const rejected = pool
    .filter((pick) => !best?.legs.some((leg) => leg.fixtureId === pick.fixtureId))
    .slice(0, 8)
    .map((pick) => ({
      fixtureId: pick.fixtureId,
      marketId: pick.marketId,
      reason:
        pick.band === 'Speculative'
          ? 'Low-confidence estimate excluded by this risk mode'
          : 'Lower risk-adjusted contribution than the selected legs',
    }));

  if (!best) {
    return {
      dateIso,
      generatedAt: new Date().toISOString(),
      riskMode,
      targetOdds,
      maxLegs,
      legs: [],
      totalOdds: 0,
      hitProbability: 0,
      breakEvenProbability: 0,
      evStress: 0,
      stakePct: 0,
      targetReached: false,
      reason:
        `No qualifying selections cleared the ${minScore > 0 ? `model-score bar of ${minScore}, stressed-EV, ` : 'stressed-EV, '}` +
        'confidence and combined hit-probability gate for this risk mode. ' +
        'An empty ticket is the correct answer on a thin slate.',
      risks: [],
      rejected: [],
      disclaimer: 'Research/shadow only. Accumulator probabilities assume independent outcomes.',
    };
  }

  const odds = Math.round(best.totalOdds * 100) / 100;
  const breakEvenProbability = 1 / odds;
  const b = odds - 1;
  const fullKelly = (best.probability * b - (1 - best.probability)) / b;
  const stakePct = clamp(
    fullKelly > 0 ? fullKelly * 0.25 * best.avgConfidence : 0,
    0,
    0.01
  );

  const risks: string[] = [
    'Combined hit probability assumes independent outcomes; shared competitions are penalised but not eliminated.',
  ];
  if (best.sharedCompetitions > 0) {
    risks.push(`${best.sharedCompetitions} competition overlap increases correlation risk.`);
  }
  if (best.totalOdds < targetOdds) {
    risks.push(`Target of ${targetOdds.toFixed(2)} was not reachable without lowering selection quality.`);
  }
  if (best.ev <= 0) risks.push('Combined stressed EV is not positive.');

  const legs: AiTicketLeg[] = best.legs.map((leg) => ({
    fixtureId: leg.fixtureId,
    marketId: leg.marketId,
    homeTeam: leg.homeTeam,
    awayTeam: leg.awayTeam,
    competition: leg.competition,
    kickoffTime: leg.kickoffTime,
    label: leg.label,
    marketType: leg.marketType,
    odds: leg.odds,
    pModel: leg.pModel,
    pStress: leg.pStress,
    aiScore: leg.aiScore,
    band: leg.band,
  }));

  return {
    dateIso,
    generatedAt: new Date().toISOString(),
    riskMode,
    targetOdds,
    maxLegs,
    legs,
    totalOdds: odds,
    hitProbability: best.probability,
    breakEvenProbability,
    evStress: best.ev,
    stakePct,
    targetReached: best.totalOdds >= targetOdds,
    reason:
      `${legs.length} legs from ${new Set(legs.map((leg) => leg.fixtureId)).size} matches, ` +
      `combined ${odds.toFixed(2)} odds and ${(best.probability * 100).toFixed(1)}% model hit chance ` +
      `against ${(breakEvenProbability * 100).toFixed(1)}% break-even. ` +
      `Ranked on stressed EV (${(best.ev * 100).toFixed(1)}%), not on the size of the odds.`,
    risks,
    rejected,
    disclaimer: 'Research/shadow only. Accumulator probabilities assume independent outcomes.',
  };
}
