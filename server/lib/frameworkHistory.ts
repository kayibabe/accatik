import type { Fixture } from '../../src/types/fixtures.ts';
import type { TeamMatchResult } from '../../src/framework/model.ts';
import { listArchivedSlateDates, readArchivedSlate } from './slateArchive.ts';

/**
 * Point-in-time history for the framework baseline model.
 *
 * The app has no team-statistics feed, so the only honest inputs are finished
 * fixtures in the permanent slate archive: final score, venue and competition.
 * The loader de-duplicates fixtures across archive rewrites and caches the
 * result so a slate request does not re-read every matchday.
 */

const HISTORY_TTL_MS = 10 * 60 * 1000;
/** Enough history for a stable league baseline without unbounded startup cost. */
const MAX_ARCHIVE_DATES = 240;

interface HistoryCache {
  builtAt: number;
  results: TeamMatchResult[];
}

let cache: HistoryCache | null = null;
let inflight: Promise<TeamMatchResult[]> | null = null;

export function frameworkTeamKey(country: string, team: string): string {
  return `${country}::${team.trim().toLowerCase()}`;
}

export function frameworkCompetitionKey(
  country: string,
  competition: string
): string {
  return `${country}::${competition.trim().toLowerCase()}`;
}

export type TeamKeyResolver = (country: string, team: string) => string;

/**
 * Resolves the history key for a team on a fixture.
 *
 * Archived results record a team under its domestic country, but a European
 * or world competition fixture carries `country: "World"`. Keying both sides
 * by the fixture country therefore hid almost every cross-border team from the
 * model. This resolver keeps the exact country key when history has it and
 * otherwise falls back to the team's most frequent domestic history key.
 *
 * Identity only: no result is filtered or synthesised here. Every probability
 * still comes from point-in-time results inside `buildModelInput`.
 */
export function buildTeamKeyResolver(
  history: TeamMatchResult[]
): TeamKeyResolver {
  const byName = new Map<string, Map<string, number>>();
  for (const row of history) {
    const separator = row.teamId.indexOf('::');
    const name = (separator >= 0 ? row.teamId.slice(separator + 2) : row.teamId).toLowerCase();
    const keys = byName.get(name) ?? new Map<string, number>();
    keys.set(row.teamId, (keys.get(row.teamId) ?? 0) + 1);
    byName.set(name, keys);
  }

  return (country: string, team: string): string => {
    const exact = frameworkTeamKey(country, team);
    const candidates = byName.get(team.trim().toLowerCase());
    if (!candidates || candidates.has(exact)) return exact;

    const ranked = [...candidates.entries()].sort((a, b) => b[1] - a[1]);
    const domestic = ranked.filter(([key]) => !key.toLowerCase().startsWith('world::'));
    return (domestic[0] ?? ranked[0])[0];
  };
}

function fixtureDateIso(fixture: Fixture): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(fixture.matchDateIso)) {
    return fixture.matchDateIso;
  }
  if (fixture.kickoffTimestamp) {
    return new Date(fixture.kickoffTimestamp).toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Converts one finished fixture into two team-match rows. A row is only
 * produced when the final score is present: a 0-0 must not be confused with a
 * missing result.
 */
export function resultsFromFinishedFixture(fixture: Fixture): TeamMatchResult[] {
  if (fixture.status !== 'Finished') return [];
  const homeGoals = fixture.score?.home;
  const awayGoals = fixture.score?.away;
  if (typeof homeGoals !== 'number' || typeof awayGoals !== 'number') return [];

  const dateIso = fixtureDateIso(fixture);
  if (!dateIso) return [];

  const homeTeamId = frameworkTeamKey(fixture.country, fixture.homeTeam);
  const awayTeamId = frameworkTeamKey(fixture.country, fixture.awayTeam);
  const competitionId = frameworkCompetitionKey(
    fixture.country,
    fixture.competition
  );

  return [
    {
      fixtureId: fixture.id,
      teamId: homeTeamId,
      opponentId: awayTeamId,
      goalsFor: homeGoals,
      goalsAgainst: awayGoals,
      home: true,
      dateIso,
      competitionId,
    },
    {
      fixtureId: fixture.id,
      teamId: awayTeamId,
      opponentId: homeTeamId,
      goalsFor: awayGoals,
      goalsAgainst: homeGoals,
      home: false,
      dateIso,
      competitionId,
    },
  ];
}

/** Reads every archived matchday and returns one de-duplicated result stream. */
export async function loadFrameworkHistory(): Promise<TeamMatchResult[]> {
  const dates = await listArchivedSlateDates();
  const seen = new Set<string>();
  const results: TeamMatchResult[] = [];

  for (const dateIso of dates.slice(0, MAX_ARCHIVE_DATES)) {
    const slate = await readArchivedSlate(dateIso);
    if (!slate) continue;
    for (const fixture of slate.fixtures) {
      for (const result of resultsFromFinishedFixture(fixture)) {
        const key = `${result.fixtureId ?? result.dateIso}:${result.teamId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(result);
      }
    }
  }

  results.sort((a, b) => a.dateIso.localeCompare(b.dateIso));
  return results;
}

/** Cached history snapshot. Concurrent callers share one archive scan. */
export async function getFrameworkHistory(
  nowMs: number = Date.now()
): Promise<TeamMatchResult[]> {
  if (cache && nowMs - cache.builtAt < HISTORY_TTL_MS) return cache.results;
  if (!inflight) {
    inflight = loadFrameworkHistory()
      .then((results) => {
        cache = { builtAt: Date.now(), results };
        return results;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Test hook: the next read rebuilds from the archive. */
export function clearFrameworkHistoryCache(): void {
  cache = null;
}
