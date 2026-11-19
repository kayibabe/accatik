import type { AccaStrategy } from '../types/fixtures.ts';

/**
 * Ticket shapes are the product-level answer to the accumulator maths:
 * every extra leg multiplies the bookmaker's margin, so a 6-leg ticket needs
 * a far higher hit rate than its own de-vigged chance can support.
 *
 * Each preset fixes the leg budget as well as the target, which prevents the
 * builder from "helpfully" adding legs just to reach a big headline price.
 */
export type TicketShapeId = 'safe' | 'balanced' | 'value' | 'lottery';

export interface TicketShape {
  id: TicketShapeId;
  label: string;
  /** Combined odds the builder aims for. */
  targetOdds: number;
  /** Hard ceiling on selections, regardless of target. */
  maxLegs: number;
  strategy: AccaStrategy;
  description: string;
}

export const TICKET_SHAPES: ReadonlyArray<TicketShape> = [
  {
    id: 'safe',
    label: 'Safe · 2 legs',
    targetOdds: 2.0,
    maxLegs: 2,
    strategy: 'favorites',
    description:
      'Two short-priced favourites. Lowest variance and the closest thing to a repeatable hit rate.',
  },
  {
    id: 'balanced',
    label: 'Balanced · 3 legs',
    targetOdds: 2.8,
    maxLegs: 3,
    strategy: 'balanced',
    description:
      'Three mid-priced picks. The default sweet spot between price and probability.',
  },
  {
    id: 'value',
    label: 'Value · 4 legs',
    targetOdds: 3.6,
    maxLegs: 4,
    strategy: 'goals',
    description:
      'Four goal-market angles. More price, but still a realistic combined hit chance.',
  },
  {
    id: 'lottery',
    label: 'Lottery · 5.00+',
    targetOdds: 5.0,
    maxLegs: 6,
    strategy: 'high-yield',
    description:
      'The old default. Treat it as entertainment: the bookmaker margin compounds on every leg.',
  },
];

/** The preset matching the current controls exactly, if any. */
export function matchTicketShape(
  strategy: AccaStrategy,
  targetOdds: number,
  maxLegs: number
): TicketShape | null {
  return (
    TICKET_SHAPES.find(
      (shape) =>
        shape.strategy === strategy &&
        Math.abs(shape.targetOdds - targetOdds) < 0.001 &&
        shape.maxLegs === maxLegs
    ) ?? null
  );
}
