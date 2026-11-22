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
