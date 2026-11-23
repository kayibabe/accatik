import type {
  AccaStrategy,
  Fixture,
  MarketType,
  SettlementStatus,
} from './fixtures.ts';
import type {
  ConfidenceClass,
  FrameworkStatus,
  ReasonCode,
} from '../framework/config.ts';

/**
 * Flat-stake performance for one tracked pick or group of picks.
 *
 * Every archived price is settled with a one-unit stake, so rows are directly
 * comparable. Void stakes are returned and stay out of the stake, returns,
 * hit rate and ROI columns; only Win/Lost picks count towards the hit rate.
 */
export interface PickAnalyticsRow {
  key: string;
  label: string;
  settled: number;
  wins: number;
  losses: number;
  voids: number;
  hitRate: number | null;
  /** Stake on Win/Lost picks only. */
  stake: number;
  /** Returns from winners only; void stakes come back and are excluded. */
  returns: number;
  netPnl: number;
  roi: number | null;
  avgOdds: number | null;
  /** Average margin-adjusted win probability (percent) at the prices taken. */
  avgProbability: number | null;
  /** First/last matchday that contributed a settled pick. Set by the inception scan. */
  firstDateIso?: string;
  lastDateIso?: string;
}

export interface MarketAnalyticsRow extends PickAnalyticsRow {
  marketType: MarketType;
}

/** The three cards on a fixture that are tracked as featured picks. */
export type FeaturedPickSource = 'angle' | 'cover' | 'note';

/**
 * A featured pick rolled up by the card that published it and the canonical
 * selection it backed. `selectionKey` matches the individual-market rows (for
 * example `GOALS-O2.5`), so the same bet can be compared across both sections.
 */
export interface FeaturedAnalyticsRow extends PickAnalyticsRow {
  source: FeaturedPickSource;
  selectionKey: string;
  marketType: MarketType;
}

/** One matchday of cumulative performance, oldest first. */
export interface PickAnalyticsDay {
  dateIso: string;
  settled: number;
  featuredNetPnl: number;
  marketNetPnl: number;
  cumulativeFeatured: number;
  cumulativeMarkets: number;
}

export interface PickAnalyticsResponse {
  strategy: AccaStrategy;
  generatedAt: string;
  firstDateIso: string | null;
  lastDateIso: string | null;
  sampleDates: number;
  sampleFixtures: number;
  marketPicks: number;
  stakePerPick: number;
  priceQuality: { prematch: number; live: number; unknown: number };
  featured: PickAnalyticsRow[];
  /** Every featured pick, split by source then canonical selection. */
  featuredBySelection: FeaturedAnalyticsRow[];
  /** One roll-up row per market type, carrying its type for grouped rendering. */
  marketsByType: MarketAnalyticsRow[];
  /** Every priced selection, grouped by canonical selection rather than raw label. */
  marketsBySelection: MarketAnalyticsRow[];
  daily: PickAnalyticsDay[];
  /**
   * Per-pick outcomes behind `featuredBySelection`, used by the ROI promotion
   * job for a matchday-clustered bootstrap of each row's ROI interval.
   */
  featuredSelectionSamples?: FeaturedPickSample[];
}

/** One settled featured pick, tagged with the matchday it came from. */
export interface FeaturedPickSample {
  /** `${source}:${selectionKey}`, matching `FeaturedAnalyticsRow.key`. */
  key: string;
  dateIso: string;
  odds: number;
  won: boolean;
}

/* ------------------------------------------------------------------ */
/* Section x confidence band x market ROI study                        */
/* ------------------------------------------------------------------ */

/** Confidence bands published by the featured-pick engine. */
export type RoiBand = 'High' | 'Solid' | 'Moderate' | 'Speculative';

/** `All` is the aggregate across every band, not a fourth model band. */
export type CombinationRoiBand = RoiBand | 'All';

/**
 * Which family a combination row belongs to:
 *  - `section-band`: section x band x market (the main study)
 *  - `section`: section x market with every band pooled (the "All" chip)
 *  - `market`: every requested market staked directly from the price ladder
 */
export type CombinationRoiScope = 'section-band' | 'section' | 'market';

/** One flat-stake combination in the inception-to-date ROI study. */
export interface CombinationRoiRow {
  key: string;
  scope: CombinationRoiScope;
  /** Null only for direct-market rows. */
  section: FeaturedPickSource | null;
  band: CombinationRoiBand;
  marketKey: string;
  marketLabel: string;
  /** Win + Lost + Void. */
  settled: number;
  /** Win + Lost. Voids are returned and never risked. */
  staked: number;
  wins: number;
  losses: number;
  voids: number;
  winRate: number | null;
  avgOdds: number | null;
  netPnl: number;
  roi: number | null;
  /** Matchdays with a positive net result / matchdays with a staked pick. */
  positiveDates: number;
  totalDates: number;
  roiCiLow: number | null;
  roiCiHigh: number | null;
  firstDateIso: string | null;
  lastDateIso: string | null;
  /** Below the study's minimum settled count: descriptive, not evidence. */
  smallSample: boolean;
}

export interface CombinationRoiMarket {
  key: string;
  label: string;
}

export interface CombinationRoiResponse {
  strategy: AccaStrategy;
  generatedAt: string;
  firstDateIso: string | null;
  lastDateIso: string | null;
  sampleDates: number;
  sampleFixtures: number;
  stakePerPick: number;
  minSample: number;
  bands: RoiBand[];
  markets: CombinationRoiMarket[];
  /** All three scopes; the view filters by `scope` and `band`. */
  rows: CombinationRoiRow[];
  priceQuality: PickAnalyticsResponse['priceQuality'];
  /** How many settled fixtures still carry a frozen featured-pick snapshot. */
  snapshotFixtures: number;
  caveats: string[];
}

/* ------------------------------------------------------------------ */
/* Daily matches behind a positive section x band x market read        */
/* ------------------------------------------------------------------ */

/**
 * One `section × band × market` cell whose inception-to-date ROI is positive.
 * These are the parameters used to label matches in the daily feed.
 */
export interface PositiveReadCombo {
  /** The study row key: `${section}:${band}:${marketKey}`. */
  key: string;
  section: FeaturedPickSource;
  sectionLabel: string;
  band: RoiBand;
  marketKey: string;
  marketLabel: string;
  /** `Analyst Note · High · Over 2.5 Goals`. */
  label: string;
  roi: number | null;
  staked: number;
  smallSample: boolean;
  roiCiLow: number | null;
}

/** A matchday fixture and every positive combination its cards matched. */
export interface PositiveReadMatch {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  country: string;
  kickoffTime: string;
  kickoffTimestamp: number | null;
  status: Fixture['status'];
  /** `2–1`, or null before a final score exists. */
  score: string | null;
  /** Every positive parameter this fixture matched, band then section order. */
  combos: PositiveReadCombo[];
}

export interface PositiveReadMatchesResponse {
  strategy: AccaStrategy;
  dateIso: string;
  /** Archive is the default; live explicitly pulls the upstream slate. */
  source: 'archive' | 'live';
  generatedAt: string;
  /** Most recent archived matchdays, newest first, for the date picker. */
  availableDates: string[];
  /** The active positive-read parameters driving this feed. */
  combos: PositiveReadCombo[];
  matches: PositiveReadMatch[];
  caveats: string[];
}

export interface AnalyticsRefreshResult {
  checkedDates: string[];
  refreshedDates: string[];
  changedDates: string[];
  errors: string[];
  /** Set when the upstream feed is not configured. */
  skipped?: string;
}

/* ------------------------------------------------------------------ */
/* Positive-ROI promotion registry                                     */
/* ------------------------------------------------------------------ */

/** Lifecycle of a featured selection in the ROI registry. */
export type RoiRegistryStatus = 'watch' | 'promoted' | 'demoted' | 'retired';

/**
 * One persisted `(strategy, source, selectionKey)` row. Only `promoted` rows are
 * admitted to a research accumulator; the other states keep the history so a
 * noisy daily snapshot cannot silently rewrite it.
 */
export interface RoiRegistryEntry {
  strategy: AccaStrategy;
  source: FeaturedPickSource;
  selectionKey: string;
  marketType: MarketType;
  label: string;
  settled: number;
  wins: number;
  losses: number;
  roi: number | null;
  roiCiLow: number | null;
  roiCiHigh: number | null;
  hitRateCiLow: number | null;
  hitRateCiHigh: number | null;
  avgOdds: number | null;
  firstDateIso: string | null;
  lastDateIso: string | null;
  status: RoiRegistryStatus;
  promotedAt: string | null;
  /** Snapshot where the settled count last increased. */
  lastSeenDateIso: string | null;
  /** Consecutive snapshots that met every promotion rule. */
  qualifyingStreak: number;
  /** Consecutive snapshots that failed at least one rule. */
  failingStreak: number;
  reason: string;
  snapshotDateIso: string;
}

/** Tunable thresholds for the daily promotion state machine. */
export interface RoiPromotionConfig {
  /** Prematch-only analytics are supplied by the caller; this records the intent. */
  prematchOnly: boolean;
  minSettled: number;
  minSpanDays: number;
  /** Lower bound of the clustered ROI interval must clear zero. */
  requirePositiveCi: boolean;
  /** Consecutive qualifying snapshots before a row is promoted. */
  promoteAfter: number;
  /** Consecutive failing snapshots before a promoted row is demoted. */
  demoteAfter: number;
  /** Days without a new settled pick before a row is retired. */
  retireAfterDays: number;
}

export interface RoiPromotionResult {
  strategy: AccaStrategy;
  snapshotDateIso: string;
  config: RoiPromotionConfig;
  entries: RoiRegistryEntry[];
  promotedKeys: string[];
  /** Human-readable summary of this snapshot's transitions. */
  transitions: string[];
  analytics: {
    generatedAt: string;
    sampleDates: number;
    sampleFixtures: number;
    priceQuality: PickAnalyticsResponse['priceQuality'];
  };
}

/** One qualified/considered market on the daily table. */
export interface QualifiedPickRow {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  kickoffTimestamp: number | null;
  kickoffCat: string;
  source: FeaturedPickSource;
  selectionKey: string;
  selectionLabel: string;
  marketType: MarketType;
  marketId: string;
  odds: number;
  fairProbability: number | null;
  /** Outcome of this card's selection in this fixture. Optional for older cached rows. */
  result?: SettlementStatus;
  status: RoiRegistryStatus | 'untracked';
  roi: number | null;
  roiCiLow: number | null;
  roiCiHigh: number | null;
  settled: number;
  eligibleForAcca: boolean;
  reason: string;
  /** Framework decision for this card's selection, when one was assessed. */
  frameworkStatus?: FrameworkStatus | null;
  frameworkReasonCodes?: ReasonCode[];
  frameworkConfidence?: ConfidenceClass | null;
  /** Fraction, not percentage points. */
  frameworkEdge?: number | null;
  frameworkEvStress?: number | null;
}

export interface QualifiedPicksResponse {
  dateIso: string;
  strategy: AccaStrategy;
  generatedAt: string;
  rows: QualifiedPickRow[];
  /** Number of rows currently admitted to the research accumulator. */
  eligibleCount: number;
}

/** Research accumulator result returned by the ROI builder. */
export interface RoiAccaResponse {
  dateIso: string;
  strategy: AccaStrategy;
  targetOdds: number;
  maxLegs: number;
  legs: import('./fixtures.ts').AccaLeg[];
  totalOdds: number;
  targetReached: boolean;
  economics: import('./fixtures.ts').TicketEconomicsSummary;
  recommended: false;
  /** Hard guarantee: generated tickets live in the shadow ledger, never at a bookmaker. */
  mode: 'research-shadow';
  /** Flat one-unit stake used when the shadow ticket is recorded. */
  stake: 1;
  reason: string;
  riskWarning: string;
  /** Qualified rows that were not used, with the reason for exclusion. */
  rejected: Array<{ fixtureId: string; marketId: string; reason: string }>;
}

/* ------------------------------------------------------------------ */
/* Accumulator ticket replay                                           */
/* ------------------------------------------------------------------ */

/** One control combination replayed against the archived matchdays. */
export interface TicketVariantConfig {
  id: string;
  label: string;
  /** Which slip control this row explains. */
  group: 'shape' | 'strategy' | 'odds' | 'legs' | 'current';
  strategy: AccaStrategy;
  /** The slip's "Min Odds" value, i.e. the builder target. */
  targetOdds: number;
  maxLegs: number;
  description?: string;
}

export type TicketReplayStatus = 'Win' | 'Lost' | 'Void';

/** One matchday's reconstructed ticket for a control combination. */
export interface TicketReplayDay {
  dateIso: string;
  status: TicketReplayStatus;
  legs: number;
  odds: number;
  /** Whether the built ticket actually reached the requested target. */
  targetMet: boolean;
}

export interface TicketReplaySummary {
  /** Matchdays where the builder produced a settleable ticket. */
  tickets: number;
  wins: number;
  losses: number;
  voids: number;
  hitRate: number | null;
  /** Hit rate needed to break even at the average price taken. */
  breakEvenHitRate: number | null;
  /** Share of tickets whose combined odds reached the target. */
  targetHitRate: number | null;
  /** Flat one-unit stake per ticket; voids are returned, not staked. */
  roi: number | null;
  netPnl: number;
  avgOdds: number | null;
  avgLegs: number | null;
  maxDrawdown: number;
  longestLossStreak: number;
  firstDateIso: string | null;
  lastDateIso: string | null;
}

export interface TicketReplayRow extends TicketVariantConfig {
  summary: TicketReplaySummary;
  daily: TicketReplayDay[];
}

export interface TicketReplayResponse {
  generatedAt: string;
  firstDateIso: string | null;
  lastDateIso: string | null;
  /** Matchdays with at least one clean pre-match priced fixture. */
  matchdays: number;
  pricedFixtures: number;
  /** Finished fixtures excluded because their price was not captured pre-match. */
  excludedFixtures: number;
  stakePerTicket: number;
  shapes: TicketReplayRow[];
  strategies: TicketReplayRow[];
  odds: TicketReplayRow[];
  legs: TicketReplayRow[];
  /** The exact strategy / min odds / max legs held by the slip when loaded. */
  current: TicketReplayRow | null;
}
