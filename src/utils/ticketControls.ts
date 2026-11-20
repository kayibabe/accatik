import type { TicketVariantConfig } from '../types/analytics.ts';
import type { AccaStrategy } from '../types/fixtures.ts';
import { MAX_RECOMMENDED_LEGS } from './ticketGuard.ts';
import { TICKET_SHAPES } from './ticketShapes.ts';

/**
 * The values offered by the accumulator slip, kept in one place so the ticket
 * builder and its inception-to-date replay can never drift apart. Changing a
 * preset here changes both what the user can click and what gets measured.
 */
export const TICKET_STRATEGY_OPTIONS: ReadonlyArray<{
  id: AccaStrategy;
  label: string;
}> = [
  { id: 'balanced', label: 'Balanced' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'goals', label: 'Goals' },
  { id: 'high-yield', label: 'High-Yield' },
  { id: 'probability', label: 'Most Likely' },
];

/** The slip's "Min Odds" buttons are builder targets, not filter thresholds. */
export const TICKET_TARGET_ODDS_OPTIONS: readonly number[] = [2, 2.8, 3.6, 5, 8];

/** Structural cap of three legs: 4/6/8 would only invite lottery accumulators. */
export const TICKET_MAX_LEGS_OPTIONS: readonly number[] = Array.from(
  { length: MAX_RECOMMENDED_LEGS - 1 },
  (_, index) => index + 2
);

export const DEFAULT_TICKET_MIN_ODDS = 2.8;
export const DEFAULT_TICKET_MAX_LEGS = 3;

export const strategyLabel = (strategy: AccaStrategy): string =>
  TICKET_STRATEGY_OPTIONS.find((option) => option.id === strategy)?.label ??
  strategy;

export function normalizeTicketControls(
  input: { strategy?: unknown; minOdds?: unknown; maxLegs?: unknown } = {}
): { strategy: AccaStrategy; minOdds: number; maxLegs: number } {
  const strategy = TICKET_STRATEGY_OPTIONS.find(
    (option) => option.id === input.strategy
  )?.id ?? 'balanced';
  // Legacy preferences can hold a target that is no longer one of the buttons.
  // Keep it for the "current shape" row instead of silently describing a
  // different ticket; the fixed options still drive the comparison tables.
  const minOdds =
    typeof input.minOdds === 'number' &&
    Number.isFinite(input.minOdds) &&
    input.minOdds >= 1.5 &&
    input.minOdds <= 100
      ? Math.round(input.minOdds * 100) / 100
      : DEFAULT_TICKET_MIN_ODDS;
  const maxLegs =
    typeof input.maxLegs === 'number' &&
    Number.isInteger(input.maxLegs) &&
    input.maxLegs >= 2 &&
    input.maxLegs <= MAX_RECOMMENDED_LEGS
      ? input.maxLegs
      : DEFAULT_TICKET_MAX_LEGS;
  return { strategy, minOdds, maxLegs };
}

export interface TicketVariants {
  shapes: TicketVariantConfig[];
  strategies: TicketVariantConfig[];
  odds: TicketVariantConfig[];
  legs: TicketVariantConfig[];
  current: TicketVariantConfig;
}

/**
 * Every slip control becomes one replayable variant. Single-control tables hold
 * the other two controls fixed at the values currently on the slip, so a change
 * in ROI can be attributed to the control being examined.
 */
export function buildTicketVariants(
  strategy: AccaStrategy,
  minOdds: number,
  maxLegs: number
): TicketVariants {
  const current: TicketVariantConfig = {
    id: 'current',
    group: 'current',
    label: 'Your current shape',
    strategy,
    targetOdds: minOdds,
    maxLegs,
    description: `${strategyLabel(strategy)} · ${minOdds.toFixed(2)}+ · ${maxLegs} legs`,
  };

  return {
    shapes: TICKET_SHAPES.map((shape) => ({
      id: `shape:${shape.id}`,
      group: 'shape' as const,
      label: shape.label,
      strategy: shape.strategy,
      targetOdds: shape.targetOdds,
      maxLegs: shape.maxLegs,
      description: shape.description,
    })),
    strategies: TICKET_STRATEGY_OPTIONS.map((option) => ({
      id: `strategy:${option.id}`,
      group: 'strategy' as const,
      label: option.label,
      strategy: option.id,
      targetOdds: minOdds,
      maxLegs,
      description: `${option.label} · ${minOdds.toFixed(2)}+ · ${maxLegs} legs`,
    })),
    odds: TICKET_TARGET_ODDS_OPTIONS.map((value) => ({
      id: `odds:${value}`,
      group: 'odds' as const,
      label: `${value.toFixed(2)}+`,
      strategy,
      targetOdds: value,
      maxLegs,
      description: `${strategyLabel(strategy)} · ${value.toFixed(2)}+ · ${maxLegs} legs`,
    })),
    legs: TICKET_MAX_LEGS_OPTIONS.map((value) => ({
      id: `legs:${value}`,
      group: 'legs' as const,
      label: `${value} legs`,
      strategy,
      targetOdds: minOdds,
      maxLegs: value,
      description: `${strategyLabel(strategy)} · ${minOdds.toFixed(2)}+ · ${value} legs`,
    })),
    current,
  };
}
