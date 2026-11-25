import type { Fixture } from '../types/fixtures.ts';

/**
 * League-table position captured alongside a pick. This is a snapshot from
 * API-Football standings, not a live table or an xG-style model estimate.
 */
export const LEAGUE_POSITION_TITLE =
  'League table position from API-Football standings when this pick was captured.';

/** Human ordinal, with the 11th/12th/13th exception handled explicitly. */
export function fmtOrdinal(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return '—';
  }
  const rank = Math.round(value);
  const lastTwo = rank % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${rank}th`;
  const suffix = rank % 10 === 1 ? 'st' : rank % 10 === 2 ? 'nd' : rank % 10 === 3 ? 'rd' : 'th';
  return `${rank}${suffix}`;
}

/** One display line for both sides, or null when neither has a position. */
export function formatLeaguePosition(
  fixture: Pick<Fixture, 'positionHome' | 'positionAway'>
): string | null {
  const home = fixture.positionHome ?? null;
  const away = fixture.positionAway ?? null;
  const hasHome = typeof home === 'number' && Number.isFinite(home);
  const hasAway = typeof away === 'number' && Number.isFinite(away);
  if (!hasHome && !hasAway) return null;
  return `League position: Home ${fmtOrdinal(home)} / Away ${fmtOrdinal(away)}`;
}
