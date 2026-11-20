import type { LedgerBreakdownRow } from '../types/ledger.ts';

/**
 * Automatic shortlist for the shadow-ledger variant scorecard.
 *
 * These are monitoring thresholds, not a betting signal: with only a handful
 * of settled tickets per variant the resulting rows are research data for the
 * promotion gate, never a recommendation to place a ticket. The thresholds
 * reproduce the extracted positive-ROI table (ROI >= 25%, Hit >= 60%, CLV >= 0).
 */
export const SHADOW_ROI_SHORTLIST = {
  minRoiPct: 25,
  minHitPct: 60,
  minAvgClvPct: 0,
} as const;

const meets = (value: number | null, minimum: number): boolean =>
  value !== null && Number.isFinite(value) && value >= minimum;

/** A row with unknown ROI, hit rate or CLV cannot qualify. */
export function qualifiesForShadowRoiShortlist(row: LedgerBreakdownRow): boolean {
  return (
    meets(row.roi, SHADOW_ROI_SHORTLIST.minRoiPct) &&
    meets(row.hitRate, SHADOW_ROI_SHORTLIST.minHitPct) &&
    meets(row.avgClv, SHADOW_ROI_SHORTLIST.minAvgClvPct)
  );
}

/**
 * Filter then rank by ROI first, so the in-app table matches the extracted
 * shortlist. Ties fall back to hit rate and then label for a stable order.
 */
export function selectShadowRoiShortlist(
  rows: LedgerBreakdownRow[]
): LedgerBreakdownRow[] {
  return rows
    .filter(qualifiesForShadowRoiShortlist)
    .sort(
      (a, b) =>
        (b.roi as number) - (a.roi as number) ||
        (b.hitRate as number) - (a.hitRate as number) ||
        a.label.localeCompare(b.label)
    );
}
