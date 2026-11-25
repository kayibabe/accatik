/**
 * Shared display formatters.
 *
 * Data-heavy views used to carry slightly different copies of these helpers,
 * which made the same metric read differently between screens. Keep every
 * numeric string in the app flowing through here so nulls, signs and units
 * behave identically everywhere.
 */

/** Locale overrides accepted by every formatter in this module. */
export interface FormatLocaleOptions {
  locale?: string;
  timeZone?: string;
}

/** Null-safe fixed-point number. Missing or non-finite values show an em dash. */
export function fmtFixed(
  value: number | null | undefined,
  digits = 2,
  options: FormatLocaleOptions & { sign?: boolean; suffix?: string } = {}
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const { sign = false, suffix = '', locale } = options;
  // Intl renders -0 with a sign; toFixed() never did. Keep the old output.
  const normalized = Object.is(value, -0) ? 0 : value;
  const formatted = new Intl.NumberFormat(locale ?? 'en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
    signDisplay: sign ? 'exceptZero' : 'auto',
  }).format(normalized);
  return `${formatted}${suffix}`;
}

/** Percentage without an explicit sign, e.g. `64.2%`. */
export function fmtPercent(
  value: number | null | undefined,
  digits = 1,
  options: FormatLocaleOptions = {}
): string {
  return fmtFixed(value, digits, { ...options, suffix: '%' });
}

/** Percentage with an explicit sign for positive values, e.g. `+5.4%`. */
export function fmtSignedPercent(
  value: number | null | undefined,
  digits = 1,
  options: FormatLocaleOptions = {}
): string {
  return fmtFixed(value, digits, { ...options, sign: true, suffix: '%' });
}

/** Unit stake / profit figure, e.g. `+2.40u`, `-0.50u`, `0.00u`. */
export function fmtUnits(
  value: number | null | undefined,
  digits = 2,
  options: FormatLocaleOptions = {}
): string {
  return fmtFixed(value, digits, { ...options, sign: true, suffix: 'u' });
}

/** Decimal odds, always two places. */
export function fmtOdds(
  value: number | null | undefined,
  options: FormatLocaleOptions = {}
): string {
  return fmtFixed(value, 2, options);
}

/** Malawian kwacha with grouped thousands and a fixed number of decimals. */
export function fmtMwk(
  value: number | null | undefined,
  digits = 2,
  options: FormatLocaleOptions = {}
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const normalized = Object.is(value, -0) ? 0 : value;
  return `MK ${new Intl.NumberFormat(options.locale ?? 'en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(normalized)}`;
}

/** Integer count with grouping, e.g. `1,280`. */
export function fmtCount(
  value: number | null | undefined,
  options: FormatLocaleOptions = {}
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(options.locale ?? 'en-MW', {
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

/** Short date (or an em dash) for compact data-status strips. */
export function fmtShortDate(
  value: string | null | undefined,
  options: FormatLocaleOptions = {}
): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(options.locale ?? 'en-GB', {
    day: '2-digit',
    month: 'short',
    timeZone: options.timeZone,
  }).format(parsed);
}
