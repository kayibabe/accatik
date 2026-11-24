import type { AccaStrategy } from '../types/fixtures.ts';

/**
 * Where the legs in a slip came from. Saved tickets carry the label in their
 * name so a research basket can be told apart from a slate build at a glance.
 */
export type SlipOrigin =
  | 'slate'
  | 'positive-reads'
  | 'ai-desk'
  | 'research'
  | 'manual';

export const SLIP_ORIGIN_LABELS: Record<SlipOrigin, string> = {
  slate: 'Slate',
  'positive-reads': 'Positive Reads and Analytics',
  'ai-desk': 'AI Desk',
  research: 'Research',
  manual: 'Manual',
};

const LEGACY_RENAMES: Record<string, SlipOrigin> = {
  '2-Leg High-yield Acca (7.17 Odds)': 'slate',
  '3-Leg Goals Acca (4.41 Odds)': 'slate',
  '3-Leg Balanced Acca (3.68 Odds)': 'slate',
  '5-Leg Balanced Acca (41.90 Odds)': 'ai-desk',
  '17-Leg Balanced Acca (1112.03 Odds)': 'positive-reads',
};

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export interface TicketNameParts {
  origin: SlipOrigin;
  legCount: number;
  strategy: AccaStrategy;
  totalOdds: number;
}

/** The canonical, origin-prefixed name used for every newly saved ticket. */
export function ticketName({
  origin,
  legCount,
  strategy,
  totalOdds,
}: TicketNameParts): string {
  return `${SLIP_ORIGIN_LABELS[origin]} · ${legCount}-Leg ${capitalize(
    strategy
  )} Acca (${totalOdds.toFixed(2)} Odds)`;
}

const LEGACY_ORIGIN_PREFIXES: Partial<Record<SlipOrigin, readonly string[]>> = {
  'positive-reads': ['Positive Reads · '],
};

/** Read the origin back from a saved ticket's name when no field carries it. */
export function originFromTicketName(name: string): SlipOrigin | null {
  for (const origin of Object.keys(SLIP_ORIGIN_LABELS) as SlipOrigin[]) {
    if (name.startsWith(`${SLIP_ORIGIN_LABELS[origin]} · `)) return origin;
    if (LEGACY_ORIGIN_PREFIXES[origin]?.some((prefix) => name.startsWith(prefix))) {
      return origin;
    }
  }
  return null;
}

/**
 * One-off rename for the named tickets saved before origin tracking existed.
 * Returns null when the name is not one of the legacy tickets we know about.
 */
export function renameLegacyTicketName(name: string): string | null {
  const origin = LEGACY_RENAMES[name];
  if (!origin) return null;
  return `${SLIP_ORIGIN_LABELS[origin]} · ${name}`;
}
