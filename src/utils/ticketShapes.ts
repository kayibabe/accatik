import type { AccaStrategy } from '../types/fixtures.ts';

/**
 * Ticket shapes are the product-level answer to the accumulator maths:
 * every extra leg multiplies the bookmaker's margin, so the old 6- and 8-leg
 * presets needed a far higher hit rate than their own de-vigged chance could
 * support. Presets top out at five legs, with short-price tickets held tighter
 * by the structural guard.
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
    label: 'Value · 3 legs',
    targetOdds: 3.6,
    maxLegs: 3,
    strategy: 'goals',
    description:
      'Three goal-market angles. Capped at three legs because every extra leg multiplies the bookmaker margin.',
  },
  {
    id: 'lottery',
    label: 'Long Shot · 5.00+',
    targetOdds: 5.0,
    maxLegs: 5,
    strategy: 'high-yield',
    description:
      'Up to five longer prices chasing 5.00+. Still negative EV on average: treat it as entertainment, not a plan.',
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
