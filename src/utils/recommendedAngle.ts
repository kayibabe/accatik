import type { AccaStrategy, Fixture, MarketOption } from '../types/fixtures.ts';
import { isPriced, resolvePick } from './pickResolver.ts';
import { marketProbability } from './probability.ts';

/**
 * Per-match "recommended angle".
 *
 * The board highlights one pick per match, but a price alone does not tell you
 * how much weight it deserves. This turns the pick into an opinionated,
 * one-line recommendation: how strong it is, what that means for placement,
 * and — when the primary pick is aggressive — the safer cover on the same
 * fixture.
 *
 * The pick itself comes from `resolvePick`, the same function that labels the
 * odds tile and builds the ticket. `shortestPrice` is deliberately *not* a
 * pick: it is the highest-probability price on the board, shown as context.
 */

export type AngleConfidence = 'High' | 'Solid' | 'Moderate' | 'Speculative';

export interface RecommendedAngle {
  /** The selection being recommended. */
  market: MarketOption;
  /** Margin-adjusted probability (percent). */
  probability: number;
  confidence: AngleConfidence;
  /** How to use the selection, in one sentence. */
  note: string;
  /** A shorter-priced, higher-probability market of a different type. */
  cover: MarketOption | null;
  coverProbability: number;
  /** Highest-probability market on the fixture — context, not a tip. */
  shortestPrice: MarketOption | null;
  shortestPriceProbability: number;
}

const CONFIDENCE_NOTES: Record<AngleConfidence, string> = {
  High: 'Anchor leg — the shortest route to a high win chance.',
  Solid: 'Core selection — a balanced price for the risk.',
  Moderate: 'Thin edge — works as a middle leg, not an anchor.',
  Speculative: 'Long shot — only worth it when the price is the point.',
};

export function angleConfidence(probability: number): AngleConfidence {
  if (probability >= 70) return 'High';
  if (probability >= 52) return 'Solid';
  if (probability >= 38) return 'Moderate';
  return 'Speculative';
}

/**
 * Builds the angle for one fixture, following the active strategy so the card,
 * the highlighted tile and the ticket never disagree.
 */
export function buildRecommendedAngle(
  fixture: Fixture,
  strategy: AccaStrategy
): RecommendedAngle | null {
  const priced = fixture.markets.filter(isPriced);
  if (priced.length === 0) return null;

  const primary = resolvePick(fixture, strategy);
  if (!primary) return null;

  const probability = marketProbability(primary);
  const confidence = angleConfidence(probability);

  // A cover only makes sense when it is both safer and a different bet
  // (a lower-probability side of the same market is not a cover).
  const cover =
    priced
      .filter(
        (market) =>
          market.marketType !== primary.marketType &&
          marketProbability(market) > probability
      )
      .sort((a, b) => marketProbability(b) - marketProbability(a))[0] ?? null;

  const shortestPrice = priced.reduce((best, market) =>
    marketProbability(market) > marketProbability(best) ? market : best
  );

  return {
    market: primary,
    probability,
    confidence,
    note: CONFIDENCE_NOTES[confidence],
    cover,
    coverProbability: cover ? marketProbability(cover) : 0,
    shortestPrice,
    shortestPriceProbability: marketProbability(shortestPrice),
  };
}
