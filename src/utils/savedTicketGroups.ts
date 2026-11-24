import type { AccaLeg, SavedTicket } from '../types/fixtures.ts';
import {
  CAT_TIMEZONE,
  catIsoDate,
  formatDateDayLabel,
  formatDateMonthLabel,
  groupRowsByDate,
  normalizeIsoDate,
  shiftIsoDate,
  type DateDayGroup,
  type DateMonthGroup,
  type DateYearGroup,
} from './dateGroups.ts';

/**
 * Grouping helpers for the Local Ticket Archive.
 *
 * The archive is ordered newest-first and split into year → month → matchday
 * sections. Only the current matchday is expanded by default; every older day
 * is one click away.
 */

export {
  CAT_TIMEZONE,
  catIsoDate,
  normalizeIsoDate,
  shiftIsoDate,
  formatDateDayLabel as formatTicketDayLabel,
  formatDateMonthLabel as formatTicketMonthLabel,
};

export type TicketDayGroup = DateDayGroup<SavedTicket>;
export type TicketMonthGroup = DateMonthGroup<SavedTicket>;
export type TicketYearGroup = DateYearGroup<SavedTicket>;

/** All the selections made against one match on a saved slip. */
export interface TicketLegGroup {
  fixtureId: string;
  legs: AccaLeg[];
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

/** Year → month → matchday, each level following the newest-first input. */
export function groupTicketsByDate(tickets: SavedTicket[]): TicketYearGroup[] {
  return groupRowsByDate(sortTicketsNewestFirst(tickets), ticketDateIso);
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
