import type { AccaStrategy, Fixture, MarketOption } from '../types/fixtures.ts';
import { marketProbability } from './probability.ts';

/**
 * The single "pick" for a fixture.
 *
 * The green recommended-angle card, the highlighted odds tile, the settlement
 * label and the auto-built ticket all call `resolvePick`, so the screen can no
 * longer name three different markets for the same match. Strategy rules live
 * here and nowhere else.
 */

export function isPriced(market: MarketOption): boolean {
  return Number.isFinite(market.odds) && market.odds > 1;
}

/**
 * Rates how well a market fits the selected strategy. Used both to choose the
 * pick on one fixture and to rank fixtures against each other in a slip.
 */
export function scoreMarket(
  fixture: Fixture,
  market: MarketOption,
  strategy: AccaStrategy
): number {
  if (strategy === 'probability') {
    // Strict margin-adjusted probability, highest first. Bands are fine-grained
    // enough that league prestige only breaks genuine ties.
    return marketProbability(market);
  }

  const isRecommended = market.id === fixture.recommendedPickId ? 1.25 : 1.0;

  if (strategy === 'favorites') {
    const sweetSpot = market.odds >= 1.22 && market.odds <= 1.7 ? 1.3 : 0.9;
    return (1 / Math.max(market.odds, 1.05)) * sweetSpot * isRecommended;
  }

  if (strategy === 'goals') {
    const isGoalsMarket =
      market.marketType === 'Goals' || market.marketType === 'BTTS' ? 1.55 : 0.8;
    const sweetSpot = market.odds >= 1.3 && market.odds <= 2.15 ? 1.2 : 0.95;
    return isGoalsMarket * sweetSpot * isRecommended;
  }

  if (strategy === 'high-yield') {
    // "High-yield" used to climb to the longest price on the board (3.00+ in
    // practice, and frequently 6.00+), which is precisely where the
    // bookmaker margin compounds fastest. Prefer the 2.10–3.40 band and
    // actively downgrade true longshots.
    const inBand = market.odds >= 2.1 && market.odds <= 3.4;
    const bandWeight = inBand ? 1.45 : market.odds > 4 ? 0.45 : 0.85;
    return (
      (bandWeight / (1 + Math.abs(market.odds - 2.75) * 0.25)) *
      isRecommended
    );
  }

  const balancedBand = market.odds >= 1.32 && market.odds <= 1.95 ? 1.35 : 0.9;
  return (1 / Math.max(market.odds, 1.1)) * balancedBand * isRecommended;
}

function highestProbability(markets: MarketOption[]): MarketOption {
  return markets.reduce((best, market) =>
    marketProbability(market) > marketProbability(best) ? market : best
  );
}

/**
 * Picks the market this strategy would back on `fixture`, or null when the book
 * has no usable price.
 *
 * `balanced` keeps following the server's `recommendedPickId` (the price-band
 * sweet spot computed from the live book) so the card stays stable between
 * re-renders. Every other strategy is scored locally.
 */
export function resolvePick(
  fixture: Fixture,
  strategy: AccaStrategy
): MarketOption | null {
  const priced = fixture.markets.filter(isPriced);
  if (priced.length === 0) return null;

  if (strategy === 'probability') return highestProbability(priced);

  if (strategy === 'balanced') {
    const recommended = priced.find(
      (market) => market.id === fixture.recommendedPickId
    );
    if (recommended) return recommended;
  }

  return priced.reduce((best, market) =>
    scoreMarket(fixture, market, strategy) >
    scoreMarket(fixture, best, strategy)
      ? market
      : best
  );
}
