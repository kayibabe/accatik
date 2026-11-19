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

/**
 * How far a fixture has moved through the settlement lifecycle. A result with
 * a score always outranks the same fixture seen earlier without one, so a slip
 * saved pre-kickoff settles as soon as any copy of the fixture is final.
 */
function settlementProgress(fixture: Fixture): number {
  const statusRank: Record<Fixture['status'], number> = {
    Scheduled: 0,
    Live: 1,
    Finished: 2,
    Void: 2,
  };
  const hasScore =
    fixture.score?.home !== null &&
    fixture.score?.home !== undefined &&
    fixture.score?.away !== null &&
    fixture.score?.away !== undefined;
  return (statusRank[fixture.status] ?? 0) * 2 + (hasScore ? 1 : 0);
}

function isMoreAdvanced(candidate: Fixture, current: Fixture): boolean {
  return settlementProgress(candidate) > settlementProgress(current);
}

/** Whichever copy has progressed furthest; ties keep the preferred copy. */
export function pickMoreAdvancedFixture(
  preferred: Fixture | null | undefined,
  candidate: Fixture | null | undefined
): Fixture | null {
  if (!preferred) return candidate ?? null;
  if (!candidate) return preferred;
  return isMoreAdvanced(candidate, preferred) ? candidate : preferred;
}

/**
 * Builds the settlement pool for a slip by merging every copy of its fixtures.
 *
 * Pools are stacked freshest-first (live slate, then the slip's own matchday
 * snapshot, then every other snapshot), and a later copy only replaces an
 * earlier one when it carries a further-advanced result. A stale pre-kickoff
 * snapshot therefore can never override a finished scoreline — or the reverse.
 */
export function resolveSettlementPool(
  ticket: SavedTicket,
  snapshots: FixtureSnapshots,
  liveFixtures: Fixture[]
): Fixture[] {
  const byId = new Map<string, Fixture>();

  const consider = (pool: Fixture[] | undefined) => {
    for (const fixture of pool ?? []) {
      const current = byId.get(fixture.id);
      if (!current || isMoreAdvanced(fixture, current)) byId.set(fixture.id, fixture);
    }
  };

  consider(liveFixtures);
  if (ticket.dateIso) consider(snapshots[ticket.dateIso]);
  for (const [dateIso, pool] of Object.entries(snapshots)) {
    if (dateIso !== ticket.dateIso) consider(pool);
  }

  const legIds = new Set(ticket.legs.map((leg) => leg.fixtureId));
  return [...byId.values()].filter((fixture) => legIds.has(fixture.id));
}

/**
 * Merges freshly fetched results back into the local snapshot archive, so a
 * settled slip stays settled after the next reload instead of reverting to
 * Pending. Results only ever move a fixture forward.
 */
export function mergeFixturesIntoSnapshots(
  snapshots: FixtureSnapshots,
  fixtures: Fixture[],
  keepDates: Iterable<string> = []
): FixtureSnapshots {
  if (fixtures.length === 0) return snapshots;

  const next: FixtureSnapshots = { ...snapshots };
  let changed = false;

  for (const fixture of fixtures) {
    const dateIso = fixture.matchDateIso;
    if (!dateIso) continue;

    const pool = next[dateIso] ? [...next[dateIso]] : [];
    const index = pool.findIndex((existing) => existing.id === fixture.id);

    if (index === -1) {
      pool.push(snapshotFixtures([fixture])[0]);
    } else if (isMoreAdvanced(fixture, pool[index])) {
      pool[index] = { ...pool[index], ...snapshotFixtures([fixture])[0] };
    } else {
      continue;
    }

    next[dateIso] = pool;
    changed = true;
  }

  return changed ? pruneSnapshots(next, keepDates) : snapshots;
}
