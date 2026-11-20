import type { AccaStrategy, MarketType } from './fixtures.ts';

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
}

export interface MarketAnalyticsRow extends PickAnalyticsRow {
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
  marketsByType: PickAnalyticsRow[];
  marketsBySelection: MarketAnalyticsRow[];
  daily: PickAnalyticsDay[];
}
