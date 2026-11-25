import type { AccaStrategy, MarketType } from './fixtures.ts';

/**
 * AI desk contract, shared by the Express server, local CLI jobs and the
 * browser. Every probability in this file is a FRACTION (0..1) unless the
 * field name ends in `Pct` or `Points`.
 */

export type AiConfidenceBand = 'High' | 'Solid' | 'Moderate' | 'Speculative';
export type AiRiskMode = 'conservative' | 'balanced' | 'aggressive';

/** Settled Brier evidence for one canonical selection. */
export interface AiPickCalibration {
  settled: number;
  brier: number;
  status: 'verified' | 'thin' | 'poor' | 'unavailable';
}

/** Which free models contributed to one selection's probability. */
export interface AiModelSignals {
  /** Framework scoreline matrix probability (Dixon-Coles style). */
  framework: number | null;
  /** Independent Poisson probability derived from the framework's lambdas. */
  poisson: number | null;
  /** API-Football 1X2 model, mapped onto 1X2 / DC / DNB selections. */
  provider: number | null;
  /** Best de-vigged price from a complete book. */
  bookFair: number | null;
  /** Inception-to-date flat-stake ROI for this canonical selection. */
  historyRoi: number | null;
  /** Settled sample behind historyRoi. */
  historySample: number;
  /** Whether the ROI registry has promoted this selection. */
  promoted: boolean;
}

export interface AiPick {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  country: string;
  kickoffTime: string;
  kickoffTimestamp: number | null;
  marketId: string;
  marketType: MarketType;
  selectionKey: string;
  label: string;
  odds: number;
  bookmaker: string | null;
  /** Ensemble probability (fraction). */
  pModel: number;
  /** Stressed decision probability after uncertainty haircut (fraction). */
  pStress: number;
  /** De-vigged market probability (fraction). */
  pFair: number;
  /** pModel − pFair, as a fraction. */
  edge: number;
  /** pModel × odds − 1, as a fraction. */
  ev: number;
  /** pStress × odds − 1, as a fraction. Used for ranking and staking. */
  evStress: number;
  /** 0..100 composite score. Not a win probability. */
  aiScore: number;
  band: AiConfidenceBand;
  /** 0..1 internal confidence in the estimate, not a bet recommendation. */
  confidence: number;
  /** Maximum disagreement between contributing models, as a fraction. */
  disagreement: number;
  /** Fractional Kelly suggestion as a fraction of bankroll, capped at 2%. */
  stakePct: number;
  frameworkStatus: string | null;
  frameworkConfidence: string | null;
  /** Settled market calibration behind this pick, when evidence exists. */
  calibration: AiPickCalibration | null;
  signals: AiModelSignals;
  reasons: string[];
  risks: string[];
  /** Optional free-tier LLM note; deterministic reasons are always present. */
  narrative?: string;
}

/** A short provenance line showing which part of the workbench was read. */
export interface AiInputRead {
  page: string;
  label: string;
  detail: string;
  records: number;
}

export interface AiBriefingResponse {
  dateIso: string;
  displayDate: string;
  strategy: AccaStrategy;
  generatedAt: string;
  modelVersion: string;
  /** Free-tier provider name when a language model added optional notes. */
  narrativeProvider: string | null;
  /** Status of the optional narrative layer, safe to display in the UI. */
  narrativeNote: string;
  /** Average closing-line value from settled shadow tickets, in percent. */
  avgClv: number | null;
  marketFilter: string;
  competitionFilter: string;
  summary: string;
  inputs: AiInputRead[];
  picks: AiPick[];
  diagnostics: {
    fixturesScanned: number;
    marketsScanned: number;
    eligibleMarkets: number;
    excludedStarted: number;
    excludedNoModel: number;
    excludedNegativeEv: number;
    cacheNote: string;
  };
  disclaimer: string;
}

/** Minimal leg shape passed back to the slip builder. */
export interface AiTicketLeg {
  fixtureId: string;
  marketId: string;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  kickoffTime: string;
  label: string;
  marketType: MarketType;
  odds: number;
  pModel: number;
  pStress: number;
  aiScore: number;
  band: AiConfidenceBand;
}

export interface AiAccumulatorResponse {
  dateIso: string;
  generatedAt: string;
  riskMode: AiRiskMode;
  targetOdds: number;
  maxLegs: number;
  minScore?: number;
  legs: AiTicketLeg[];
  totalOdds: number;
  /** Product of leg decision probabilities (fraction). */
  hitProbability: number;
  /** Break-even probability at the quoted price (fraction). */
  breakEvenProbability: number;
  /** Combined stressed EV as a fraction. */
  evStress: number;
  /** Fraction of bankroll suggested by capped fractional Kelly. */
  stakePct: number;
  targetReached: boolean;
  reason: string;
  risks: string[];
  rejected: Array<{ fixtureId: string; marketId: string; reason: string }>;
  disclaimer: string;
}

/** One row of settled AI Desk performance, graded with a flat one-unit stake. */
export interface AiPerformanceRow {
  key: string;
  label: string;
  settled: number;
  wins: number;
  losses: number;
  voids: number;
  /** Percentage of decided picks that won; null until one settles. */
  hitRate: number | null;
  /** Flat-stake ROI in percentage points; null until one settles. */
  roiPct: number | null;
  /** Flat-stake profit in units (wins pay quoted odds, losers cost one unit). */
  profitUnits: number;
  avgOdds: number | null;
  avgAiScore: number | null;
}

export interface AiPerformanceResponse {
  generatedAt: string;
  fromDateIso: string | null;
  toDateIso: string | null;
  modelVersion: string | null;
  sample: {
    snapshots: number;
    dates: number;
    archivedPicks: number;
    dedupedPicks: number;
    settled: number;
    wins: number;
    losses: number;
    voids: number;
    pending: number;
    /** Snapshots replayed by the backfill rather than captured live. */
    reconstructed: number;
  };
  /** Overall row first, then one row per model-score band. */
  rows: AiPerformanceRow[];
}
