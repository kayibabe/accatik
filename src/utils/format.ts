/**
 * Shared display formatters.
 *
 * Data-heavy views used to carry slightly different copies of these helpers,
 * which made the same metric read differently between screens. Keep every
 * numeric string in the app flowing through here so nulls, signs and units
 * behave identically everywhere.
 */

/** Null-safe fixed-point number. Missing or non-finite values show an em dash. */
export function fmtFixed(
  value: number | null | undefined,
  digits = 2,
  options: { sign?: boolean; suffix?: string } = {}
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const { sign = false, suffix = '' } = options;
  const prefix = sign && value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(digits)}${suffix}`;
}

/** Percentage without an explicit sign, e.g. `64.2%`. */
export function fmtPercent(value: number | null | undefined, digits = 1): string {
  return fmtFixed(value, digits, { suffix: '%' });
}

/** Percentage with an explicit sign for positive values, e.g. `+5.4%`. */
export function fmtSignedPercent(
  value: number | null | undefined,
  digits = 1
): string {
  return fmtFixed(value, digits, { sign: true, suffix: '%' });
}

/** Unit stake / profit figure, e.g. `+2.40u`, `-0.50u`, `0.00u`. */
export function fmtUnits(value: number | null | undefined, digits = 2): string {
  return fmtFixed(value, digits, { sign: true, suffix: 'u' });
}

/** Decimal odds, always two places. */
export function fmtOdds(value: number | null | undefined): string {
  return fmtFixed(value, 2);
}

/** Malawian kwacha with grouped thousands and a fixed number of decimals. */
export function fmtMwk(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `MK ${value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

/** Integer count with grouping, e.g. `1,280`. */
export function fmtCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return Math.round(value).toLocaleString('en-MW');
}

/** Short date (or an em dash) for compact data-status strips. */
export function fmtShortDate(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}
