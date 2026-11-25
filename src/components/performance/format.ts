import {
  fmtCount,
  fmtMwk,
  type FormatLocaleOptions,
} from '../../utils/format.ts';

/**
 * Display helpers shared by the performance surfaces.
 *
 * The numeric primitives live in `utils/format.ts`; this module only combines
 * them into the two shapes the analytics tables keep repeating.
 */

/** Money with an explicit sign, e.g. `+MK 1,200.00` / `-MK 40.00`. */
export function signedMwk(
  value: number | null | undefined,
  options: Pick<FormatLocaleOptions, 'locale'> = {}
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return fmtMwk(value, 2, options);
  }
  if (value > 0) return `+${fmtMwk(value, 2, options)}`;
  if (value < 0) return `-${fmtMwk(Math.abs(value), 2, options)}`;
  return fmtMwk(0, 2, options);
}

/** Won / lost / voided summary used by every settlement table. */
export function recordLabel(
  won: number,
  lost: number,
  voided: number,
  separator = ' · ',
  options: Pick<FormatLocaleOptions, 'locale'> = {}
): string {
  return `${fmtCount(won, options)}${separator}${fmtCount(lost, options)}${separator}${fmtCount(voided, options)}`;
}
