/**
 * Shared date grouping for archived tables and lists.
 *
 * `groupRowsByDate` preserves the caller's row order inside each day and the
 * order in which days, months and years are first seen. Callers that want
 * newest-first groups should sort their rows before grouping.
 */

export const CAT_TIMEZONE = 'Africa/Blantyre';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface DateDayGroup<T> {
  dateIso: string;
  rows: T[];
}

export interface DateMonthGroup<T> {
  year: number;
  month: number;
  days: DateDayGroup<T>[];
}

export interface DateYearGroup<T> {
  year: number;
  months: DateMonthGroup<T>[];
}

const catIsoFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CAT_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const dayFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: CAT_TIMEZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const monthFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: CAT_TIMEZONE,
  month: 'long',
});

/** `2026-11-18` when the value is a real ISO calendar date, otherwise null. */
export function normalizeIsoDate(value: string | undefined | null): string | null {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : value;
}

/** ISO date of an instant, in the app's Central Africa Time calendar. */
export function catIsoDate(value: string | Date): string | null {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return catIsoFormatter.format(parsed);
}

/** Shifts an ISO date by whole days without letting time zones move it. */
export function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const parsed = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  parsed.setUTCDate(parsed.getUTCDate() + deltaDays);
  return parsed.toISOString().slice(0, 10);
}

/** "Today · Wednesday, 18 November 2026" / "Yesterday · …" / the plain date. */
export function formatDateDayLabel(dateIso: string, todayIso: string): string {
  if (!dateIso) return 'Unknown date';
  const parsed = new Date(`${dateIso}T12:00:00Z`);
  const formatted = Number.isNaN(parsed.getTime())
    ? dateIso
    : dayFormatter.format(parsed);

  if (dateIso === todayIso) return `Today · ${formatted}`;
  if (dateIso === shiftIsoDate(todayIso, -1)) return `Yesterday · ${formatted}`;
  return formatted;
}

/** "November" — the year is already shown by the surrounding section. */
export function formatDateMonthLabel(month: number): string {
  if (!Number.isInteger(month) || month < 1 || month > 12) return 'Unknown month';
  return monthFormatter.format(new Date(Date.UTC(2026, month - 1, 1, 12)));
}

export function formatDateYearLabel(year: number): string {
  return year > 0 ? String(year) : 'Unknown year';
}

/**
 * Year → month → date, preserving the input order at every level. Invalid
 * dates are collected into a final "Unknown" year so no row is dropped.
 */
export function groupRowsByDate<T>(
  rows: ReadonlyArray<T>,
  getDateIso: (row: T) => string | null | undefined
): DateYearGroup<T>[] {
  const years = new Map<number, Map<number, Map<string, T[]>>>();

  for (const row of rows) {
    const rawIso = getDateIso(row);
    const iso = normalizeIsoDate(rawIso) ?? '';
    const year = iso ? Number(iso.slice(0, 4)) : 0;
    const month = iso ? Number(iso.slice(5, 7)) : 0;

    let months = years.get(year);
    if (!months) {
      months = new Map();
      years.set(year, months);
    }

    let days = months.get(month);
    if (!days) {
      days = new Map();
      months.set(month, days);
    }

    const dayRows = days.get(iso);
    if (dayRows) dayRows.push(row);
    else days.set(iso, [row]);
  }

  return [...years.entries()]
    .sort(([yearA], [yearB]) => {
      if (yearA === 0 && yearB === 0) return 0;
      if (yearA === 0) return 1;
      if (yearB === 0) return -1;
      return 0;
    })
    .map(([year, months]) => ({
      year,
      months: [...months.entries()].map(([month, days]) => ({
        year,
        month,
        days: [...days.entries()].map(([dateIso, dayRows]) => ({
          dateIso,
          rows: dayRows,
        })),
      })),
    }));
}
