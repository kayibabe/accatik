import type {
  ConfidenceClass,
  FrameworkConfig,
  FrameworkStatus,
  MarketKey,
  ReasonCode,
  SuitabilityFlag,
} from './config.ts';
import {
  DEFAULT_FRAMEWORK_CONFIG,
  FRAMEWORK_VERSION,
  STATUS_RANK,
} from './config.ts';
import type {
  TeamMatchResult,
  ProviderIndices,
  FrameworkModelInput,
} from './model.ts';
import { buildModelInput } from './model.ts';
import { buildMatrixFromConfig, deriveMarketProbabilities, matrixConsistencyFailures } from './scoreline.ts';
import { buildBenchmark, type BookPrice } from './benchmark.ts';
import { assessIndexFlags, drawRiskFlag, type ThreeWayProbabilities } from './suitability.ts';
import { evaluateValue, type ValueAssessment } from './value.ts';
import { confidencePasses, qualifyCandidate } from './qualification.ts';
import {
  assessMarketConfidence,
  type MarketCalibrationRecord,
} from './confidence.ts';
import {
  marketScreeningFlags,
  teamGoalsContext,
  type TeamGoalsContext,
} from './marketRules.ts';

/**
 * Assessment layer: joins the framework core to one priced fixture.
 *
 * The pure core does not know about the app's `Fixture` shape. The server maps
 * a fixture into `AssessmentFixtureInput` and copies the result back onto the
 * market options.
 */

export interface AssessmentMarketInput {
  id: string;
  selectionKey: MarketKey;
  odds: number;
  bookmaker?: string;
}

export interface AssessmentFixtureInput {
  id: string;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  country: string;
  matchDateIso: string;
  kickoffTimestamp?: number;
  status: 'Scheduled' | 'Live' | 'Finished' | 'Void';
  pricedAt?: string;
  markets: AssessmentMarketInput[];
  allMarkets?: AssessmentMarketInput[];
  /** Comparative provider indices, only when a provider supplied them. */
  providerIndices?: ProviderIndices;
}

export interface MarketFrameworkAssessment {
  marketId: string;
  selectionKey: MarketKey;
  status: FrameworkStatus;
  reasonCodes: ReasonCode[];
  pModel: number | null;
  pFair: number | null;
  /** Fraction, not percentage points. */
  edge: number | null;
  relativeEdge: number | null;
  ev: number | null;
  evStress: number | null;
  pStress: number | null;
  fairOdds: number | null;
  confidence: ConfidenceClass;
  /** Why this market's confidence differs from the fixture baseline (§12). */
  confidenceDowngrades: string[];
  flags: SuitabilityFlag[];
  /** §10.5 context, present only on team-goals markets. */
  marketContext: TeamGoalsContext | null;
  oddsAgeSeconds: number | null;
  marketComplete: boolean;
  benchmarkBook: string | null;
  executionBook: string | null;
  value: ValueAssessment | null;
  /** Set by the slate controller once caps have been applied. */
  staked?: boolean;
  /** Cap reason codes added after the original decision was recorded. */
  capReasonCodes?: ReasonCode[];
  /** Settled Brier evidence for this selection, when the ledger has enough history. */
  calibration?: MarketCalibrationRecord | null;
  /** True when no settled calibration record was available at decision time. */
  calibrationUnavailable?: boolean;
}

export interface FixtureModelSummary {
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
}

export interface FixtureFrameworkAssessment {
  version: string;
  modelVersion: string;
  status: FrameworkStatus;
  confidence: ConfidenceClass;
  dataOk: boolean;
  flags: SuitabilityFlag[];
  reasonCodes: ReasonCode[];
  model: FixtureModelSummary | null;
  markets: MarketFrameworkAssessment[];
  summary: string;
}

export interface AssessFixtureOptions {
  nowMs?: number;
  config?: Partial<FrameworkConfig>;
  /** Injected model input, for tests or a validated external model adapter. */
  modelInput?: FrameworkModelInput;
  /** Market-level Brier evidence from settled ledger legs, keyed by selection. */
  calibration?: Record<MarketKey, MarketCalibrationRecord> | null;
}

function oddsAge(
  fixture: AssessmentFixtureInput,
  nowMs: number,
  config: FrameworkConfig
): { age: number | null; ok: boolean } {
  if (!fixture.pricedAt) return { age: null, ok: false };
  const captured = Date.parse(fixture.pricedAt);
  if (!Number.isFinite(captured)) return { age: null, ok: false };
  const decisionMs =
    fixture.status === 'Scheduled'
      ? nowMs
      : (fixture.kickoffTimestamp ?? nowMs);
  const age = (decisionMs - captured) / 1000;
  return {
    age: Math.max(0, Math.round(age)),
    ok: age >= 0 && age <= config.maxOddsAgeSeconds,
  };
}

function fair1x2From(
  probabilities: Record<MarketKey, number>
): ThreeWayProbabilities {
  return {
    home: probabilities['1X2-H'],
    draw: probabilities['1X2-D'],
    away: probabilities['1X2-A'],
  };
}

function fixtureReasonCodes(
  markets: MarketFrameworkAssessment[]
): ReasonCode[] {
  return [...new Set(markets.flatMap((market) => market.reasonCodes))];
}

function fixtureStatus(
  markets: MarketFrameworkAssessment[]
): FrameworkStatus {
  if (markets.length === 0) return 'INSUFFICIENT_DATA';
  return markets.reduce<FrameworkStatus>(
    (best, market) =>
      STATUS_RANK[market.status] > STATUS_RANK[best] ? market.status : best,
    'INSUFFICIENT_DATA'
  );
}

/**
 * Assesses every priced market on one fixture. The function is deterministic
 * for a given history snapshot and `nowMs`.
 */
export function assessFixtureFramework(
  fixture: AssessmentFixtureInput,
  history: TeamMatchResult[],
  options: AssessFixtureOptions = {}
): FixtureFrameworkAssessment {
  const cfg = { ...DEFAULT_FRAMEWORK_CONFIG, ...options.config };
  const nowMs = options.nowMs ?? Date.now();
  const priced = (fixture.allMarkets ?? fixture.markets).filter(
    (market) => Number.isFinite(market.odds) && market.odds > 1
  );
  const age = oddsAge(fixture, nowMs, cfg);
  const teamKey = (name: string): string =>
    `${fixture.country}::${name.trim().toLowerCase()}`;

  const modelInput = options.modelInput ?? buildModelInput({
    homeTeamId: teamKey(fixture.homeTeam),
    awayTeamId: teamKey(fixture.awayTeam),
    competitionId: `${fixture.country}::${fixture.competition.trim().toLowerCase()}`,
    asOfIso: fixture.matchDateIso,
    results: history,
    config: cfg,
    providerIndices: fixture.providerIndices,
  });

  if (!modelInput) {
    const markets: MarketFrameworkAssessment[] = priced.map((market) => ({
      marketId: market.id,
      selectionKey: market.selectionKey,
      status: 'INSUFFICIENT_DATA',
      reasonCodes: ['DATA_QUALITY_FAILURE'],
      pModel: null,
      pFair: null,
      edge: null,
      relativeEdge: null,
      ev: null,
      evStress: null,
      pStress: null,
      fairOdds: null,
      confidence: 'Insufficient evidence',
      confidenceDowngrades: [],
      flags: [],
      marketContext: null,
      oddsAgeSeconds: age.age,
      marketComplete: false,
      benchmarkBook: null,
      executionBook: market.bookmaker ?? null,
      value: null,
      calibration: null,
      calibrationUnavailable: true,
    }));
    return {
      version: FRAMEWORK_VERSION,
      modelVersion: cfg.modelVersion,
      status: 'INSUFFICIENT_DATA',
      confidence: 'Insufficient evidence',
      dataOk: false,
      flags: [],
      reasonCodes: ['DATA_QUALITY_FAILURE'],
      model: null,
      markets,
      summary:
        'No model-derived probability: both teams need completed matches before this fixture can be assessed.',
    };
  }

  const matrix = buildMatrixFromConfig(
    modelInput.lambdaHome,
    modelInput.lambdaAway,
    cfg
  );
  const probabilities = deriveMarketProbabilities(matrix.matrix);
  const consistency = matrixConsistencyFailures(probabilities);
  const dataOk =
    modelInput.dataOk &&
    matrix.tail <= cfg.maxOmittedTail &&
    consistency.length === 0;

  const prices: BookPrice[] = priced.map((market) => ({
    selectionKey: market.selectionKey,
    odds: market.odds,
    bookmaker: market.bookmaker,
  }));
  const benchmark = buildBenchmark(prices, cfg);
  const model1x2 = fair1x2From(probabilities);
  const benchmark1x2 = benchmark.entries.has('1X2-H')
    ? {
        home: benchmark.entries.get('1X2-H')?.pFair ?? 0,
        draw: benchmark.entries.get('1X2-D')?.pFair ?? 0,
        away: benchmark.entries.get('1X2-A')?.pFair ?? 0,
      }
    : null;

  const providerIndices = modelInput.providerIndices ?? fixture.providerIndices;
  const flags: SuitabilityFlag[] = [];
  if (providerIndices) {
    flags.push(
      ...assessIndexFlags({
        attack: {
          home: providerIndices.attackHome,
          away: providerIndices.attackAway,
        },
        defence: {
          home: providerIndices.defenceHome,
          away: providerIndices.defenceAway,
        },
        fair1x2: benchmark1x2,
        model1x2,
        config: cfg,
      })
    );
  }
  const drawRisk = drawRiskFlag(model1x2, cfg);
  if (drawRisk && !flags.includes(drawRisk)) flags.push(drawRisk);
  flags.push(...marketScreeningFlags(modelInput, cfg));

  const markets: MarketFrameworkAssessment[] = priced.map((market) => {
    const pModel = probabilities[market.selectionKey] ?? null;
    const calibration = options.calibration?.[market.selectionKey] ?? null;
    const marketConfidence = assessMarketConfidence(
      {
        base: modelInput.confidence,
        market: market.selectionKey,
        pModel: pModel ?? 0.5,
        sampleSize: Math.min(modelInput.sampleHome, modelInput.sampleAway),
        oddsAgeSeconds: age.age,
        calibration,
      },
      cfg
    );
    const marketContext = teamGoalsContext(market.selectionKey, modelInput);
    const benchmarkEntry = benchmark.entries.get(market.selectionKey) ?? null;
    const pFair = benchmarkEntry?.pFair ?? null;
    const marketComplete = benchmarkEntry?.complete ?? false;

    const value =
      pModel !== null && pFair !== null
        ? evaluateValue({ pModel, pFair, odds: market.odds, config: cfg })
        : null;

    const result = qualifyCandidate({
      market: market.selectionKey,
      dataOk: dataOk && (pModel === null || pFair !== null),
      flags,
      value,
      formHome: modelInput.formHome,
      formAway: modelInput.formAway,
      model1x2,
      oddsAgeOk: age.ok,
      marketComplete,
      usesProviderProb: false,
      providerAudited: cfg.providerAudited,
      criticalFlags: [],
      confidenceOk:
        dataOk &&
        confidencePasses(marketConfidence.confidence, cfg.minConfidence),
      confidence: marketConfidence.confidence,
      marketContext,
    });

    return {
      marketId: market.id,
      selectionKey: market.selectionKey,
      status: result.status,
      reasonCodes: result.reasonCodes,
      pModel,
      pFair,
      edge: value?.edge ?? null,
      relativeEdge: value?.relativeEdge ?? null,
      ev: value?.ev ?? null,
      evStress: value?.evStress ?? null,
      pStress: value?.pStress ?? null,
      fairOdds: value?.fairOdds ?? null,
      confidence: marketConfidence.confidence,
      confidenceDowngrades: marketConfidence.downgrades,
      flags,
      marketContext,
      oddsAgeSeconds: age.age,
      marketComplete,
      benchmarkBook: benchmarkEntry?.book ?? benchmark.benchmarkBook,
      executionBook: market.bookmaker ?? null,
      value,
      calibration,
      calibrationUnavailable: marketConfidence.calibrationUnavailable,
    };
  });

  const status = fixtureStatus(markets);
  const qualified = markets.filter((market) => market.status === 'QUALIFIED').length;
  const review = markets.filter(
    (market) => market.status === 'CONDITIONAL_REVIEW'
  ).length;
  const screenOnly = markets.filter(
    (market) => market.status === 'SCREEN_ONLY'
  ).length;

  return {
    version: FRAMEWORK_VERSION,
    modelVersion: modelInput.modelVersion,
    status,
    confidence: modelInput.confidence,
    dataOk,
    flags,
    reasonCodes: fixtureReasonCodes(markets),
    model: {
      lambdaHome: modelInput.lambdaHome,
      lambdaAway: modelInput.lambdaAway,
      rho: modelInput.rho,
      attackHome: modelInput.attackHome,
      attackAway: modelInput.attackAway,
      defenceHome: modelInput.defenceHome,
      defenceAway: modelInput.defenceAway,
      formHome: modelInput.formHome,
      formAway: modelInput.formAway,
      failedToScoreHome: modelInput.failedToScoreHome,
      failedToScoreAway: modelInput.failedToScoreAway,
      sampleHome: modelInput.sampleHome,
      sampleAway: modelInput.sampleAway,
      leagueMatches: modelInput.leagueMatches,
      leagueUsedFallback: modelInput.leagueUsedFallback,
    },
    markets,
    summary:
      `Model ${modelInput.modelVersion}: ${markets.length} priced markets, ` +
      `${qualified} qualified, ${review} held for review, ${screenOnly} screen-only.`,
  };
}
