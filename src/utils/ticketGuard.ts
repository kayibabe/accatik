import type {
  AccaLeg,
  TicketEconomicsSummary,
  TicketGuardSummary,
} from '../types/fixtures.ts';
import {
  calculateCombinedImpliedProbability,
  calculateTotalOdds,
} from './accaMath.ts';
import { combinedFairProbability } from './probability.ts';

/**
 * Structural guard for accumulator recommendations.
 *
 * Every leg is bought at a price that already contains the bookmaker's margin.
 * Those margins multiply: with a 10.9% book, a 3-leg ticket starts ~27% behind
 * and an 8-leg ticket ~56% behind, no matter how good the individual picks
 * look. The guard does two things:
 *
 *   1. It caps the headline ticket at three legs (two when the average price is
 *      so short that the margin compounds fastest).
 *   2. It withholds the "recommended" label when the de-vigged chance is far
 *      below the break-even rate the quoted price needs.
 *
 * It does not pretend a ticket is positive-EV. It only stops the product from
 * presenting a structurally losing ticket as a recommendation.
 */
export const MAX_RECOMMENDED_LEGS = 3;

/**
 * A ticket must beat fair, not merely sit close to it. Because the fair
 * probability is de-vigged from the same bookmaker prices, this threshold is
 * effectively unreachable without an independent model — which is the honest
 * state of the product today. The gate still caps the shape and explains the
 * negative EV instead of pretending the ticket is a recommendation.
 */
export const MIN_RECOMMENDED_EDGE_PTS = 0;

/** Average leg price below this is capped at two legs. */
const SHORT_PRICE_THRESHOLD = 1.2;

export type TicketEconomics = TicketEconomicsSummary;

export interface TicketGuardOptions {
  /** Absolute ceiling, regardless of price. Defaults to the recommended cap. */
  maxLegs?: number;
  /** Edge (in points) required to keep the recommended label. */
  minEdgePts?: number;
  /** Keep locked selections even when they push past the cap. */
  preserveLocked?: boolean;
  /**
   * Research/shadow tickets only. Skips the short-price cap and never grants
   * the "recommended" label. The 2–3 leg framework cap still applies, so a
   * 5.00+ target is left short rather than padded with extra legs.
   */
  researchMode?: boolean;
}

export interface TicketGuardResult extends TicketGuardSummary {
  legs: AccaLeg[];
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

const round2 = (value: number): number => Math.round(value * 100) / 100;

export function ticketEconomics(legs: AccaLeg[]): TicketEconomics {
  if (legs.length === 0) {
    return {
      legCount: 0,
      totalOdds: 0,
      fairChance: 0,
      breakEvenChance: 0,
      edgePts: 0,
      expectedRoi: 0,
      combinedOverround: 1,
      basis: 'fair',
    };
  }

  const rawProduct = legs.reduce((product, leg) => product * leg.odds, 1);
  // `combinedFairProbability` silently falls back to the implied probability
  // per leg, so the basis has to be decided from the legs themselves.
  const basis: 'fair' | 'implied' = legs.every((leg) =>
    Number.isFinite(leg.fairProbability)
  )
    ? 'fair'
    : 'implied';
  const fairChance =
    combinedFairProbability(legs) ??
    calculateCombinedImpliedProbability(legs);
  const breakEvenChance = rawProduct > 1 ? 100 / rawProduct : 0;
  const edgePts = fairChance - breakEvenChance;
  const expectedRoi = fairChance * rawProduct - 100;
  const combinedOverround =
    fairChance > 0 ? breakEvenChance / fairChance : 1;

  return {
    legCount: legs.length,
    totalOdds: calculateTotalOdds(legs),
    fairChance: round1(fairChance),
    breakEvenChance: round1(breakEvenChance),
    edgePts: round1(edgePts),
    expectedRoi: round1(expectedRoi),
    combinedOverround: round2(combinedOverround),
    basis,
  };
}

/**
 * Price-aware ceiling. Short legs compound the same percentage margin into a
 * much larger absolute loss, so an ultra-short ticket is held to two legs even
 * though three is the normal maximum. The average is taken over the legs that
 * would actually be kept, not the whole candidate pool: a single long price
 * must not disguise three ultra-short legs.
 */
export function recommendedLegCap(legs: AccaLeg[]): number {
  if (legs.length <= 1) return legs.length;
  const ceiling = Math.min(MAX_RECOMMENDED_LEGS, legs.length);
  return priceAwareCap(legs.slice(0, ceiling));
}

function averageOdds(legs: AccaLeg[]): number {
  const product = legs.reduce((total, leg) => total * leg.odds, 1);
  return product ** (1 / legs.length);
}

function priceAwareCap(shortlist: AccaLeg[]): number {
  if (shortlist.length < 2) return shortlist.length;
  return averageOdds(shortlist) < SHORT_PRICE_THRESHOLD
    ? Math.min(2, shortlist.length)
    : shortlist.length;
}

/**
 * Trim a ticket to the recommended shape and grade it. Selection order is
 * preserved, so the legs the engine ranked highest survive the trim.
 */
export function guardTicket(
  legs: AccaLeg[],
  options: TicketGuardOptions = {}
): TicketGuardResult {
  if (legs.length === 0) {
    return {
      legs: [],
      economics: ticketEconomics([]),
      recommended: false,
      reason: 'No selections yet.',
      originalLegCount: 0,
      trimmedCount: 0,
    };
  }

  // Locks choose *which* legs survive the trim, never whether the cap applies.
  const ordered = options.preserveLocked
    ? [...legs.filter((leg) => leg.locked), ...legs.filter((leg) => !leg.locked)]
    : legs;

  const research = options.researchMode === true;
  const cap = MAX_RECOMMENDED_LEGS;
  const ceiling = Math.max(
    1,
    Math.min(options.maxLegs ?? cap, cap, legs.length)
  );
  const shortlist = ordered.slice(0, ceiling);
  const keptSet = new Set(
    research ? shortlist : shortlist.slice(0, priceAwareCap(shortlist))
  );
  const kept = legs.filter((leg) => keptSet.has(leg));

  const economics = ticketEconomics(kept);
  const minEdge = options.minEdgePts ?? MIN_RECOMMENDED_EDGE_PTS;
  const trimmedCount = legs.length - kept.length;
  // A ticket priced from implied probabilities can never clear the gate: the
  // margin is already baked into those numbers, so an "edge" there is just a
  // rounding artifact.
  const recommended =
    !research &&
    kept.length >= 2 &&
    economics.basis === 'fair' &&
    economics.edgePts > minEdge;

  const reasons: string[] = [];
  if (research) {
    reasons.push(
      'Research ticket: short-price legs are allowed, but the 2–3 leg framework cap still applies and this is not a recommendation.'
    );
  }
  if (trimmedCount > 0) {
    reasons.push(
      `Capped at ${kept.length} legs so the bookmaker margin cannot compound further.`
    );
  }
  if (kept.length < 2) {
    reasons.push('A single selection is not an accumulator.');
  } else if (economics.basis === 'implied') {
    reasons.push(
      'No de-vigged price is available for every leg, so the chance shown still includes the bookmaker margin.'
    );
  } else if (economics.edgePts <= minEdge) {
    reasons.push(
      `Fair chance ${economics.fairChance.toFixed(1)}% is ${Math.abs(
        economics.edgePts
      ).toFixed(1)} points below the ${economics.breakEvenChance.toFixed(
        1
      )}% this price needs, so the ticket is negative-EV.`
    );
  } else {
    reasons.push(
      `Price beats fair by ${economics.edgePts.toFixed(1)} points.`
    );
  }

  return {
    legs: kept,
    economics,
    recommended,
    reason: reasons.join(' '),
    originalLegCount: legs.length,
    trimmedCount,
  };
}
