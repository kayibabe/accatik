export type MarketType =
  | '1X2'
  | 'Double Chance'
  | 'Goals'
  | 'BTTS'
  | 'Draw No Bet';

export type AccaStrategy =
  | 'balanced'
  | 'favorites'
  | 'goals'
  | 'high-yield'
  | 'probability';

export type SettlementStatus = 'Win' | 'Lost' | 'Void' | 'Live' | 'Pending';

/**
 * How the stored price block was captured.
 *
 * `prematch` means the book was first archived before kickoff and can be
 * treated as a real betting price. `live` means the first capture happened
 * after the match started (usually a backfilled archive) and must not be used
 * for ROI or closing-line calculations.
 */
export type PriceQuality = 'prematch' | 'live' | 'unknown';

export interface MarketOption {
  id: string;
  marketType: MarketType;
  label: string;
  odds: number;
  /** Raw 1/odds percentage, still carrying the bookmaker's margin. */
  impliedProbability: number;
  /** Margin-adjusted probability (percent) used for ranking picks. */
  fairProbability?: number;
  rationale: string;
  /** Bookmaker that actually published this price (may differ from the fixture's primary book). */
  bookmaker?: string;
}

/** API-Football's own 1X2 model, in percent. Independent of the bookmaker book. */
export interface ModelProbabilities {
  home: number | null;
  draw: number | null;
  away: number | null;
}

export interface Fixture {
  id: string;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  country: string;
  matchDate: string;
  matchDateIso: string;
  kickoffTime: string;
  kickoffTimestamp?: number;
  awaitingResult?: boolean;
  status: 'Scheduled' | 'Live' | 'Finished' | 'Void';
  statusShort?: string;
  statusLong?: string;
  score?: {
    home: number | null;
    away: number | null;
    halftimeHome?: number | null;
    halftimeAway?: number | null;
  };
  venue: string;
  formHome: string;
  formAway: string;
  tacticalSummary: string;
  recommendedPickId: string;
  bookmakerName?: string;
  hasLiveOdds: boolean;
  /** The headline selections shown on the board and used by the pick engine. */
  markets: MarketOption[];
  /**
   * Every priced selection captured from the odds feed, including goal lines
   * and cover outcomes held back from the board's five-card shortlist. The
   * analytics rebuild reads this so each selection gets its own record. Older
   * archives omit it, in which case `markets` remains the full priced set.
   */
  allMarkets?: MarketOption[];
  /** API-Football model's one-line pick, when the provider returned one. */
  modelAdvice?: string;
  /**
   * The priced market the analyst note maps to. Captured alongside `modelAdvice`
   * so the note can carry a Win/Lost qualifier exactly like the angle and cover.
   */
  analystNoteMarketId?: string;
  /** API-Football model 1X2 percentages. Shown beside the de-vigged book, never merged into it. */
  modelProbabilities?: ModelProbabilities;
  /** ISO timestamp when these prices were captured into the permanent archive. */
  pricedAt?: string;
  /** Whether this price block was captured before or after kickoff. */
  priceQuality?: PriceQuality;
  /**
   * When the model snapshot (advice, probabilities and form) was captured into
   * the archive. Presence means a date change can reuse the durable copy
   * instead of paying for another `/predictions` upstream call.
   */
  modelDataAt?: string;
}

/**
 * Guest-safe fixture shape. Deliberately excludes prices, picks, rationales,
 * form and model output so none of the betting specifics leave the server for
 * the public landing page.
 */
export interface PublicFixture {
  id: string;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  country: string;
  matchDate: string;
  kickoffTime: string;
  status: Fixture['status'];
}

/**
 * Phase timings for one slate delivery. `persistMs` and `ledgerMs` measure the
 * hand-off to background bookkeeping — the real durations are logged when that
 * work settles, since it is deliberately not awaited before the response.
 */
export interface ServerTimings {
  archiveReadMs: number;
  buildMs: number;
  predictionsMs: number;
  persistMs: number;
  ledgerMs: number;
  totalMs: number;
}

/** Response returned by GET /api/fixtures/public/today. */
export interface PublicSlateResponse {
  date: string;
  displayDate: string;
  timezoneLabel: string;
  fixtures: PublicFixture[];
  cachedAt: string;
  serverTimings?: ServerTimings;
}

export interface AccaLeg {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  matchDate?: string;
  kickoffTime: string;
  marketId: string;
  marketLabel: string;
  marketType: MarketType;
  odds: number;
  impliedProbability: number;
  /** Margin-adjusted probability (percent) this leg was picked on. */
  fairProbability?: number;
  rationale: string;
  bookmaker?: string;
  locked?: boolean;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface RecommendedPickRef {
  fixtureId: string;
  marketId: string;
}

/** Structural economics of a ticket, after removing the bookmaker margin. */
export interface TicketEconomicsSummary {
  legCount: number;
  totalOdds: number;
  /** Margin-adjusted chance every leg lands, as a percentage. */
  fairChance: number;
  /** Hit rate the quoted price needs to break even, as a percentage. */
  breakEvenChance: number;
  /** Fair chance minus break-even, in percentage points. */
  edgePts: number;
  /** Expected return per unit staked, as a percentage. */
  expectedRoi: number;
  /** How far the quoted price sits above fair (1.00 = no margin). */
  combinedOverround: number;
  /**
   * `fair` when every leg had a de-vigged probability; `implied` when the
   * guard had to fall back to the quoted prices, which understates the loss.
   */
  basis: 'fair' | 'implied';
}

export interface TicketGuardSummary {
  recommended: boolean;
  reason: string;
  originalLegCount: number;
  trimmedCount: number;
  economics: TicketEconomicsSummary;
}

export interface DailySlateResponse {
  date: string;
  displayDate: string;
  timezoneLabel: string;
  dataProvider: string;
  strategy: AccaStrategy;
  minOdds: number;
  strategyName: string;
  strategySummary: string;
  fixtures: Fixture[];
  recommendedLegIds: RecommendedPickRef[];
  /** Present when the server applied the structural EV gate. */
  ticketGuard?: TicketGuardSummary;
  sources: GroundingSource[];
  cachedAt: string;
  /** `archive` means the slate came from disk without any API-Football call. */
  slateSource?: 'live' | 'archive';
  /** When this matchday's prices were first captured into the archive. */
  capturedAt?: string;
  /** Per-phase server timings for this response. */
  serverTimings?: ServerTimings;
}

export interface SavedTicket {
  id: string;
  name: string;
  createdAt: string;
  date: string;
  /** ISO match date, used to re-settle the slip without the live slate loaded. */
  dateIso?: string;
  stake: number;
  totalOdds: number;
  legs: AccaLeg[];
}

export interface DeepAnalysisResponse {
  fixtureId: string;
  summary: string;
  keyFactors: string[];
  teamNews: string;
  bestAngle: string;
  formHome?: string;
  formAway?: string;
  sources: GroundingSource[];
}

/** One line of the historical record for a per-match pick. */
export interface PickRecordEntry {
  key: 'angle' | 'cover' | 'note';
  label: string;
  settled: number;
  wins: number;
  losses: number;
  voids: number;
  /** Wins as a percentage of non-void settled picks; null when there are none. */
  hitRate: number | null;
}

/**
 * Hit rates rebuilt from archived slates. Every pick is recomputed from the
 * frozen prices with the current strategy, then settled from the final score.
 */
export interface PickRecordsResponse {
  strategy: AccaStrategy;
  sampleDates: number;
  sampleFixtures: number;
  records: PickRecordEntry[];
  generatedAt: string;
}
