/**
 * Analytics-only data helpers, shared by the region components.
 *
 * This module deliberately contains no presentation code: the refactor moves
 * rendering into small region components while keeping the archive
 * normalisation and roll-up rules in one testable place.
 */
import type {
  FeaturedAnalyticsRow,
  FeaturedPickSource,
  MarketAnalyticsRow,
  PickAnalyticsResponse,
  PickAnalyticsRow,
} from '../../types/analytics.ts';
import type { MarketType } from '../../types/fixtures.ts';
import {
  compareSelections,
  MARKET_SELECTION_CATALOG,
} from '../../utils/marketSelection.ts';
import type { SortAccessors } from '../../utils/tableSort.ts';

export type MarketTableRow = MarketAnalyticsRow;

export interface MarketGroup {
  typeRow: MarketAnalyticsRow;
  selections: MarketAnalyticsRow[];
}

export interface FeaturedGroup {
  source: FeaturedPickSource;
  row: PickAnalyticsRow;
  selections: FeaturedAnalyticsRow[];
}

export interface Summary {
  wins: number;
  losses: number;
  voids: number;
  stake: number;
  returns: number;
  netPnl: number;
  hitRate: number | null;
  roi: number | null;
}

export const FEATURED_SOURCE_ORDER: FeaturedPickSource[] = [
  'angle',
  'cover',
  'note',
];

/** Win-probability floors offered above the individual-markets table. */
export const MARKET_PROBABILITY_FILTERS: readonly number[] = [
  0, 30, 40, 50, 60, 70, 80, 90,
];

/** Stable DOM id for a group's collapsible panel. */
export const groupPanelId = (prefix: string, key: string): string =>
  `${prefix}-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

const MARKET_TYPES: MarketType[] = [
  '1X2',
  'Double Chance',
  'Goals',
  'BTTS',
  'Draw No Bet',
];

const MARKET_TYPE_BY_KEY_PREFIX: Record<string, MarketType> = {
  '1X2': '1X2',
  GOALS: 'Goals',
  BTTS: 'BTTS',
  DC: 'Double Chance',
  DNB: 'Draw No Bet',
};

function inferMarketType(key: string): MarketType | null {
  const direct = MARKET_TYPES.find((type) => type === key);
  if (direct) return direct;
  return MARKET_TYPE_BY_KEY_PREFIX[key.split('-')[0].toUpperCase()] ?? null;
}

/**
 * Older Functions published average odds but not fair probability. Derive a
 * usable fallback so the probability filter still works before redeployment.
 * (1 / average odds is the raw implied probability, so it runs a little above
 * the margin-adjusted value.)
 */
function withProbabilityFallback<T extends PickAnalyticsRow>(row: T): T {
  if (typeof row.avgProbability === 'number') return row;
  return {
    ...row,
    avgProbability:
      row.avgOdds !== null && row.avgOdds > 0
        ? Math.round((100 / row.avgOdds) * 10) / 10
        : null,
  };
}

/**
 * The site and the API Function deploy independently. Older Functions predate
 * the selection rollups, so missing fields must degrade gracefully instead of
 * throwing inside render and blanking the whole app.
 */
export function normalizeAnalytics(raw: PickAnalyticsResponse): {
  data: PickAnalyticsResponse;
  staleResponse: boolean;
} {
  const source = raw as Partial<PickAnalyticsResponse> | null;
  const staleResponse =
    !source ||
    !Array.isArray(source.featuredBySelection) ||
    !Array.isArray(source.marketsByType) ||
    source.marketsByType.some((row) => !row.marketType);
  const safe = source ?? {};

  return {
    staleResponse,
    data: {
      strategy: safe.strategy ?? 'balanced',
      generatedAt: safe.generatedAt ?? '',
      firstDateIso: safe.firstDateIso ?? null,
      lastDateIso: safe.lastDateIso ?? null,
      sampleDates: safe.sampleDates ?? 0,
      sampleFixtures: safe.sampleFixtures ?? 0,
      marketPicks: safe.marketPicks ?? 0,
      stakePerPick: safe.stakePerPick ?? 1,
      priceQuality: {
        prematch: safe.priceQuality?.prematch ?? 0,
        live: safe.priceQuality?.live ?? 0,
        unknown: safe.priceQuality?.unknown ?? 0,
      },
      featured: Array.isArray(safe.featured)
        ? safe.featured.map(withProbabilityFallback)
        : [],
      featuredBySelection: Array.isArray(safe.featuredBySelection)
        ? safe.featuredBySelection.map(withProbabilityFallback)
        : [],
      marketsByType: (Array.isArray(safe.marketsByType)
        ? safe.marketsByType
        : []
      ).map((row) => ({
        ...withProbabilityFallback(row),
        marketType: row.marketType ?? inferMarketType(row.key) ?? '1X2',
      })),
      marketsBySelection: (Array.isArray(safe.marketsBySelection)
        ? safe.marketsBySelection
        : []
      ).map((row) => ({
        ...withProbabilityFallback(row),
        marketType: row.marketType ?? inferMarketType(row.key) ?? '1X2',
      })),
      daily: Array.isArray(safe.daily) ? safe.daily : [],
    },
  };
}

export function summarize(rows: PickAnalyticsRow[]): Summary {
  let wins = 0;
  let losses = 0;
  let voids = 0;
  let stake = 0;
  let returns = 0;
  let netPnl = 0;
  for (const row of rows) {
    wins += row.wins;
    losses += row.losses;
    voids += row.voids;
    stake += row.stake;
    returns += row.returns;
    netPnl += row.netPnl;
  }
  const decided = wins + losses;
  return {
    wins,
    losses,
    voids,
    stake,
    returns,
    netPnl,
    hitRate: decided > 0 ? (wins / decided) * 100 : null,
    roi: stake > 0 ? (netPnl / stake) * 100 : null,
  };
}

export function recordLabel(
  won: number,
  lost: number,
  voided: number
): string {
  return `${won}W · ${lost}L · ${voided}V`;
}

export function emptySelectionRow(
  selection: (typeof MARKET_SELECTION_CATALOG)[number]
): MarketAnalyticsRow {
  return {
    key: selection.key,
    label: selection.label,
    marketType: selection.marketType,
    settled: 0,
    wins: 0,
    losses: 0,
    voids: 0,
    hitRate: null,
    stake: 0,
    returns: 0,
    netPnl: 0,
    roi: null,
    avgOdds: null,
    avgProbability: null,
  };
}

export function emptyFeaturedSelectionRow(
  source: FeaturedPickSource,
  selection: (typeof MARKET_SELECTION_CATALOG)[number]
): FeaturedAnalyticsRow {
  return {
    ...emptySelectionRow(selection),
    key: `${source}:${selection.key}`,
    source,
    selectionKey: selection.key,
  };
}

export const SELECTION_ACCESSORS: SortAccessors<MarketTableRow> = {
  label: (row) => row.label,
  marketType: (row) => row.marketType ?? null,
  settled: (row) => row.settled,
  record: (row) => recordLabel(row.wins, row.losses, row.voids),
  wins: (row) => row.wins,
  losses: (row) => row.losses,
  voids: (row) => row.voids,
  hitRate: (row) => row.hitRate,
  avgProbability: (row) => row.avgProbability,
  avgOdds: (row) => row.avgOdds,
  stake: (row) => row.stake,
  returns: (row) => row.returns,
  netPnl: (row) => row.netPnl,
  roi: (row) => row.roi,
};

export const FEATURED_ACCESSORS: SortAccessors<FeaturedAnalyticsRow> = {
  label: (row) => row.label,
  selectionKey: (row) => row.selectionKey,
  settled: (row) => row.settled,
  record: (row) => recordLabel(row.wins, row.losses, row.voids),
  wins: (row) => row.wins,
  losses: (row) => row.losses,
  voids: (row) => row.voids,
  hitRate: (row) => row.hitRate,
  stake: (row) => row.stake,
  returns: (row) => row.returns,
  netPnl: (row) => row.netPnl,
  roi: (row) => row.roi,
  avgOdds: (row) => row.avgOdds,
};

/** Canonical selection ordering shared by both drill-down tables. */
export function bySelectionLabel(
  a: FeaturedAnalyticsRow,
  b: FeaturedAnalyticsRow
): number {
  return compareSelections(
    { ...a, key: a.selectionKey },
    { ...b, key: b.selectionKey }
  );
}
