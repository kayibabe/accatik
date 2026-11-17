import type { Fixture, SavedTicket } from '../types/fixtures.ts';

/**
 * Settlement snapshots: a compact copy of every slate the user has viewed,
 * keyed by ISO date. Saved slips can then be settled (Win/Lost/Void) even
 * when the app is looking at a different matchday, without extra API calls.
 */
export const SNAPSHOT_STORAGE_KEY = 'matchslip_fixture_snapshots_v1';
const MAX_DATES = 8;

export type FixtureSnapshots = Record<string, Fixture[]>;

/** Keeps only the fields settlement needs, so several matchdays fit in localStorage. */
export function snapshotFixtures(fixtures: Fixture[]): Fixture[] {
  return fixtures.map((fixture) => ({
    id: fixture.id,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    competition: fixture.competition,
    country: fixture.country,
    matchDate: fixture.matchDate,
    matchDateIso: fixture.matchDateIso,
    kickoffTime: fixture.kickoffTime,
    kickoffTimestamp: fixture.kickoffTimestamp,
    awaitingResult: fixture.awaitingResult,
    status: fixture.status,
    statusShort: fixture.statusShort,
    statusLong: fixture.statusLong,
    score: fixture.score,
    venue: '',
    formHome: '—',
    formAway: '—',
    tacticalSummary: '',
    recommendedPickId: '',
    hasLiveOdds: false,
    markets: [],
  }));
}

/**
 * Drops the oldest matchdays, but never a date a saved slip still needs to
 * settle. Without this a slip older than the retention window stays Pending
 * forever.
 */
export function pruneSnapshots(
  snapshots: FixtureSnapshots,
  keepDates: Iterable<string> = []
): FixtureSnapshots {
  const dates = Object.keys(snapshots).sort();
  if (dates.length <= MAX_DATES) return snapshots;

  const keep = new Set(keepDates);
  const kept = new Set(dates.filter((date) => keep.has(date)));

  // Fill the remaining slots with the most recent matchdays.
  for (let i = dates.length - 1; i >= 0 && kept.size < MAX_DATES; i--) {
    kept.add(dates[i]);
  }

  const next: FixtureSnapshots = {};
  for (const date of dates) {
    if (kept.has(date)) next[date] = snapshots[date];
  }
  return next;
}

export function withSnapshot(
  snapshots: FixtureSnapshots,
  dateIso: string,
  fixtures: Fixture[],
  keepDates: Iterable<string> = []
): FixtureSnapshots {
  if (!dateIso || fixtures.length === 0) return snapshots;
  return pruneSnapshots(
    { ...snapshots, [dateIso]: snapshotFixtures(fixtures) },
    keepDates
  );
}

export function loadFixtureSnapshots(): FixtureSnapshots {
  try {
    const raw = localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const snapshots: FixtureSnapshots = {};
    for (const [date, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(value)) snapshots[date] = value as Fixture[];
    }
    return snapshots;
  } catch {
    return {};
  }
}

export function persistFixtureSnapshots(
  snapshots: FixtureSnapshots,
  keepDates: Iterable<string> = []
): void {
  let candidate = snapshots;
  const keep = new Set(keepDates);

  for (;;) {
    try {
      localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(candidate));
      return;
    } catch {
      // Quota exceeded: drop a matchday no saved slip depends on, then retry.
      const dates = Object.keys(candidate).sort();
      if (dates.length <= 1) return;
      const victim = dates.find((date) => !keep.has(date)) ?? dates[0];
      const next: FixtureSnapshots = {};
      for (const date of dates) {
        if (date !== victim) next[date] = candidate[date];
      }
      candidate = next;
    }
  }
}

function coversAllLegs(ticket: SavedTicket, pool: Fixture[]): boolean {
  if (ticket.legs.length === 0) return false;
  const ids = new Set(pool.map((fixture) => fixture.id));
  return ticket.legs.every((leg) => ids.has(leg.fixtureId));
}

/**
 * Picks the best available fixture pool for a saved slip: its own matchday
 * snapshot first, then the live slate, then any snapshot that contains all legs
 * (handles slips saved before `dateIso` existed).
 */
export function resolveFixturePool(
  ticket: SavedTicket,
  snapshots: FixtureSnapshots,
  liveFixtures: Fixture[]
): Fixture[] {
  const ownSnapshot = ticket.dateIso ? snapshots[ticket.dateIso] : undefined;
  if (ownSnapshot && ownSnapshot.length > 0) return ownSnapshot;

  if (coversAllLegs(ticket, liveFixtures)) return liveFixtures;

  for (const pool of Object.values(snapshots)) {
    if (coversAllLegs(ticket, pool)) return pool;
  }
  return liveFixtures;
}
