import { formatMwk } from '../../utils/accaMath.ts';
import { fmtCount, fmtMwk } from '../../utils/format.ts';

/**
 * Display helpers shared by the performance surfaces.
 *
 * The numeric primitives live in `utils/format.ts`; this module only combines
 * them into the two shapes the analytics tables keep repeating.
 */

/** Money with an explicit sign, e.g. `+MK 1,200.00` / `-MK 40.00`. */
export function signedMwk(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return fmtMwk(value);
  }
  if (value > 0) return `+${formatMwk(value)}`;
  if (value < 0) return `-${formatMwk(Math.abs(value))}`;
  return formatMwk(0);
}

/** Won / lost / voided summary used by every settlement table. */
export function recordLabel(
  won: number,
  lost: number,
  voided: number,
  separator = ' · '
): string {
  return `${fmtCount(won)}${separator}${fmtCount(lost)}${separator}${fmtCount(voided)}`;
}
