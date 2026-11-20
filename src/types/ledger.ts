import type {
  AccaLeg,
  AccaStrategy,
  PriceQuality,
  SettlementStatus,
} from './fixtures.ts';

/**
 * Server-side shadow ledger.
 *
 * The app records the tickets its own engine would have produced, before the
 * user edits anything. Because no money is involved, every strategy and leg
 * budget can be tracked side by side, including the ones we expect to lose.
 * That is the only honest way to find a positive-ROI subset instead of
 * guessing from a handful of user-saved slips.
 */

/** `roi` tickets come from the promoted positive-ROI whitelist, not the strategy engine. */
export type LedgerTicketKind = 'strategy' | 'shape' | 'roi';

export interface LedgerLeg extends AccaLeg {
  priceQuality: PriceQuality;
  /** Latest pre-kickoff price seen for this selection, used for CLV. */
  closingOdds?: number;
  closingPricedAt?: string;
}

export interface LedgerTicket {
  id: string;
  dateIso: string;
  createdAt: string;
  kind: LedgerTicketKind;
  strategy: AccaStrategy;
  label: string;
  targetOdds: number;
  maxLegs: number;
  priceQuality: PriceQuality;
  legCount: number;
  totalOdds: number;
  fairProbability: number | null;
  /** Flat one-unit stake keeps every shadow ticket comparable. */
  stake: number;
  status: SettlementStatus;
  settledAt?: string;
  settledReturn?: number;
  closingTotalOdds?: number;
  /** Percent beat/miss versus the closing total: (placed ÷ closing) − 1. */
  clvPct?: number;
  /**
   * What the structural EV gate would have said about this ticket. The ledger
   * still records every leg budget so the gate itself can be graded later;
   * these fields let the summary separate "would recommend" from "measured".
   */
  guardRecommended?: boolean;
  /** Fair chance minus break-even, in percentage points. */
  guardEdgePts?: number;
  /** Leg count the gate would have kept. */
  guardLegCap?: number;
  legs: LedgerLeg[];
}

export interface LedgerFile {
  version: 1;
  updatedAt: string;
  tickets: LedgerTicket[];
}

export interface LedgerStats {
  tickets: number;
  won: number;
  lost: number;
  voided: number;
  live: number;
  pending: number;
  decided: number;
  hitRate: number | null;
  /** 100 ÷ average decided odds. The hit rate needed to break even. */
  breakEvenHitRate: number | null;
  settledStake: number;
  returns: number;
  netPnl: number;
  roi: number | null;
  avgOdds: number;
  avgLegs: number;
  avgFairProbability: number | null;
  avgClv: number | null;
}

export interface LedgerBreakdownRow extends LedgerStats {
  key: string;
  label: string;
}

export interface LedgerSummary extends LedgerStats {
  generatedAt: string;
  updatedAt: string;
  byVariant: LedgerBreakdownRow[];
  byLegCount: LedgerBreakdownRow[];
  byPriceQuality: LedgerBreakdownRow[];
  recent: LedgerTicket[];
}
