/**
 * One voice for the research/shadow boundary. Each surface keeps its own
 * context, but the rules that repeat across screens use the same words so the
 * app never gives a ticket two different statuses.
 */
export const researchCopy = {
  notRecommendation: 'Research, not a betting recommendation.',
  verifyPrices: 'Verify prices and results with your bookmaker before placing a bet.',
  wideSlip: 'Wide research slip — kept in full, never marked as recommended.',
  ledgerBoundary:
    'Saved slips stay in this browser; the engine’s shadow ledger is a separate append-only record.',
} as const;

/** The shadow ledger's flat-stake, never-staked rule, with a variable stake. */
export function shadowLedgerNote(stake: string | number = 'one'): string {
  return `Recorded in the shadow ledger at a flat ${stake}-unit stake; never placed with a bookmaker.`;
}
