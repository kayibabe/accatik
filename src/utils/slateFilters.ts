import type { Fixture, MarketOption, MarketType } from '../types/fixtures.ts';
import type { AngleConfidence, RecommendedAngle } from './recommendedAngle.ts';
import { isPriced } from './pickResolver.ts';
import { marketProbability } from './probability.ts';

/**
 * Slate-level filters.
 *
 * These narrow the *matches* on a matchday, not the odds tiles inside one
 * match. A fixture is judged on its "qualifying market": the highest-probability
 * priced outcome in the selected market type, or across the whole book when the
 * type is `all`. The probability threshold and the price band both read that
 * same market, so the two controls can never disagree. The Recommended Angle
 * band is judged separately, on the fixture's own pick.
 *
 * Two signal filters sit on top: the model edge (API-Football's 1X2 model
 * against the de-vigged book) and a kickoff window measured from "now". Neither
 * needs a bookmaker price except the model edge, which is defined against one.
 */

export type AngleFilter = 'all' | AngleConfidence;
export type MarketTypeFilter = 'all' | MarketType;

export interface SlateFilters {
  /** Confidence band of the fixture's Recommended Angle. */
  angle: AngleFilter;
  /** Market type the fixture must offer at a usable price. */
  marketType: MarketTypeFilter;
  /** Minimum margin-adjusted win probability (percent). 0 = any. */
  minProbability: number;
  /** Minimum decimal odds on the qualifying market. 0 = no floor. */
  minOdds: number;
  /** Maximum decimal odds on the qualifying market. 0 = no cap. */
  maxOdds: number;
  /** Minimum 1X2 model-over-book gap, in percentage points. 0 = any. */
  minModelEdge: number;
  /** Only fixtures kicking off within this many hours. 0 = any. */
  kickoffWindowHours: number;
}

export const DEFAULT_SLATE_FILTERS: SlateFilters = {
  angle: 'all',
  marketType: 'all',
  minProbability: 0,
  minOdds: 0,
  maxOdds: 0,
  minModelEdge: 0,
  kickoffWindowHours: 0,
};

/** Confidence chips, strongest first. `all` means "no confidence filter". */
export const ANGLE_FILTERS: readonly AngleFilter[] = [
  'all',
  'High',
  'Solid',
  'Moderate',
  'Speculative',
];

/** Market chips, in the order the book publishes them. */
export const MARKET_TYPE_FILTERS: readonly MarketType[] = [
  '1X2',
  'Double Chance',
  'Draw No Bet',
  'Goals',
  'BTTS',
];

/** Win-probability floors offered by the UI, in percent. 0 = any. */
export const PROBABILITY_THRESHOLDS = [0, 50, 60, 70, 80, 90] as const;

/** Model-over-book gaps offered by the UI, in percentage points. 0 = any. */
export const MODEL_EDGE_THRESHOLDS = [0, 3, 5, 10] as const;

/** Kickoff horizons offered by the UI, in hours from now. 0 = any. */
export const KICKOFF_WINDOWS = [0, 2, 6, 12] as const;

const HOUR_MS = 60 * 60 * 1000;

const BEST_MARKET_TYPES: readonly MarketType[] = [
  '1X2',
  'Double Chance',
  'Draw No Bet',
  'Goals',
  'BTTS',
];

/**
 * The market a fixture is judged on: the highest-probability priced outcome in
 * `marketType`, or in the whole book when the type is `all`. Null when the book
 * has no usable price for that type.
 */
export function qualifyingMarket(
  fixture: Fixture,
  marketType: MarketTypeFilter
): MarketOption | null {
  const priced = fixture.markets.filter(isPriced);
  const pool =
    marketType === 'all'
      ? priced
      : priced.filter((market) => market.marketType === marketType);

  if (pool.length === 0) return null;

  return pool.reduce((best, market) =>
    marketProbability(market) > marketProbability(best) ? market : best
  );
}

export interface ModelEdge {
  side: 'Home' | 'Draw' | 'Away';
  /** Model percent minus de-vigged book percent, in percentage points. */
  points: number;
}

/** True when the market-level chips (type, probability, price) are narrowing tiles. */
export function hasMarketFilters(filters: SlateFilters): boolean {
  return (
    filters.marketType !== 'all' ||
    filters.minProbability > 0 ||
    filters.minOdds > 0 ||
    filters.maxOdds > 0
  );
}

/**
 * The outcomes shown inside a fixture card. With no market-level chip active
 * every published market stays visible; otherwise only the outcomes meeting
 * the same type, probability and price rules the match filter used. Admission
 * guarantees at least one outcome survives when a match-level chip is on,
 * because the qualifying market is itself one of these.
 */
export function matchingMarkets(
  fixture: Fixture,
  filters: SlateFilters
): MarketOption[] {
  if (!hasMarketFilters(filters)) return fixture.markets;

  return fixture.markets.filter((market) => {
    if (
      filters.marketType !== 'all' &&
      market.marketType !== filters.marketType
    ) {
      return false;
    }
    if (!isPriced(market)) return false;
    if (marketProbability(market) < filters.minProbability) return false;
    if (filters.minOdds > 0 && market.odds < filters.minOdds) return false;
    if (filters.maxOdds > 0 && market.odds > filters.maxOdds) return false;
    return true;
  });
}

/**
 * The largest gap between API-Football's 1X2 model and the de-vigged book on
 * this fixture. Null when the provider published no model or the book prices
 * no comparable side. A negative value means the book is more confident than
 * the model on every side.
 */
export function bestModelEdge(fixture: Fixture): ModelEdge | null {
  const probabilities = fixture.modelProbabilities;
  if (!probabilities) return null;

  const sides: Array<{
    suffix: string;
    side: ModelEdge['side'];
    model: number | null;
  }> = [
    { suffix: '1x2-h', side: 'Home', model: probabilities.home },
    { suffix: '1x2-d', side: 'Draw', model: probabilities.draw },
    { suffix: '1x2-a', side: 'Away', model: probabilities.away },
  ];

  let best: ModelEdge | null = null;
  for (const { suffix, side, model } of sides) {
    if (model === null || model === undefined) continue;
    const market = fixture.markets.find((entry) => entry.id.endsWith(suffix));
    if (!market || !isPriced(market)) continue;

    const points = model - marketProbability(market);
    if (!best || points > best.points) best = { side, points };
  }

  return best;
}

/**
 * True when the fixture survives every slate filter. `nowMs` is injectable so
 * the kickoff window can be tested without waiting for real time to pass.
 */
export function matchesSlateFilters(
  fixture: Fixture,
  filters: SlateFilters,
  angle: RecommendedAngle | null,
  nowMs: number = Date.now()
): boolean {
  if (filters.angle !== 'all' && angle?.confidence !== filters.angle) {
    return false;
  }

  if (filters.kickoffWindowHours > 0) {
    const kickoff = fixture.kickoffTimestamp;
    if (!kickoff || kickoff <= nowMs) return false;
    if (kickoff > nowMs + filters.kickoffWindowHours * HOUR_MS) return false;
  }

  if (filters.minModelEdge > 0) {
    const edge = bestModelEdge(fixture);
    if (!edge || edge.points < filters.minModelEdge) return false;
  }

  const market = qualifyingMarket(fixture, filters.marketType);
  if (!market) {
    // An unpriced fixture can only survive the default market settings: a
    // specific type, a probability floor or a price band all need a price.
    return (
      filters.marketType === 'all' &&
      filters.minProbability <= 0 &&
      filters.minOdds <= 0 &&
      filters.maxOdds <= 0
    );
  }

  if (marketProbability(market) < filters.minProbability) return false;
  if (filters.minOdds > 0 && market.odds < filters.minOdds) return false;
  if (filters.maxOdds > 0 && market.odds > filters.maxOdds) return false;

  return true;
}

/** Applies every slate filter. `angleFor` keeps angle building out of this module. */
export function filterSlate(
  fixtures: Fixture[],
  filters: SlateFilters,
  angleFor: (fixture: Fixture) => RecommendedAngle | null,
  nowMs: number = Date.now()
): Fixture[] {
  return fixtures.filter((fixture) =>
    matchesSlateFilters(fixture, filters, angleFor(fixture), nowMs)
  );
}

/** How many fixtures sit in each confidence band. Unpriced fixtures count nowhere. */
export function countAngleBands(
  fixtures: Fixture[],
  angleFor: (fixture: Fixture) => RecommendedAngle | null
): Record<AngleConfidence, number> {
  const counts: Record<AngleConfidence, number> = {
    High: 0,
    Solid: 0,
    Moderate: 0,
    Speculative: 0,
  };

  for (const fixture of fixtures) {
    const angle = angleFor(fixture);
    if (angle) counts[angle.confidence]++;
  }

  return counts;
}

/** How many fixtures offer a priced outcome of each market type. */
export function countMarketTypes(
  fixtures: Fixture[]
): Record<MarketType, number> {
  const counts = Object.fromEntries(
    BEST_MARKET_TYPES.map((type) => [type, 0])
  ) as Record<MarketType, number>;

  for (const fixture of fixtures) {
    // One fixture counts once per type, however many sides it prices.
    const seen = new Set<MarketType>();
    for (const market of fixture.markets) {
      if (!isPriced(market) || seen.has(market.marketType)) continue;
      seen.add(market.marketType);
      counts[market.marketType]++;
    }
  }

  return counts;
}

/**
 * How many fixtures clear each model-edge threshold. Keyed by threshold, so
 * the chips can show the count before the filter is applied.
 */
export function countModelEdges(
  fixtures: Fixture[]
): Record<number, number> {
  const thresholds = MODEL_EDGE_THRESHOLDS.filter((value) => value > 0);
  const counts: Record<number, number> = Object.fromEntries(
    thresholds.map((value) => [value, 0])
  );

  for (const fixture of fixtures) {
    const edge = bestModelEdge(fixture);
    if (!edge) continue;
    for (const threshold of thresholds) {
      if (edge.points >= threshold) counts[threshold]++;
    }
  }

  return counts;
}

/** Parses a user-typed decimal price. Blank, invalid or <= 1 becomes 0 (off). */
export function parseOddsInput(value: string): number {
  const parsed = Number(value.replace(',', '.').trim());
  return Number.isFinite(parsed) && parsed > 1 ? parsed : 0;
}
