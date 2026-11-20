import { performance } from 'node:perf_hooks';
import type {
  DailySlateResponse,
  DeepAnalysisResponse,
  Fixture,
  GroundingSource,
  PickRecordsResponse,
  PublicFixture,
  PublicSlateResponse,
  RecommendedPickRef,
  ServerTimings,
  SettlementStatus,
} from '../src/types/fixtures.ts';
import type { LedgerSummary, LedgerTicket } from '../src/types/ledger.ts';
import { buildRecommendedAcca } from '../src/utils/accaEngine.ts';
import {
  MAX_RECOMMENDED_LEGS,
  guardTicket,
} from '../src/utils/ticketGuard.ts';
import { describeStrategy, isAccaStrategy } from '../src/utils/strategy.ts';
import { resolveAnalystNoteMarket } from '../src/utils/analystNote.ts';
import { computePickRecords } from './lib/pickRecord.ts';
import {
  applySlateToLedger,
  getLedgerSummary,
  listLedgerTickets,
  settleLedgerFromArchives,
} from './lib/ticketLedger.ts';
import type {
  RawApiFixture,
  RawApiInjury,
  RawApiOddsItem,
  RawApiPrediction,
} from './lib/apiFootball.ts';
import {
  fetchApiFootball,
  getApiFootballLimits,
  resolveApiFootballBaseUrl,
  resolveApiFootballKey,
} from './lib/apiFootball.ts';
import { createSingleFlight, createTtlCache } from './lib/cache.ts';
import {
  isSlateSettled,
  mergeArchivedPrices,
  readArchivedSlate,
  writeArchivedSlate,
  type ArchivedSlate,
} from './lib/slateArchive.ts';
import {
  isAwaitingFeedResult,
  mapFixtureStatus,
  sortRawFixtures,
  toFixture,
} from './lib/markets.ts';
import { CAT_TIMEZONE, formatDisplayDate, getTodayIsoDate } from './lib/time.ts';

/**
 * Framework-agnostic API handlers.
 *
 * Both the Express server and the Appwrite Function call these functions, so a
 * route can never drift between local development and the deployed backend.
 */
export interface ApiResult<T = unknown> {
  status: number;
  body: T;
}

interface ErrorBody {
  error: string;
}

/** Short browser lifetime; the JS client map and durable archive do the heavy lifting. */
export const SLATE_CACHE_CONTROL = 'private, max-age=60, stale-while-revalidate=300';
export const PUBLIC_SLATE_CACHE_CONTROL =
  'public, max-age=60, stale-while-revalidate=300';

const SLATE_TTL_MS = 1000 * 60 * 5;
/** How old an archived slate may be before a background refresh is worthwhile. */
const ARCHIVE_FRESH_MS = 1000 * 60 * 5;
const ARCHIVE_REFRESH_COOLDOWN_MS = 1000 * 60 * 2;
/** Ledger bookkeeping is cheap to skip and expensive to repeat per request. */
const LEDGER_REFRESH_INTERVAL_MS = 1000 * 60 * 5;
const PREDICTION_TTL_MS = 1000 * 60 * 30;
const ANALYSIS_TTL_MS = 1000 * 60 * 10;
const FIXTURE_INDEX_TTL_MS = 1000 * 60 * 60 * 6;
const RESULT_TTL_MS = 1000 * 60;

/** Defaults chosen from the clean-sample replay, not from the old 5.00+ habit. */
export const DEFAULT_TARGET_ODDS = 2.8;
export const DEFAULT_MAX_LEGS = 3;
export const MIN_TARGET_ODDS = 1.5;
export const MAX_TARGET_ODDS = 100;
export const MAX_LEG_LIMIT = 8;

interface LoadedSlate {
  fixtures: Fixture[];
  capturedAt: string;
  source: 'live' | 'archive';
  /** Only the request that rebuilt the slate needs to write the archive. */
  needsArchive?: boolean;
  /** Measured inside getSlate, before per-request prediction enrichment. */
  timings?: Pick<ServerTimings, 'archiveReadMs' | 'buildMs'>;
}

const emptyTimings = (): ServerTimings => ({
  archiveReadMs: 0,
  buildMs: 0,
  predictionsMs: 0,
  persistMs: 0,
  ledgerMs: 0,
  totalMs: 0,
});

const ms = (value: number): string => `${value.toFixed(1)}ms`;

/** One structured line per phase snapshot, easy to grep in Appwrite logs. */
function logSlateTimings(
  dateIso: string,
  source: string,
  timings: ServerTimings,
  phase: 'response' | 'background'
): void {
  console.log(
    `[slate timings] ${phase} date=${dateIso} source=${source} ` +
      `archiveRead=${ms(timings.archiveReadMs)} build=${ms(timings.buildMs)} ` +
      `predictions=${ms(timings.predictionsMs)} persist=${ms(timings.persistMs)} ` +
      `ledger=${ms(timings.ledgerMs)} total=${ms(timings.totalMs)}`
  );
}

/** Marks the response boundary and emits the blocking-phase log line. */
function finalizeTimings(
  dateIso: string,
  source: string,
  timings: ServerTimings,
  started: number
): ServerTimings {
  timings.totalMs = performance.now() - started;
  logSlateTimings(dateIso, source, timings, 'response');
  return timings;
}

/**
 * Bookkeeping must never hold the response open. Errors are already contained
 * inside persistSlate / refreshLedgerForSlate, but keep a final guard so a
 * future change cannot turn background work into an unhandled rejection.
 */
function scheduleBackground(label: string, task: Promise<void>): void {
  void task.catch((error) => {
    console.warn(`[slate] background ${label} failed`, error);
  });
}

const slateCache = createTtlCache<LoadedSlate>(SLATE_TTL_MS, 60);
const resultCache = createTtlCache<Fixture>(RESULT_TTL_MS, 2000);
const predictionCache = createTtlCache<RawApiPrediction | null>(
  PREDICTION_TTL_MS,
  400
);
const analysisCache = createTtlCache<DeepAnalysisResponse>(ANALYSIS_TTL_MS, 200);
const fixtureIndex = createTtlCache<{
  homeTeam: string;
  awayTeam: string;
  competition: string;
}>(FIXTURE_INDEX_TTL_MS, 4000);

const slateFlight = createSingleFlight<LoadedSlate>();
const archiveFlight = createSingleFlight<void>();
const ledgerFlight = createSingleFlight<void>();
const predictionFlight = createSingleFlight<RawApiPrediction | null>();

/** Per-date markers so a burst of slate requests runs bookkeeping at most once. */
const lastLedgerRefreshAt = new Map<string, number>();
const lastArchiveRefreshAt = new Map<string, number>();

/**
 * Ledger upkeep is a single read/write pass, time-gated to one run per date per
 * interval. A failed pass leaves the marker unset so the next request retries.
 */
async function refreshLedgerForSlate(
  dateIso: string,
  fixtures: Fixture[]
): Promise<void> {
  const now = Date.now();
  if (
    now - (lastLedgerRefreshAt.get(dateIso) ?? Number.NEGATIVE_INFINITY) <
    LEDGER_REFRESH_INTERVAL_MS
  ) {
    return;
  }

  await ledgerFlight.run(dateIso, async () => {
    try {
      await applySlateToLedger(dateIso, fixtures, now);
      lastLedgerRefreshAt.set(dateIso, Date.now());
    } catch (error) {
      console.warn(`[ledger] could not refresh bookkeeping for ${dateIso}`, error);
    }
  });
}

/** Writes a freshly built slate exactly once, after any per-request enrichment. */
async function persistSlate(dateIso: string, slate: LoadedSlate): Promise<void> {
  if (!slate.needsArchive) return;
  await archiveFlight.run(dateIso, async () => {
    try {
      await writeArchivedSlate({
        dateIso,
        capturedAt: slate.capturedAt,
        updatedAt: new Date().toISOString(),
        fixtures: slate.fixtures,
      });
    } catch (error) {
      // A read-only archive must not take the app down.
      console.warn(`[slate] could not archive ${dateIso}`, error);
    }
  });
}

/** Overlays fresh results without touching the archived prices or picks. */
function overlayResults(archived: Fixture[], fresh: Fixture[]): Fixture[] {
  const byId = new Map(fresh.map((fixture) => [fixture.id, fixture]));
  return archived.map((fixture) => {
    const update = byId.get(fixture.id);
    if (!update) return fixture;
    return {
      ...fixture,
      status: update.status,
      statusShort: update.statusShort,
      statusLong: update.statusLong,
      awaitingResult: update.awaitingResult,
      score: update.score,
    };
  });
}

/**
 * A past matchday is never rebuilt from `/fixtures?date=`. Only its results can
 * change, so a bounded `/fixtures?ids=` merge is enough to keep the archive
 * current while preserving the exact book the user was shown.
 */
async function refreshArchivedResults(
  dateIso: string,
  archived: ArchivedSlate
): Promise<void> {
  const ids = archived.fixtures
    .map((fixture) => fixture.id)
    .filter((id) => /^\d+$/.test(id));
  const fresh: Fixture[] = [];

  for (let offset = 0; offset < ids.length; offset += 20) {
    const response = await fetchApiFootball<RawApiFixture>('/fixtures', {
      ids: ids.slice(offset, offset + 20).join('-'),
    });
    const nowMs = Date.now();
    for (const raw of response.response ?? []) {
      fresh.push(toFixture(raw, undefined, dateIso, nowMs));
    }
  }

  const fixtures = overlayResults(archived.fixtures, fresh);
  await writeArchivedSlate({
    dateIso,
    capturedAt: archived.capturedAt,
    updatedAt: new Date().toISOString(),
    fixtures,
  });
  indexFixtures(fixtures);
  slateCache.set(dateIso, {
    fixtures,
    capturedAt: archived.capturedAt,
    source: 'archive',
  });
}

/**
 * Serves happen first; the refresh is deliberately fire-and-forget. If a
 * serverless runtime freezes the container before it finishes, the next visit
 * simply tries again — correctness never depends on the background work.
 */
function scheduleArchiveRefresh(dateIso: string, archived: ArchivedSlate): void {
  const now = Date.now();
  const updatedAt = Date.parse(archived.updatedAt);
  if (!Number.isFinite(updatedAt) || now - updatedAt < ARCHIVE_FRESH_MS) return;
  if (isSlateSettled(archived.fixtures, now)) return;
  if (now - (lastArchiveRefreshAt.get(dateIso) ?? 0) < ARCHIVE_REFRESH_COOLDOWN_MS) {
    return;
  }

  lastArchiveRefreshAt.set(dateIso, now);
  void archiveFlight.run(dateIso, async () => {
    try {
      await refreshArchivedResults(dateIso, archived);
    } catch (error) {
      console.warn(`[slate] background refresh failed for ${dateIso}`, error);
    }
  });
}

const MISSING_KEY_MESSAGE =
  'API_FOOTBALL_KEY is not configured. Please add your API-Football Pro key as API_FOOTBALL_KEY in Settings > Secrets.';

const ok = <T>(body: T): ApiResult<T> => ({ status: 200, body });
const fail = (status: number, error: string): ApiResult<ErrorBody> => ({
  status,
  body: { error },
});

function missingApiKey(): ApiResult<ErrorBody> | null {
  if (resolveApiFootballKey()) return null;
  return fail(400, MISSING_KEY_MESSAGE);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** Which API-Football host requests will hit, without leaking the full URL. */
function apiFootballHostLabel(): string {
  try {
    const custom = resolveApiFootballBaseUrl();
    if (!custom) return 'default';
    return new URL(custom).host;
  } catch {
    return 'invalid';
  }
}

/**
 * Clamps the combined-odds target into a sane pre-match range. The old
 * `>= 5` floor made every request a lottery ticket even when the client asked
 * for a shorter slip.
 */
export function parseTargetOdds(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_TARGET_ODDS;
  return Math.min(
    Math.max(Math.round(parsed * 100) / 100, MIN_TARGET_ODDS),
    MAX_TARGET_ODDS
  );
}

/** Accepts a leg budget of 1–8 and falls back to the balanced 3-leg shape. */
export function parseMaxLegs(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_LEGS;
  return Math.min(Math.max(Math.round(parsed), 1), MAX_LEG_LIMIT);
}

function cleanLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 80) : fallback;
}

/** API-Football quotes model percentages as strings ("45%"). */
function parsePercent(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number.parseFloat(String(value).replace('%', ''));
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

async function fetchOddsForDate(
  dateIso: string
): Promise<Map<number, RawApiOddsItem>> {
  const oddsByFixtureId = new Map<number, RawApiOddsItem>();

  const firstPage = await fetchApiFootball<RawApiOddsItem>('/odds', {
    date: dateIso,
    page: 1,
  }).catch(() => ({ paging: { total: 1 }, response: [] as RawApiOddsItem[] }));

  for (const item of firstPage.response ?? []) {
    if (item.fixture?.id) oddsByFixtureId.set(item.fixture.id, item);
  }

  const totalPages = Math.min(firstPage.paging?.total ?? 1, 10);
  if (totalPages > 1) {
    const pages = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, idx) =>
        fetchApiFootball<RawApiOddsItem>('/odds', {
          date: dateIso,
          page: idx + 2,
        }).catch(() => ({ response: [] as RawApiOddsItem[] }))
      )
    );
    for (const page of pages) {
      for (const item of page.response ?? []) {
        if (item.fixture?.id) oddsByFixtureId.set(item.fixture.id, item);
      }
    }
  }

  return oddsByFixtureId;
}

/**
 * The date-wide odds feed only covers so many pages; fill in the highest-value
 * fixtures that are still unpriced with a targeted /odds?fixture= call.
 */
async function enrichMissingOdds(
  rawFixtures: RawApiFixture[],
  oddsByFixtureId: Map<number, RawApiOddsItem>,
  nowMs: number
): Promise<void> {
  const missing = rawFixtures
    .filter((raw) => {
      if (oddsByFixtureId.has(raw.fixture.id)) return false;
      const status = mapFixtureStatus(raw.fixture?.status?.short);
      const kickoffTs = raw.fixture?.timestamp
        ? raw.fixture.timestamp * 1000
        : undefined;
      const awaiting = isAwaitingFeedResult(status, kickoffTs, nowMs);
      if (status === 'Scheduled' && !awaiting) return true;
      return status === 'Live' || status === 'Finished';
    })
    .slice(0, 10);

  if (missing.length === 0) return;

  const responses = await Promise.all(
    missing.map((raw) =>
      fetchApiFootball<RawApiOddsItem>('/odds', {
        fixture: raw.fixture.id,
      }).catch(() => ({ response: [] as RawApiOddsItem[] }))
    )
  );

  for (const response of responses) {
    for (const item of response.response ?? []) {
      if (item.fixture?.id) oddsByFixtureId.set(item.fixture.id, item);
    }
  }
}

async function buildSlate(dateIso: string): Promise<Fixture[]> {
  const [fixturesResp, oddsByFixtureId] = await Promise.all([
    fetchApiFootball<RawApiFixture>('/fixtures', {
      date: dateIso,
      timezone: CAT_TIMEZONE,
    }),
    fetchOddsForDate(dateIso),
  ]);

  const rawFixtures = fixturesResp.response ?? [];
  if (rawFixtures.length === 0) {
    throw new Error(
      `No football matches found on API-Football for ${formatDisplayDate(
        dateIso
      )} (${dateIso}).`
    );
  }

  const nowMs = Date.now();
  await enrichMissingOdds(rawFixtures, oddsByFixtureId, nowMs);

  const pricedIds = new Set(oddsByFixtureId.keys());
  const fixtures = sortRawFixtures(rawFixtures, pricedIds, nowMs).map((raw) =>
    toFixture(raw, oddsByFixtureId.get(raw.fixture.id), dateIso, nowMs)
  );

  indexFixtures(fixtures);
  return fixtures;
}

/** Remembers team names so /analyze works even for archived matchdays. */
function indexFixtures(fixtures: Fixture[]): void {
  for (const fixture of fixtures) {
    fixtureIndex.set(fixture.id, {
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      competition: fixture.competition,
    });
  }
}

/**
 * Cache → archive → API, in that order.
 *
 * - A settled matchday is served from disk and never costs another API call.
 * - A requested-but-unsettled matchday refreshes results, but prices already
 *   archived for a kicked-off fixture are preserved.
 * - If the API fails, an archived slate is served instead of an error page.
 */
async function getSlate(dateIso: string, force = false): Promise<LoadedSlate> {
  if (!force) {
    const cached = slateCache.get(dateIso);
    if (cached) return cached;
  }

  return slateFlight.run(`${dateIso}:${force ? 'force' : 'normal'}`, async () => {
    const archiveStart = performance.now();
    const archived = await readArchivedSlate(dateIso);
    const archiveReadMs = performance.now() - archiveStart;
    const nowMs = Date.now();

    // Stale-while-revalidate: a saved matchday is served immediately. A stale
    // one also schedules a cheap results-only refresh for the next visit.
    // `forceRefresh` is the only path that pays for a full rebuild.
    if (archived && !force) {
      indexFixtures(archived.fixtures);
      const served: LoadedSlate = {
        fixtures: archived.fixtures,
        capturedAt: archived.capturedAt,
        source: 'archive',
        timings: { archiveReadMs, buildMs: 0 },
      };
      slateCache.set(dateIso, served);
      if (!isSlateSettled(archived.fixtures, nowMs)) {
        scheduleArchiveRefresh(dateIso, archived);
      }
      return served;
    }

    let fixtures: Fixture[];
    let buildMs = 0;
    try {
      const buildStart = performance.now();
      const fresh = await buildSlate(dateIso);
      buildMs = performance.now() - buildStart;
      fixtures = archived
        ? mergeArchivedPrices(archived.fixtures, fresh)
        : fresh;
    } catch (error) {
      if (!archived) throw error;
      console.warn(
        `[slate] API-Football failed for ${dateIso}; serving the archive instead.`,
        error
      );
      indexFixtures(archived.fixtures);
      const fallback: LoadedSlate = {
        fixtures: archived.fixtures,
        capturedAt: archived.capturedAt,
        source: 'archive',
        timings: { archiveReadMs, buildMs },
      };
      slateCache.set(dateIso, fallback);
      return fallback;
    }

    const capturedAt = archived?.capturedAt ?? new Date().toISOString();
    const pricedAt = new Date().toISOString();
    for (const fixture of fixtures) {
      // Scheduled prices keep moving; kicked-off prices are frozen with the
      // timestamp that belongs to them.
      if (
        fixture.markets.length > 0 &&
        (!fixture.pricedAt || fixture.status === 'Scheduled')
      ) {
        fixture.pricedAt = pricedAt;
      }
    }

    indexFixtures(fixtures);

    // The caller persists after per-request enrichment, so the archive is
    // written once with the same fixtures the user actually received.
    const loaded: LoadedSlate = {
      fixtures,
      capturedAt,
      source: 'live',
      needsArchive: true,
      timings: { archiveReadMs, buildMs },
    };
    slateCache.set(dateIso, loaded);
    return loaded;
  });
}

async function fetchPrediction(fixtureId: string): Promise<RawApiPrediction | null> {
  const cached = predictionCache.get(fixtureId);
  if (cached !== undefined) return cached;

  return predictionFlight.run(fixtureId, async () => {
    const response = await fetchApiFootball<RawApiPrediction>('/predictions', {
      fixture: fixtureId,
    }).catch(() => null);

    const prediction = response?.response?.[0] ?? null;
    predictionCache.set(fixtureId, prediction);
    return prediction;
  });
}

/**
 * A fixture carrying `modelDataAt` already has the model snapshot persisted in
 * the archive, so a date change can reuse it instead of paying for another
 * upstream `/predictions` call. Explicit refresh is the only reason to refetch.
 */
export function needsPredictionRefresh(
  fixture: Fixture | undefined,
  force: boolean
): boolean {
  if (!fixture) return false;
  return force || !fixture.modelDataAt;
}

/**
 * The analyst note now ships with every priced fixture, not just the three
 * ticket legs. Bound the first-visit cost so a large slate cannot drain the
 * API-Football quota in one request; `modelDataAt` makes later visits free.
 */
const PREDICTION_ENRICH_LIMIT = 40;
/** Requests held back for the schedule, results and the on-demand brief. */
const PREDICTION_QUOTA_RESERVE = 6;

function predictionTargetIds(fixtures: Fixture[]): string[] {
  const priced = fixtures.filter((fixture) => fixture.markets.length > 0);
  const limits = getApiFootballLimits();
  let budget = PREDICTION_ENRICH_LIMIT;
  if (
    limits?.planHint === 'free-or-limited' &&
    limits.requestsRemaining !== null
  ) {
    budget = Math.max(
      0,
      Math.min(budget, limits.requestsRemaining - PREDICTION_QUOTA_RESERVE)
    );
  }
  return priced.slice(0, budget).map((fixture) => fixture.id);
}

/**
 * Attaches form, model advice and the analyst note to the requested fixtures.
 * Works on the per-request fixture copies so the cached slate is never mutated.
 * Returns the time spent
 * waiting on the prediction feed (0 when the durable archive was enough).
 */
async function enrichWithPredictions(
  fixtures: Fixture[],
  fixtureIds: string[],
  force = false
): Promise<number> {
  const started = performance.now();
  const uniqueIds = [...new Set(fixtureIds)];
  if (uniqueIds.length === 0) return 0;

  const pendingIds = uniqueIds.filter((fixtureId) =>
    needsPredictionRefresh(
      fixtures.find((fixture) => fixture.id === fixtureId),
      force
    )
  );
  if (pendingIds.length === 0) return 0;

  // Bound the fan-out: a full slate must not fire 40 simultaneous upstream
  // calls, which would trip API-Football's burst limits even on a large plan.
  const predictions: Array<{
    fixtureId: string;
    data: RawApiPrediction | null;
  }> = [];
  let cursor = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(8, pendingIds.length) },
      async () => {
        while (cursor < pendingIds.length) {
          const fixtureId = pendingIds[cursor++];
          predictions.push({
            fixtureId,
            data: await fetchPrediction(fixtureId),
          });
        }
      }
    )
  );

  for (const { fixtureId, data } of predictions) {
    const target = fixtures.find((fixture) => fixture.id === fixtureId);
    if (!target) continue;

    // Mark the attempt even when the provider returned nothing; otherwise a
    // permanently unavailable prediction would be re-requested on every visit.
    target.modelDataAt = new Date().toISOString();
    if (!data) continue;

    const homeForm = data.teams?.home?.league?.form?.slice(-5);
    const awayForm = data.teams?.away?.league?.form?.slice(-5);
    if (homeForm) target.formHome = homeForm.split('').join('-');
    if (awayForm) target.formAway = awayForm.split('').join('-');

    const advice = data.predictions?.advice;
    const pct = data.predictions?.percent;

    // Kept in their own fields: overwriting `tacticalSummary` made the seven
    // ticket fixtures read differently from the rest of the board.
    if (advice) {
      target.modelAdvice = advice;
      target.analystNoteMarketId = resolveAnalystNoteMarket(target, advice)?.id;
    }
    if (pct) {
      target.modelProbabilities = {
        home: parsePercent(pct.home),
        draw: parsePercent(pct.draw),
        away: parsePercent(pct.away),
      };
    }
  }

  return performance.now() - started;
}

const SOURCE_LINKS = (dateIso: string): GroundingSource[] => [
  {
    title: `API-Football Pro v3 — Fixtures Schedule (${dateIso})`,
    uri: 'https://www.api-football.com/documentation-v3#tag/Fixtures',
  },
  {
    title: `API-Football Pro v3 — Pre-Match Bookmaker Odds (${dateIso})`,
    uri: 'https://www.api-football.com/documentation-v3#tag/Odds-(Pre-Match)',
  },
  {
    title: 'API-Football Pro v3 — Match Predictions & Form Comparison',
    uri: 'https://www.api-football.com/documentation-v3#tag/Predictions',
  },
];

export function getHealth(): ApiResult<{
  ok: boolean;
  date: string;
  hasApiFootballKey: boolean;
  apiFootballHost: string;
  rateLimitPerMinute: number;
  /** Last quota snapshot observed on an upstream response, if any. */
  apiFootballLimits: ReturnType<typeof getApiFootballLimits>;
}> {
  return ok({
    ok: true,
    date: getTodayIsoDate(),
    hasApiFootballKey: Boolean(resolveApiFootballKey()),
    apiFootballHost: apiFootballHostLabel(),
    rateLimitPerMinute: Number(process.env.API_RATE_LIMIT_PER_MIN) || 60,
    apiFootballLimits: getApiFootballLimits(),
  });
}

/**
 * Projects a full fixture onto the guest-safe shape. Use this for every public
 * payload: adding a field here is an explicit decision, never a spread of the
 * internal fixture.
 */
export function toPublicFixture(fixture: Fixture): PublicFixture {
  return {
    id: fixture.id,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    competition: fixture.competition,
    country: fixture.country,
    matchDate: fixture.matchDate,
    kickoffTime: fixture.kickoffTime,
    status: fixture.status,
  };
}

/**
 * Guest-facing match list for the landing page. The full slate is still loaded
 * through the shared cache/archive path, but prices, recommended picks,
 * rationales and model output never cross the wire to an unauthenticated user.
 */
export async function getPublicTodayFixtures(): Promise<
  ApiResult<PublicSlateResponse | ErrorBody>
> {
  const missing = missingApiKey();
  if (missing) return missing;

  const started = performance.now();
  const timings = emptyTimings();

  try {
    const dateIso = getTodayIsoDate();
    const loaded = await getSlate(dateIso);
    if (loaded.timings) Object.assign(timings, loaded.timings);

    // Archive writes are bookkeeping, not a precondition for serving the list.
    if (loaded.needsArchive) {
      const persistStart = performance.now();
      scheduleBackground(
        'persist',
        persistSlate(dateIso, loaded).then(() => {
          timings.persistMs = performance.now() - persistStart;
          logSlateTimings(dateIso, loaded.source, timings, 'background');
        })
      );
    }

    return ok({
      date: dateIso,
      displayDate: formatDisplayDate(dateIso),
      timezoneLabel: 'CAT (GMT+2) Kickoff Times',
      fixtures: loaded.fixtures.map(toPublicFixture),
      cachedAt: new Date().toISOString(),
      serverTimings: finalizeTimings(dateIso, loaded.source, timings, started),
    });
  } catch (error) {
    console.error('Error fetching public match list:', error);
    return fail(500, errorMessage(error, 'Failed to load today’s matches.'));
  }
}

export async function getTodayFixtures(
  body: unknown
): Promise<ApiResult<DailySlateResponse | ErrorBody>> {
  const missing = missingApiKey();
  if (missing) return missing;

  const started = performance.now();
  const timings = emptyTimings();

  try {
    const source =
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};

    const requestedDate =
      typeof source.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(source.date)
        ? source.date
        : getTodayIsoDate();

    const minOdds = parseTargetOdds(source.minOdds);
    const maxLegs = parseMaxLegs(source.maxLegs);

    const strategy = isAccaStrategy(source.strategy)
      ? source.strategy
      : 'balanced';

    const forceRefresh = Boolean(source.forceRefresh);
    if (forceRefresh) {
      slateCache.delete(requestedDate);
      lastLedgerRefreshAt.delete(requestedDate);
      lastArchiveRefreshAt.delete(requestedDate);
      // An explicit refresh pays the full upstream cost, including fresh
      // predictions and results rather than the TTL-cached copies.
      predictionCache.clear();
      resultCache.clear();
    }

    const loaded = await getSlate(requestedDate, forceRefresh);
    if (loaded.timings) Object.assign(timings, loaded.timings);
    // Shallow copies: prediction enrichment writes to these, not to the cache.
    const fixtures = loaded.fixtures.map((fixture) => ({ ...fixture }));

    const rawLegs = buildRecommendedAcca(fixtures, minOdds, strategy, maxLegs);
    // Structural gate: the headline ticket is capped at three legs (two when
    // the average price is ultra-short) and is never labelled recommended when
    // the de-vigged chance sits below the price's break-even rate.
    const guard = guardTicket(rawLegs, {
      maxLegs: Math.min(maxLegs, MAX_RECOMMENDED_LEGS),
    });
    const legs = guard.legs;

    // Sealed matchdays skip the prediction feed entirely: the match is over.
    // A stale archive served by SWR reuses the model data captured with it.
    const hadModelData = fixtures.map((fixture) => Boolean(fixture.modelDataAt));
    if (!isSlateSettled(fixtures, Date.now())) {
      timings.predictionsMs = await enrichWithPredictions(
        fixtures,
        predictionTargetIds(fixtures),
        forceRefresh
      );
    }
    // An archive hit can still gain model data. Persist those markers so the
    // next visit (or a fresh server process) reuses them instead of paying for
    // another upstream /predictions call.
    const needsModelPersist = fixtures.some(
      (fixture, index) => fixture.modelDataAt && !hadModelData[index]
    );
    // Keep the in-memory cache in step with the durable copy so a burst of
    // requests does not re-enter the prediction path before the archive write.
    loaded.fixtures = fixtures;

    // Bookkeeping is deliberately not awaited: the slate is served as soon as
    // predictions are attached. Both helpers swallow their own errors, and
    // scheduleBackground is a final guard against an unhandled rejection.
    const bookkeeping: Promise<void>[] = [];
    if (loaded.needsArchive || needsModelPersist) {
      const persistStart = performance.now();
      bookkeeping.push(
        persistSlate(requestedDate, {
          ...loaded,
          fixtures,
          needsArchive: true,
        }).then(() => {
          timings.persistMs = performance.now() - persistStart;
        })
      );
    }

    // Closing prices, settlement and shadow recording share one ledger pass,
    // time-gated so repeated slate requests do not pay for it again.
    const ledgerStart = performance.now();
    bookkeeping.push(
      refreshLedgerForSlate(requestedDate, fixtures).then(() => {
        timings.ledgerMs = performance.now() - ledgerStart;
      })
    );
    scheduleBackground(
      'bookkeeping',
      Promise.all(bookkeeping).then(() => {
        logSlateTimings(requestedDate, loaded.source, timings, 'background');
      })
    );

    const recommendedLegIds: RecommendedPickRef[] = legs.map((leg) => ({
      fixtureId: leg.fixtureId,
      marketId: leg.marketId,
    }));

    const strategyCopy = describeStrategy(strategy, minOdds);

    return ok({
      date: requestedDate,
      displayDate: formatDisplayDate(requestedDate),
      timezoneLabel: 'CAT (GMT+2) Kickoff Times',
      dataProvider: 'API-Football Pro',
      strategy,
      minOdds,
      strategyName: strategyCopy.title,
      strategySummary: strategyCopy.summary,
      fixtures,
      recommendedLegIds,
      ticketGuard: {
        recommended: guard.recommended,
        reason: guard.reason,
        originalLegCount: guard.originalLegCount,
        trimmedCount: guard.trimmedCount,
        economics: guard.economics,
      },
      sources: SOURCE_LINKS(requestedDate),
      cachedAt: new Date().toISOString(),
      slateSource: loaded.source,
      capturedAt: loaded.capturedAt,
      serverTimings: finalizeTimings(requestedDate, loaded.source, timings, started),
    });
  } catch (error) {
    console.error('Error fetching today fixtures:', error);
    return fail(
      500,
      errorMessage(error, 'Failed to load today’s fixtures.')
    );
  }
}

export interface PrewarmResult {
  dateIso: string;
  source: 'live' | 'archive';
  fixtureCount: number;
  /** False when an existing archive already had everything needed. */
  archived: boolean;
  serverTimings: ServerTimings;
}

/**
 * Scheduled-entrypoint work: build (or reuse) a matchday, attach model advice
 * and analyst notes for its priced fixtures, then write to the archive with an awaited
 * persist, so the first user request of the day is a pure archive read.
 */
export async function prewarmSlate(
  dateIso?: string
): Promise<ApiResult<PrewarmResult | ErrorBody>> {
  const missing = missingApiKey();
  if (missing) return missing;

  const started = performance.now();
  const timings = emptyTimings();
  const target =
    typeof dateIso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateIso)
      ? dateIso
      : getTodayIsoDate();

  try {
    const loaded = await getSlate(target);
    if (loaded.timings) Object.assign(timings, loaded.timings);
    const fixtures = loaded.fixtures.map((fixture) => ({ ...fixture }));

    const hadModelData = fixtures.map((fixture) => Boolean(fixture.modelDataAt));
    if (!isSlateSettled(fixtures, Date.now())) {
      timings.predictionsMs = await enrichWithPredictions(
        fixtures,
        predictionTargetIds(fixtures)
      );
    }
    const needsModelPersist = fixtures.some(
      (fixture, index) => fixture.modelDataAt && !hadModelData[index]
    );
    loaded.fixtures = fixtures;

    if (loaded.needsArchive || needsModelPersist) {
      const persistStart = performance.now();
      await persistSlate(target, {
        ...loaded,
        fixtures,
        needsArchive: true,
      });
      timings.persistMs = performance.now() - persistStart;
    }

    return ok({
      dateIso: target,
      source: loaded.source,
      fixtureCount: fixtures.length,
      archived: loaded.needsArchive === true || needsModelPersist,
      serverTimings: finalizeTimings(target, loaded.source, timings, started),
    });
  } catch (error) {
    console.error(`[prewarm] failed for ${target}`, error);
    return fail(500, errorMessage(error, 'Failed to pre-warm the slate.'));
  }
}

/**
 * Explicit, bounded list of fixture IDs from the client. API-Football accepts
 * at most 20 IDs per `/fixtures?ids=` call, so anything past that is dropped
 * rather than silently failing upstream.
 */
export function parseResultFixtureIds(value: unknown, max = 20): string[] {
  if (!Array.isArray(value)) return [];

  const ids = new Set<string>();
  for (const item of value) {
    const id =
      typeof item === 'number'
        ? String(item)
        : typeof item === 'string'
          ? item.trim()
          : '';
    if (!/^\d{1,10}$/.test(id)) continue;
    ids.add(id);
    if (ids.size >= max) break;
  }
  return [...ids];
}

export interface MatchDetailRequest {
  dateIso: string;
  fixtureIds: string[];
}

/** Validates the bounded `{ dateIso, fixtureIds }` body used by match detail. */
export function parseMatchDetailRequest(body: unknown): MatchDetailRequest | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

  const source = body as { dateIso?: unknown; fixtureIds?: unknown };
  const dateIso = typeof source.dateIso === 'string' ? source.dateIso.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return null;

  const fixtureIds = parseResultFixtureIds(source.fixtureIds, 50);
  if (fixtureIds.length === 0) return null;

  return { dateIso, fixtureIds };
}

export async function getMatchDetail(
  body: unknown
): Promise<ApiResult<{ dateIso: string; capturedAt: string | null; fixtures: Fixture[] } | ErrorBody>> {
  const request = parseMatchDetailRequest(body);
  if (!request) {
    return fail(
      400,
      'A valid dateIso (YYYY-MM-DD) and fixtureIds array are required.'
    );
  }

  try {
    const archived = await readArchivedSlate(request.dateIso);
    const archivedById = new Map(
      (archived?.fixtures ?? []).map((fixture) => [fixture.id, fixture])
    );

    const fixtures = request.fixtureIds.flatMap((id) => {
      const saved = archivedById.get(id);
      if (!saved) return [];

      // Keep the archived prices/analysis, but never show an older scoreline
      // than the one already refreshed for the saved slips.
      const fresher = resultCache.get(id);
      return [
        fresher
          ? {
              ...saved,
              status: fresher.status,
              statusShort: fresher.statusShort,
              statusLong: fresher.statusLong,
              awaitingResult: fresher.awaitingResult,
              score: fresher.score,
            }
          : saved,
      ];
    });

    return ok({
      dateIso: request.dateIso,
      capturedAt: archived?.capturedAt ?? null,
      fixtures,
    });
  } catch (error) {
    console.error('Error reading archived match detail:', error);
    return fail(500, 'Could not read the archived matchday.');
  }
}

export async function refreshResults(
  body: unknown
): Promise<ApiResult<{ fixtures: Fixture[]; cachedAt: string } | ErrorBody>> {
  const missing = missingApiKey();
  if (missing) return missing;

  const source =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  const fixtureIds = parseResultFixtureIds(source.fixtureIds);
  if (fixtureIds.length === 0) {
    return fail(400, 'fixtureIds must be a non-empty array of IDs.');
  }

  const forceRefresh = Boolean(source.forceRefresh);
  if (forceRefresh) {
    for (const id of fixtureIds) resultCache.delete(id);
  }

  try {
    const missingIds = fixtureIds.filter((id) => resultCache.get(id) === undefined);
    if (missingIds.length > 0) {
      const response = await fetchApiFootball<RawApiFixture>('/fixtures', {
        ids: missingIds.join('-'),
      });
      const nowMs = Date.now();
      const todayIso = getTodayIsoDate();

      for (const raw of response.response ?? []) {
        const fixture = toFixture(raw, undefined, todayIso, nowMs);
        resultCache.set(fixture.id, fixture);
        fixtureIndex.set(fixture.id, {
          homeTeam: fixture.homeTeam,
          awayTeam: fixture.awayTeam,
          competition: fixture.competition,
        });
      }
    }

    const fixtures = fixtureIds
      .map((id) => resultCache.get(id))
      .filter((fixture): fixture is Fixture => Boolean(fixture));

    return ok({ fixtures, cachedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Error refreshing saved-slip results:', error);
    return fail(502, errorMessage(error, 'Failed to refresh match results.'));
  }
}

export async function analyzeFixture(
  body: unknown
): Promise<ApiResult<DeepAnalysisResponse | ErrorBody>> {
  const missing = missingApiKey();
  if (missing) return missing;

  try {
    const source =
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};

    const fixtureId = String(source.fixtureId || '').trim();
    if (!/^\d+$/.test(fixtureId)) {
      return fail(400, 'fixtureId is required.');
    }

    if (!Boolean(source.forceRefresh)) {
      const cached = analysisCache.get(fixtureId);
      if (cached) return ok(cached);
    }

    // Prefer team names cached from the live slate; client-supplied labels are
    // only a fallback and are length-capped.
    const known = fixtureIndex.get(fixtureId);
    const homeTeam = known?.homeTeam ?? cleanLabel(source.homeTeam, 'Home');
    const awayTeam = known?.awayTeam ?? cleanLabel(source.awayTeam, 'Away');

    const [pred, injResp] = await Promise.all([
      fetchPrediction(fixtureId),
      fetchApiFootball<RawApiInjury>('/injuries', {
        fixture: fixtureId,
      }).catch(() => ({ response: [] as RawApiInjury[] })),
    ]);

    const injuries = injResp.response ?? [];

    const homeFormRaw = pred?.teams?.home?.league?.form?.slice(-5);
    const awayFormRaw = pred?.teams?.away?.league?.form?.slice(-5);
    const formHome = homeFormRaw ? homeFormRaw.split('').join('-') : undefined;
    const formAway = awayFormRaw ? awayFormRaw.split('').join('-') : undefined;

    const pct = pred?.predictions?.percent;
    const advice = pred?.predictions?.advice;
    const comment = pred?.predictions?.winner?.comment;

    const keyFactors: string[] = [];
    if (pct) {
      keyFactors.push(
        `Outcome probability split: ${homeTeam} ${pct.home || '-'}, Draw ${pct.draw || '-'}, ${awayTeam} ${pct.away || '-'}.`
      );
    }
    if (pred?.comparison?.form) {
      keyFactors.push(
        `Recent form rating: ${homeTeam} ${pred.comparison.form.home || '-'} vs ${awayTeam} ${pred.comparison.form.away || '-'}.`
      );
    }
    if (pred?.comparison?.att && pred?.comparison?.def) {
      keyFactors.push(
        `Attacking / Defensive index: ${homeTeam} (${pred.comparison.att.home || '-'} att / ${pred.comparison.def.home || '-'} def) vs ${awayTeam} (${pred.comparison.att.away || '-'} att / ${pred.comparison.def.away || '-'} def).`
      );
    }
    if (Array.isArray(pred?.h2h) && pred.h2h.length > 0) {
      const recentH2H = pred.h2h
        .slice(0, 3)
        .map(
          (m) =>
            `${m.teams?.home?.name || 'Home'} ${m.goals?.home ?? '-'}-${m.goals?.away ?? '-'} ${m.teams?.away?.name || 'Away'}`
        )
        .join(' · ');
      keyFactors.push(`Recent H2H: ${recentH2H}.`);
    }

    const teamNews =
      injuries.length > 0
        ? injuries
            .slice(0, 6)
            .map(
              (inj) =>
                `${inj.player?.name || 'Player'} (${inj.team?.name || 'Squad'}: ${inj.player?.reason || inj.player?.type || 'Unavailable'})`
            )
            .join('; ')
        : 'No injuries or suspensions currently flagged for this fixture in API-Football.';

    const result: DeepAnalysisResponse = {
      fixtureId,
      summary:
        comment ||
        advice ||
        `API-Football statistical breakdown for ${homeTeam} vs ${awayTeam}.`,
      keyFactors,
      teamNews,
      bestAngle:
        advice || 'Use Double Chance or Over 1.5 Goals to balance ticket variance.',
      formHome,
      formAway,
      sources: [
        {
          title: `API-Football Predictions & Injuries (Fixture #${fixtureId})`,
          uri: 'https://www.api-football.com/documentation-v3#tag/Predictions',
        },
      ],
    };

    analysisCache.set(fixtureId, result);
    return ok(result);
  } catch (error) {
    console.error('Error analyzing fixture:', error);
    return fail(500, errorMessage(error, 'Failed to fetch match report.'));
  }
}

/**
 * Historical hit rates for the three per-match picks. Archive-backed and
 * strategy-aware; deliberately does not require an API key or a live slate.
 */
export async function getPickRecords(
  body: unknown
): Promise<ApiResult<PickRecordsResponse | ErrorBody>> {
  const source =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const strategy = isAccaStrategy(source.strategy) ? source.strategy : 'balanced';
  try {
    return ok(await computePickRecords(strategy));
  } catch (error) {
    console.error('Error computing pick records:', error);
    return fail(500, errorMessage(error, 'Failed to build pick records.'));
  }
}

const STATUSES: SettlementStatus[] = [
  'Win',
  'Lost',
  'Void',
  'Live',
  'Pending',
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function getLedgerSummaryResult(): Promise<
  ApiResult<LedgerSummary | ErrorBody>
> {
  try {
    return ok(await getLedgerSummary());
  } catch (error) {
    console.error('Error reading ledger summary:', error);
    return fail(500, 'Could not read the shadow ticket ledger.');
  }
}

export async function listLedgerTicketsResult(
  query: unknown
): Promise<ApiResult<{ tickets: LedgerTicket[] } | ErrorBody>> {
  try {
    const source = asRecord(query);
    const dateIso =
      typeof source.dateIso === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(source.dateIso)
        ? source.dateIso
        : undefined;
    const status =
      typeof source.status === 'string' &&
      STATUSES.includes(source.status as SettlementStatus)
        ? (source.status as SettlementStatus)
        : undefined;
    const limitRaw = Number(source.limit);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 100;

    return ok({ tickets: await listLedgerTickets({ dateIso, status, limit }) });
  } catch (error) {
    console.error('Error reading ledger tickets:', error);
    return fail(500, 'Could not read ledger tickets.');
  }
}

export async function settleLedger(body: unknown): Promise<
  ApiResult<{ changed: number; summary: LedgerSummary } | ErrorBody>
> {
  try {
    const source = asRecord(body);
    const dateIso =
      typeof source.dateIso === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(source.dateIso)
        ? source.dateIso
        : undefined;

    const changed = await settleLedgerFromArchives(dateIso);
    return ok({ changed, summary: await getLedgerSummary() });
  } catch (error) {
    console.error('Error settling ledger:', error);
    return fail(500, 'Could not settle the shadow ledger.');
  }
}
