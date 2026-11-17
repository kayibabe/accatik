import type { AccaLeg, Fixture, MarketOption } from '../types/fixtures.ts';

/**
 * Probability ranking helpers.
 *
 * Raw `impliedProbability` (1/odds) is not a probability: it includes the
 * bookmaker's margin, and that margin differs between fixtures and books. To
 * rank picks by how likely an outcome actually is, we strip the margin out of
 * a complete, mutually exclusive price group on the same fixture and scale
 * every market by it. The result ("fair probability") is comparable across
 * fixtures on the same slate, which raw implied probability is not.
 */

/** Typical all-market margin, used when no complete price group is available. */
const FALLBACK_OVERROUND = 1.06;

const sumImplied = (markets: MarketOption[]): number =>
  markets.reduce((total, market) => total + 1 / market.odds, 0);

/**
 * Mutually exclusive, exhaustive price groups, widest first (more outcomes =
 * more stable margin estimate). Double Chance is deliberately excluded: 1X and
 * X2 both win on a draw, so their implied probabilities legitimately sum to
 * well above 1 and cannot reveal the margin.
 */
const COMPLETE_GROUPS = [
  ['-1x2-h', '-1x2-d', '-1x2-a'],
  ['-ou-25', '-ou-u25'],
  ['-dnb-h', '-dnb-a'],
];

export function estimateOverround(markets: MarketOption[]): number {
  for (const suffixes of COMPLETE_GROUPS) {
    const group = suffixes.map((suffix) =>
      markets.find((market) => market.id.endsWith(suffix))
    );
    if (group.some((market) => !market)) continue;

    const total = sumImplied(group as MarketOption[]);
    // Guard against malformed sheets: a real book sits just above 1.
    if (total > 1.001 && total <= 1.25) return total;
  }
  return FALLBACK_OVERROUND;
}

/** Returns copies of the markets scaled by an already-estimated overround. */
export function stripMargin(
  markets: MarketOption[],
  overround: number
): MarketOption[] {
  return markets.map((market) => {
    const raw = 1 / market.odds;
    const fair = Math.min(0.99, Math.max(0.01, raw / overround));
    return { ...market, fairProbability: Math.round(fair * 1000) / 10 };
  });
}

/** Returns copies of the markets carrying `fairProbability` (percent). */
export function withFairProbabilities(markets: MarketOption[]): MarketOption[] {
  if (markets.length === 0) return markets;
  return stripMargin(markets, estimateOverround(markets));
}

/** Margin-adjusted probability, falling back to the raw implied value. */
export function marketProbability(market: MarketOption): number {
  return market.fairProbability ?? market.impliedProbability;
}

/** The single most likely priced outcome on a fixture, or null if unpriced. */
export function mostLikelyMarket(fixture: Fixture): MarketOption | null {
  let best: MarketOption | null = null;
  for (const market of fixture.markets) {
    if (!best || marketProbability(market) > marketProbability(best)) {
      best = market;
    }
  }
  return best;
}

/**
 * Priced outcomes ordered by win probability, highest first. Raw implied and
 * fair probability are both scaled by the same per-fixture margin, so either
 * produces the same order; the stable sort keeps the book's own ordering for
 * genuine ties.
 */
export function sortMarketsByProbability(
  markets: MarketOption[]
): MarketOption[] {
  return [...markets].sort(
    (a, b) => marketProbability(b) - marketProbability(a)
  );
}

/** Fixtures ordered by their most likely pick, highest probability first. */
export function sortFixturesByProbability(fixtures: Fixture[]): Fixture[] {
  const probabilityOf = (fixture: Fixture): number => {
    const market = mostLikelyMarket(fixture);
    return market ? marketProbability(market) : -1;
  };

  return [...fixtures].sort((a, b) => {
    const diff = probabilityOf(b) - probabilityOf(a);
    if (diff !== 0) return diff;
    return (a.kickoffTimestamp ?? 0) - (b.kickoffTimestamp ?? 0);
  });
}

/**
 * Combined chance of the whole ticket winning, from margin-adjusted
 * probabilities where available. Returns null when a leg has no usable price.
 */
export function combinedFairProbability(legs: AccaLeg[]): number | null {
  if (legs.length === 0) return null;

  let product = 1;
  for (const leg of legs) {
    const probability = leg.fairProbability ?? leg.impliedProbability;
    if (!probability) return null;
    product *= probability / 100;
  }
  return Math.round(product * 1000) / 10;
}
