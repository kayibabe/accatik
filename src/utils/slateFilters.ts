import type { Fixture, MarketOption, MarketType } from '../types/fixtures.ts';
import { getAnalystNote, resolveAnalystNoteMarket } from './analystNote.ts';
import {
  MARKET_SELECTION_CATALOG,
  resolveMarketSelection,
} from './marketSelection.ts';
import type { MarketSelection } from './marketSelection.ts';
import { isPriced } from './pickResolver.ts';
import { marketProbability } from './probability.ts';
import {
  angleConfidence,
  type AngleConfidence,
  type RecommendedAngle,
} from './recommendedAngle.ts';

/**
 * Slate-level filters.
 *
 * These narrow the *matches* on a matchday, not the odds tiles inside one
 * match. A fixture is judged on its "qualifying market": the highest-probability
 * priced outcome in the selected market type, or across the whole book when the
 * type is `all`. The probability threshold and the price band both read that
 * same market, so the two controls can never disagree. The three insight
 * bands are judged separately, each on its own market: the Recommended Angle
 * on the fixture's pick, the Safer Cover on its cover, and the Analyst Note on
 * the market the note resolves to. A fixture without that insight only passes
 * its `all` chip.
 *
 * Two signal filters sit on top: the model edge (API-Football's 1X2 model
 * against the de-vigged book) and a kickoff window measured from "now". Neither
 * needs a bookmaker price except the model edge, which is defined against one.
 */

/** Confidence-band chips shared by all three insight filters. */
export type AngleFilter = 'all' | AngleConfidence;
export type CoverFilter = AngleFilter;
export type NoteFilter = AngleFilter;
export type MarketTypeFilter = 'all' | MarketType;

export interface SlateFilters {
  /** Confidence band of the fixture's Recommended Angle. */
  angle: AngleFilter;
  /** Confidence band of the fixture's Safer Cover. */
  cover: CoverFilter;
  /** Confidence band of the market behind the fixture's Analyst Note. */
  note: NoteFilter;
  /** Market type the fixture must offer at a usable price. */
  marketType: MarketTypeFilter;
  /** Canonical selection keys to narrow the board to. Empty = all selections. */
  marketSelections: string[];
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
  cover: 'all',
  note: 'all',
  marketType: 'all',
  marketSelections: [],
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

/** The same bands, named for the other two insight cards. */
export const COVER_FILTERS: readonly CoverFilter[] = ANGLE_FILTERS;
export const NOTE_FILTERS: readonly NoteFilter[] = ANGLE_FILTERS;

/** Market chips, in the order the book publishes them. */
export const MARKET_TYPE_FILTERS: readonly MarketType[] = [
  '1X2',
  'Double Chance',
  'Draw No Bet',
  'Goals',
  'BTTS',
];

/**
 * Every bet the system can price, including the under-goal lines and both BTTS
 * sides held back from the board's headline grid. Keys are the same canonical
 * ids used by analytics and ROI, so a chip always selects one known outcome.
 */
export const SELECTION_FILTERS = MARKET_SELECTION_CATALOG.map(
  ({ key, label, shortLabel, marketType }) => ({
    key,
    label,
    shortLabel,
    marketType,
  })
);

export const SELECTION_FILTER_KEYS: readonly string[] =
  MARKET_SELECTION_CATALOG.map((selection) => selection.key);

/**
 * The outcome-level Market chips shown on the board. These replace the coarse
 * 1X2/DC/DNB/Goals/BTTS grouping: each chip is one real selection from the full
 * captured ladder, so the Under lines and BTTS No are directly reachable.
 * Order follows the betting-shop list used by the board.
 */
const MARKET_FILTER_KEYS: readonly string[] = [
  '1X2-H',
  '1X2-A',
  'GOALS-O1.5',
  'GOALS-O2.5',
  'GOALS-O3.5',
  'GOALS-O4.5',
  'GOALS-U1.5',
  'GOALS-U2.5',
  'GOALS-U3.5',
  'GOALS-U4.5',
  'BTTS-YES',
  'BTTS-NO',
  'DC-1X',
  '1X2-D',
  'DC-12',
  'DC-X2',
  'DNB-1',
  'DNB-2',
];

/** The board calls a straight draw "X (Draw)", next to the double chances. */
const MARKET_FILTER_LABELS: Record<string, string> = {
  '1X2-D': 'X (Draw)',
};

export const MARKET_FILTERS: MarketSelection[] = MARKET_FILTER_KEYS.map(
  (key) => {
    const selection = MARKET_SELECTION_CATALOG.find((item) => item.key === key);
    if (!selection) throw new Error(`Unknown market filter key: ${key}`);
    return MARKET_FILTER_LABELS[key]
      ? { ...selection, label: MARKET_FILTER_LABELS[key] }
      : selection;
  }
);

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
 * The priced outcomes a fixture can be judged on. The headline board normally
 * uses its five-card shortlist; selecting individual outcomes opts into the
 * full captured ladder, which is where under-goals and other held-back lines
 * live.
 */
function pricedPool(fixture: Fixture, selectionKeys: string[]): MarketOption[] {
  const source =
    selectionKeys.length > 0
      ? (fixture.allMarkets ?? fixture.markets)
      : fixture.markets;
  const priced = source.filter(isPriced);
  if (selectionKeys.length === 0) return priced;

  const wanted = new Set(selectionKeys);
  return priced.filter((market) =>
    wanted.has(resolveMarketSelection(market, fixture).key)
  );
}

/** Board-wide pool for the current filters, also used to build the angle. */
export function boardMarketPool(
  fixture: Fixture,
  filters: SlateFilters
): MarketOption[] {
  return pricedPool(fixture, filters.marketSelections);
}

/**
 * The market a fixture is judged on: the highest-probability priced outcome in
 * `marketType`, or in the whole book when the type is `all`. Null when the book
 * has no usable price for that type.
 */
export function qualifyingMarket(
  fixture: Fixture,
  marketType: MarketTypeFilter,
  selectionKeys: string[] = []
): MarketOption | null {
  const priced = pricedPool(fixture, selectionKeys);
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
    filters.marketSelections.length > 0 ||
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

  return pricedPool(fixture, filters.marketSelections).filter((market) => {
    if (
      filters.marketType !== 'all' &&
      market.marketType !== filters.marketType
    ) {
      return false;
    }
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

/** True when an insight's band satisfies its chip (`all` accepts anything). */
function matchesConfidenceFilter(
  filter: AngleFilter,
  band: AngleConfidence | null
): boolean {
  return filter === 'all' || band === filter;
}

/** Confidence of the card's safer cover, or null when the fixture has none. */
export function coverConfidence(
  angle: RecommendedAngle | null
): AngleConfidence | null {
  return angle?.cover ? angleConfidence(angle.coverProbability) : null;
}

/**
 * Confidence of the market behind the analyst note, using the note the card
 * shows. Callers with a fresher on-demand note pass its resolved market so the
 * filter and the card can never rank the same fixture differently.
 */
export function noteConfidence(
  fixture: Fixture,
  noteMarket?: MarketOption | null
): AngleConfidence | null {
  const market =
    noteMarket === undefined
      ? resolveAnalystNoteMarket(fixture, getAnalystNote(fixture))
      : noteMarket;
  return market ? angleConfidence(marketProbability(market)) : null;
}

/**
 * True when the fixture survives every slate filter. `nowMs` is injectable so
 * the kickoff window can be tested without waiting for real time to pass;
 * `noteMarket` overrides the note market derived from the fixture.
 */
export function matchesSlateFilters(
  fixture: Fixture,
  filters: SlateFilters,
  angle: RecommendedAngle | null,
  nowMs: number = Date.now(),
  noteMarket?: MarketOption | null
): boolean {
  if (!matchesConfidenceFilter(filters.angle, angle?.confidence ?? null)) {
    return false;
  }
  if (!matchesConfidenceFilter(filters.cover, coverConfidence(angle))) {
    return false;
  }
  if (
    !matchesConfidenceFilter(filters.note, noteConfidence(fixture, noteMarket))
  ) {
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

  const market = qualifyingMarket(
    fixture,
    filters.marketType,
    filters.marketSelections
  );
  if (!market) {
    // An unpriced fixture can only survive the default market settings: any
    // market-level filter needs a price to judge it by.
    return (
      filters.marketType === 'all' &&
      filters.marketSelections.length === 0 &&
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

/**
 * Applies every slate filter. `angleFor` and `noteMarketFor` keep insight
 * building out of this module, so the board can pass the very same values its
 * cards display.
 */
export function filterSlate(
  fixtures: Fixture[],
  filters: SlateFilters,
  angleFor: (fixture: Fixture) => RecommendedAngle | null,
  nowMs: number = Date.now(),
  noteMarketFor?: (fixture: Fixture) => MarketOption | null
): Fixture[] {
  return fixtures.filter((fixture) =>
    matchesSlateFilters(
      fixture,
      filters,
      angleFor(fixture),
      nowMs,
      noteMarketFor?.(fixture)
    )
  );
}

function emptyBands(): Record<AngleConfidence, number> {
  return { High: 0, Solid: 0, Moderate: 0, Speculative: 0 };
}

function countBands(
  bands: Iterable<AngleConfidence | null>
): Record<AngleConfidence, number> {
  const counts = emptyBands();
  for (const band of bands) {
    if (band) counts[band]++;
  }
  return counts;
}

/** How many fixtures sit in each angle band. Unpriced fixtures count nowhere. */
export function countAngleBands(
  fixtures: Fixture[],
  angleFor: (fixture: Fixture) => RecommendedAngle | null
): Record<AngleConfidence, number> {
  return countBands(
    fixtures.map((fixture) => angleFor(fixture)?.confidence ?? null)
  );
}

/** How many fixtures offer a safer cover in each confidence band. */
export function countCoverBands(
  fixtures: Fixture[],
  angleFor: (fixture: Fixture) => RecommendedAngle | null
): Record<AngleConfidence, number> {
  return countBands(
    fixtures.map((fixture) => coverConfidence(angleFor(fixture)))
  );
}

/** How many fixtures have a note-backed market in each confidence band. */
export function countNoteBands(
  fixtures: Fixture[],
  noteMarketFor?: (fixture: Fixture) => MarketOption | null
): Record<AngleConfidence, number> {
  return countBands(
    fixtures.map((fixture) =>
      noteConfidence(
        fixture,
        noteMarketFor ? noteMarketFor(fixture) : undefined
      )
    )
  );
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

/** How many fixtures offer each priced selection, including held-back lines. */
export function countMarketSelections(
  fixtures: Fixture[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const fixture of fixtures) {
    const seen = new Set<string>();
    for (const market of fixture.allMarkets ?? fixture.markets) {
      if (!isPriced(market)) continue;
      const key = resolveMarketSelection(market, fixture).key;
      if (seen.has(key)) continue;
      seen.add(key);
      counts[key] = (counts[key] ?? 0) + 1;
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
