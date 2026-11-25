import type { Fixture } from '../../src/types/fixtures.ts';
import {
  fetchApiFootball,
  getApiFootballLimits,
} from './apiFootball.ts';
import { createSingleFlight, createTtlCache } from './cache.ts';

/**
 * League-table positions for picked matches.
 *
 * The slate archive stores prices and outcomes, not standings, so positions are
 * fetched once per competition and then frozen onto each fixture alongside the
 * pick. That keeps settled picks readable without another upstream call, and
 * avoids paying for a standings request per match.
 */

const STANDINGS_TTL_MS = 1000 * 60 * 60 * 6;
const LEAGUE_LOOKUP_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const STANDINGS_MAX_GROUPS = 8;
/** Metered plans can cover a whole matchday; free plans stay tightly bounded. */
const STANDINGS_MAX_GROUPS_METERED = 50;
/** Keep enough quota for fixtures, odds, predictions and results. */
const STANDINGS_QUOTA_RESERVE = 4;

export interface RawApiStandingsRow {
  rank?: number;
  team?: { id?: number; name?: string };
  points?: number;
}

export interface RawApiStandingsLeague {
  league?: {
    id?: number;
    season?: number;
    standings?: RawApiStandingsRow[][];
  };
}

export interface RawApiLeague {
  league?: { id?: number; name?: string };
  country?: { name?: string } | string;
  seasons?: Array<{ year?: number; current?: boolean }>;
}

interface LeagueLookup {
  id: number;
  name: string;
  country: string;
  season?: number;
}

function normalizeLeague(raw: RawApiLeague): LeagueLookup | null {
  const id = raw.league?.id;
  if (typeof id !== 'number') return null;
  const country =
    typeof raw.country === 'string'
      ? raw.country
      : (raw.country?.name ?? '');
  return {
    id,
    name: raw.league?.name ?? '',
    country,
    season: raw.seasons?.find((season) => season.current)?.year,
  };
}

export interface LeaguePositionPair {
  home?: number;
  away?: number;
}

type PositionMap = Map<string, number>;
type LeagueRef = { leagueId: number; season?: number } | null;

const standingsCache = createTtlCache<PositionMap | null>(STANDINGS_TTL_MS, 160);
const leagueCache = createTtlCache<LeagueRef>(LEAGUE_LOOKUP_TTL_MS, 240);
const standingsFlight = createSingleFlight<PositionMap | null>();
const leagueFlight = createSingleFlight<LeagueRef>();

export function clearStandingsCache(): void {
  standingsCache.clear();
  leagueCache.clear();
}

function normalizeName(value: string | undefined): string {
  if (!value) return '';
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** API-Football seasons are labelled by their starting year. */
function inferredSeason(dateIso: string): number | undefined {
  const match = /^(\d{4})-(\d{2})/.exec(dateIso);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month >= 7 ? year : year - 1;
}

/** Pure normalizer: one map covers both id-matched and name-matched teams. */
export function mapStandingsByTeam(
  payload: { response?: RawApiStandingsLeague[] }
): PositionMap {
  const byTeam: PositionMap = new Map();

  for (const group of payload.response ?? []) {
    for (const table of group.league?.standings ?? []) {
      for (const row of table) {
        const rank = row.rank;
        if (!Number.isFinite(rank) || (rank ?? 0) <= 0) continue;
        if (row.team?.id !== undefined) byTeam.set(`id:${row.team.id}`, rank ?? 0);
        const name = normalizeName(row.team?.name);
        if (name) byTeam.set(`name:${name}`, rank ?? 0);
      }
    }
  }

  return byTeam;
}

export function positionsFromMap(
  byTeam: PositionMap,
  fixture: Pick<Fixture, 'homeTeam' | 'awayTeam' | 'homeTeamId' | 'awayTeamId'>
): LeaguePositionPair {
  const lookup = (id: number | undefined, name: string): number | undefined => {
    const byId = id !== undefined ? byTeam.get(`id:${id}`) : undefined;
    const byName = byTeam.get(`name:${normalizeName(name)}`);
    return byId ?? byName;
  };

  return {
    home: lookup(fixture.homeTeamId, fixture.homeTeam),
    away: lookup(fixture.awayTeamId, fixture.awayTeam),
  };
}

async function resolveLeagueRef(
  fixture: Fixture
): Promise<LeagueRef> {
  if (fixture.leagueId) {
    return { leagueId: fixture.leagueId, season: fixture.leagueSeason };
  }

  const key = `${normalizeName(fixture.country)}:${normalizeName(fixture.competition)}`;
  const cached = leagueCache.get(key);
  if (cached !== undefined) return cached;

  return leagueFlight.run(key, async () => {
    // API-Football rejects `search` and `country` together, so search first and
    // narrow by country in memory. The response nests ids under `league`.
    const response = await fetchApiFootball<RawApiLeague>('/leagues', {
      search: fixture.competition,
    }).catch(() => null);

    const candidates = (response?.response ?? [])
      .map(normalizeLeague)
      .filter((league): league is LeagueLookup => league !== null);
    const wanted = normalizeName(fixture.competition);
    const country = normalizeName(fixture.country);
    const chosen =
      candidates.find((league) => {
        const name = normalizeName(league.name);
        const sameCountry =
          !country || normalizeName(league.country) === country;
        return (
          sameCountry &&
          (name === wanted || name.includes(wanted) || wanted.includes(name))
        );
      }) ??
      candidates.find(
        (league) => !country || normalizeName(league.country) === country
      ) ??
      candidates[0] ??
      null;

    const ref: LeagueRef = chosen
      ? { leagueId: chosen.id, season: chosen.season }
      : null;
    leagueCache.set(key, ref);
    return ref;
  });
}

async function fetchPositions(
  leagueId: number,
  seasons: number[]
): Promise<PositionMap | null> {
  for (const season of seasons) {
    const key = `${leagueId}:${season}`;
    const cached = standingsCache.get(key);
    if (cached !== undefined) {
      if (cached) return cached;
      continue;
    }

    const positions = await standingsFlight.run(key, async () => {
      const response = await fetchApiFootball<RawApiStandingsLeague>(
        '/standings',
        { league: leagueId, season }
      ).catch(() => null);
      const mapped = response ? mapStandingsByTeam(response) : new Map();
      const result = mapped.size > 0 ? mapped : null;
      standingsCache.set(key, result);
      return result;
    });

    if (positions) return positions;
  }

  return null;
}

function standingsBudget(): number {
  const limits = getApiFootballLimits();
  if (limits?.planHint === 'metered') return STANDINGS_MAX_GROUPS_METERED;
  let budget = STANDINGS_MAX_GROUPS;
  if (
    limits?.planHint === 'free-or-limited' &&
    limits.requestsRemaining !== null
  ) {
    budget = Math.max(
      0,
      Math.min(budget, limits.requestsRemaining - STANDINGS_QUOTA_RESERVE)
    );
  }
  return budget;
}

function groupKey(fixture: Fixture): string {
  if (fixture.leagueId) {
    return `league:${fixture.leagueId}:${fixture.leagueSeason ?? 'auto'}`;
  }
  return `name:${normalizeName(fixture.country)}:${normalizeName(fixture.competition)}`;
}

/**
 * Fetches standings once per competition, picking leagues that contain a
 * recommended leg first when quota is tight. Failures are contained: a fixture
 * simply keeps no position rather than breaking the slate.
 */
export async function enrichWithStandings(
  fixtures: Fixture[],
  pickedFixtureIds: ReadonlySet<string>,
  force = false
): Promise<void> {
  const targets = fixtures.filter(
    (fixture) =>
      fixture.markets.length > 0 &&
      (force ||
        fixture.positionHome === undefined ||
        fixture.positionAway === undefined)
  );
  if (targets.length === 0) return;

  const groups = new Map<string, Fixture[]>();
  for (const fixture of targets) {
    const key = groupKey(fixture);
    const group = groups.get(key);
    if (group) group.push(fixture);
    else groups.set(key, [fixture]);
  }

  const selected = [...groups.entries()]
    .sort(([keyA, groupA], [keyB, groupB]) => {
      const pickedA = groupA.some((fixture) => pickedFixtureIds.has(fixture.id))
        ? 1
        : 0;
      const pickedB = groupB.some((fixture) => pickedFixtureIds.has(fixture.id))
        ? 1
        : 0;
      return pickedB - pickedA || keyA.localeCompare(keyB);
    })
    .slice(0, standingsBudget());
  if (selected.length === 0) return;

  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, selected.length) }, async () => {
      while (cursor < selected.length) {
        const group = selected[cursor++][1];
        const sample = group[0];
        const ref = await resolveLeagueRef(sample);
        if (!ref) continue;

        const inferred = inferredSeason(sample.matchDateIso);
        const seasons = [
          ...new Set(
            [
              ref.season,
              sample.leagueSeason,
              inferred,
              inferred === undefined ? undefined : inferred + 1,
            ].filter(
              (season): season is number =>
                typeof season === 'number' && Number.isFinite(season)
            )
          ),
        ];
        const byTeam = await fetchPositions(ref.leagueId, seasons);
        if (!byTeam) continue;

        const standingsAt = new Date().toISOString();
        for (const fixture of group) {
          const positions = positionsFromMap(byTeam, fixture);
          if (positions.home === undefined && positions.away === undefined) {
            continue;
          }
          fixture.leagueId = fixture.leagueId ?? ref.leagueId;
          fixture.leagueSeason =
            fixture.leagueSeason ?? ref.season ?? seasons[0];
          if (positions.home !== undefined) fixture.positionHome = positions.home;
          if (positions.away !== undefined) fixture.positionAway = positions.away;
          fixture.standingsAt = standingsAt;
        }
      }
    })
  );
}
