import type { FrameworkConfig, MarketKey } from './config.ts';
import { DEFAULT_FRAMEWORK_CONFIG } from './config.ts';
import { devig, fairFromOneSide, impliedProbability } from './value.ts';

/**
 * Benchmark construction (§3.6, §9.2).
 *
 * Fair probabilities must come from one complete market at one book at one
 * capture time. Markets from different books are never blended. When only one
 * side exists, the proportional approximation is used and marked incomplete.
 */

export interface BookPrice {
  selectionKey: MarketKey;
  odds: number;
  bookmaker?: string;
}

export interface BenchmarkEntry {
  pFair: number;
  complete: boolean;
  book: string;
}

export interface BenchmarkResult {
  entries: Map<MarketKey, BenchmarkEntry>;
  /** The benchmark book's overround, or the best available estimate. */
  overround: number;
  benchmarkBook: string | null;
}

interface Group {
  book: string;
  prices: Map<MarketKey, number>;
}

function groupByBook(prices: BookPrice[]): Group[] {
  const groups = new Map<string, Map<MarketKey, number>>();
  for (const price of prices) {
    if (!Number.isFinite(price.odds) || price.odds <= 1) continue;
    const book = price.bookmaker?.trim() || 'unknown';
    const group = groups.get(book) ?? new Map<MarketKey, number>();
    group.set(price.selectionKey, price.odds);
    groups.set(book, group);
  }
  return [...groups.entries()].map(([book, map]) => ({ book, prices: map }));
}

function overroundOf(prices: number[]): number {
  return prices.reduce((sum, odds) => sum + impliedProbability(odds), 0) - 1;
}

function bestPair(
  groups: Group[],
  keyA: MarketKey,
  keyB: MarketKey
): { book: string; oddsA: number; oddsB: number; overround: number } | null {
  let best: { book: string; oddsA: number; oddsB: number; overround: number } | null = null;
  for (const group of groups) {
    const a = group.prices.get(keyA);
    const b = group.prices.get(keyB);
    if (a === undefined || b === undefined) continue;
    const overround = overroundOf([a, b]);
    if (!best || overround < best.overround) {
      best = { book: group.book, oddsA: a, oddsB: b, overround };
    }
  }
  return best;
}

function bestThreeWay(
  groups: Group[]
): { book: string; prices: [number, number, number]; overround: number } | null {
  let best: { book: string; prices: [number, number, number]; overround: number } | null = null;
  for (const group of groups) {
    const home = group.prices.get('1X2-H');
    const draw = group.prices.get('1X2-D');
    const away = group.prices.get('1X2-A');
    if (home === undefined || draw === undefined || away === undefined) continue;
    const overround = overroundOf([home, draw, away]);
    if (!best || overround < best.overround) {
      best = { book: group.book, prices: [home, draw, away], overround };
    }
  }
  return best;
}

function familyOverround(
  groups: Group[],
  pairs: Array<[MarketKey, MarketKey]>,
  fallback: number
): number {
  const values: number[] = [];
  for (const [a, b] of pairs) {
    const pair = bestPair(groups, a, b);
    if (pair) values.push(pair.overround);
  }
  if (values.length === 0) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Builds a fair-probability map from a priced book. The 1X2 group is the
 * benchmark anchor; Double Chance is derived from it. Two-way families use
 * their own complete pair, and fall back to one-sided approximation.
 */
export function buildBenchmark(
  prices: BookPrice[],
  config: Partial<FrameworkConfig> = {}
): BenchmarkResult {
  const cfg = { ...DEFAULT_FRAMEWORK_CONFIG, ...config };
  const groups = groupByBook(prices);
  const entries = new Map<MarketKey, BenchmarkEntry>();

  const threeWay = bestThreeWay(groups);
  let benchmarkBook: string | null = null;
  let overround = cfg.assumedOverround;
  if (threeWay) {
    benchmarkBook = threeWay.book;
    overround = threeWay.overround;
    const fair = devig({
      '1X2-H': threeWay.prices[0],
      '1X2-D': threeWay.prices[1],
      '1X2-A': threeWay.prices[2],
    });
    for (const key of ['1X2-H', '1X2-D', '1X2-A'] as const) {
      entries.set(key, { pFair: fair[key], complete: true, book: threeWay.book });
    }
    entries.set('DC-1X', {
      pFair: fair['1X2-H'] + fair['1X2-D'],
      complete: true,
      book: threeWay.book,
    });
    entries.set('DC-X2', {
      pFair: fair['1X2-D'] + fair['1X2-A'],
      complete: true,
      book: threeWay.book,
    });
    entries.set('DC-12', {
      pFair: fair['1X2-H'] + fair['1X2-A'],
      complete: true,
      book: threeWay.book,
    });
  }

  const addPairFamily = (
    pairs: Array<[MarketKey, MarketKey]>
  ): void => {
    const family = familyOverround(groups, pairs, overround);
    for (const [keyA, keyB] of pairs) {
      const pair = bestPair(groups, keyA, keyB);
      if (pair) {
        const fair = devig({ [keyA]: pair.oddsA, [keyB]: pair.oddsB });
        entries.set(keyA, { pFair: fair[keyA], complete: true, book: pair.book });
        entries.set(keyB, { pFair: fair[keyB], complete: true, book: pair.book });
        continue;
      }
      // One side only: proportional approximation, flagged incomplete.
      for (const key of [keyA, keyB]) {
        const group = groups.find((entry) => entry.prices.has(key));
        if (!group) continue;
        const odds = group.prices.get(key) as number;
        entries.set(key, {
          pFair: fairFromOneSide(odds, family),
          complete: false,
          book: group.book,
        });
      }
    }
  };

  addPairFamily([
    ['GOALS-O0.5', 'GOALS-U0.5'],
    ['GOALS-O1.5', 'GOALS-U1.5'],
    ['GOALS-O2.5', 'GOALS-U2.5'],
    ['GOALS-O3.5', 'GOALS-U3.5'],
    ['GOALS-O4.5', 'GOALS-U4.5'],
    ['GOALS-O5.5', 'GOALS-U5.5'],
  ]);
  addPairFamily([['BTTS-YES', 'BTTS-NO']]);
  addPairFamily([['DNB-1', 'DNB-2']]);
  addPairFamily([['TEAM-H-O1.5', 'TEAM-H-U1.5']]);
  addPairFamily([['TEAM-A-O1.5', 'TEAM-A-U1.5']]);

  return { entries, overround, benchmarkBook };
}
