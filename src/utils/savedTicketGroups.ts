import type { AccaLeg, SavedTicket } from '../types/fixtures.ts';

/**
 * Grouping helpers for the Local Ticket Archive.
 *
 * The archive is ordered newest-first and split into year → month → matchday
 * sections. Only the current matchday is expanded by default; every older day
 * is one click away.
 */

export const CAT_TIMEZONE = 'Africa/Blantyre';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface TicketDayGroup {
  dateIso: string;
  tickets: SavedTicket[];
}

export interface TicketMonthGroup {
  year: number;
  month: number;
  days: TicketDayGroup[];
}

export interface TicketYearGroup {
  year: number;
  months: TicketMonthGroup[];
}

/** All the selections made against one match on a saved slip. */
export interface TicketLegGroup {
  fixtureId: string;
  legs: AccaLeg[];
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

/**
 * The matchday a slip belongs to. `dateIso` is authoritative; slips saved
 * before that field existed fall back to their display date, then to the
 * moment they were saved.
 */
export function ticketDateIso(ticket: SavedTicket): string {
  const direct = normalizeIsoDate(ticket.dateIso);
  if (direct) return direct;

  const fromDisplay = catIsoDate(ticket.date);
  if (fromDisplay) return fromDisplay;

  return catIsoDate(ticket.createdAt) ?? '1970-01-01';
}

function createdAtMs(ticket: SavedTicket): number {
  const parsed = Date.parse(ticket.createdAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Latest matchday first; within a matchday the most recently saved slip wins. */
export function sortTicketsNewestFirst(tickets: SavedTicket[]): SavedTicket[] {
  return [...tickets].sort((a, b) => {
    const byDate = ticketDateIso(b).localeCompare(ticketDateIso(a));
    if (byDate !== 0) return byDate;
    return createdAtMs(b) - createdAtMs(a);
  });
}

/** Year → month → matchday, each level newest-first. */
export function groupTicketsByDate(tickets: SavedTicket[]): TicketYearGroup[] {
  const years = new Map<number, Map<number, Map<string, SavedTicket[]>>>();

  for (const ticket of sortTicketsNewestFirst(tickets)) {
    const iso = ticketDateIso(ticket);
    const year = Number(iso.slice(0, 4));
    const month = Number(iso.slice(5, 7));

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

    const dayTickets = days.get(iso);
    if (dayTickets) dayTickets.push(ticket);
    else days.set(iso, [ticket]);
  }

  return [...years.entries()].map(([year, months]) => ({
    year,
    months: [...months.entries()].map(([month, days]) => ({
      year,
      month,
      days: [...days.entries()].map(([dateIso, dayTickets]) => ({
        dateIso,
        tickets: dayTickets,
      })),
    })),
  }));
}

/**
 * ROI-built slips can carry several cards (angle, cover, note) for the same
 * match. Collapse those selections into one match group, keeping the order in
 * which they appear on the ticket.
 */
export function groupLegsByFixture(legs: AccaLeg[]): TicketLegGroup[] {
  const groups: TicketLegGroup[] = [];
  const byFixture = new Map<string, TicketLegGroup>();

  for (const leg of legs) {
    let group = byFixture.get(leg.fixtureId);
    if (!group) {
      group = { fixtureId: leg.fixtureId, legs: [] };
      byFixture.set(leg.fixtureId, group);
      groups.push(group);
    }
    group.legs.push(leg);
  }

  return groups;
}

/** Shifts an ISO date by whole days without letting time zones move it. */
export function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const parsed = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  parsed.setUTCDate(parsed.getUTCDate() + deltaDays);
  return parsed.toISOString().slice(0, 10);
}

/** "Today · Wednesday, 18 November 2026" / "Yesterday · …" / the plain date. */
export function formatTicketDayLabel(dateIso: string, todayIso: string): string {
  const parsed = new Date(`${dateIso}T12:00:00Z`);
  const formatted = Number.isNaN(parsed.getTime())
    ? dateIso
    : dayFormatter.format(parsed);

  if (dateIso === todayIso) return `Today · ${formatted}`;
  if (dateIso === shiftIsoDate(todayIso, -1)) return `Yesterday · ${formatted}`;
  return formatted;
}

/** "November" — the year is already the surrounding section heading. */
export function formatTicketMonthLabel(month: number): string {
  if (!Number.isInteger(month) || month < 1 || month > 12) return 'Unknown month';
  return monthFormatter.format(new Date(Date.UTC(2026, month - 1, 1, 12)));
}
