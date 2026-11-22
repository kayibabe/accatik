import type { Fixture } from '../../src/types/fixtures.ts';
import type { AnalyticsRefreshResult } from '../../src/types/analytics.ts';
import type { RawApiFixture } from './apiFootball.ts';
import { fetchApiFootball, resolveApiFootballKey } from './apiFootball.ts';
import { clearAnalyticsCaches } from './cache.ts';
import { toFixture } from './markets.ts';
import {
  listArchivedSlateDates,
  readArchivedSlate,
  writeArchivedSlate,
} from './slateArchive.ts';
import { addDaysToIsoDate, getTodayIsoDate } from './time.ts';

/**
 * Keeps the inception-to-date analytics archive current.
 *
 * Slate visits already merge fresh results in the background, but the analytics
 * tab never opens a slate. This pass fills that gap: it looks only at recent
 * matchdays with fixtures the feed has not finalised, then overlays their
 * status and score onto the archived prices. The book the user was shown is
 * never replaced, so historical ROI stays comparable.
 *
 * Every date is time-gated, so a page full of open analytics tabs cannot turn
 * this into a stream of upstream API calls.
 */

const DEFAULT_LOOKBACK_DAYS = 3;
const DEFAULT_MAX_DATES = 3;
const DEFAULT_COOLDOWN_MS = 2 * 60 * 1000;
const ID_BATCH_SIZE = 20;

const lastRefreshAt = new Map<string, number>();

function isFinal(fixture: Fixture): boolean {
  return fixture.status === 'Finished' || fixture.status === 'Void';
}

function kickoffPassed(fixture: Fixture, nowMs: number): boolean {
  return !fixture.kickoffTimestamp || fixture.kickoffTimestamp <= nowMs;
}

/** Result fields only; prices, picks and snapshots remain frozen. */
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

export interface AnalyticsRefreshOptions {
  /** How many days behind today to consider. */
  lookbackDays?: number;
  /** Upper bound on dates refreshed in one pass. */
  maxDates?: number;
  /** Minimum gap between two passes for the same date. */
  cooldownMs?: number;
  /** Ignore the cooldown (scheduled daily job). */
  force?: boolean;
  nowMs?: number;
}

export async function refreshAnalyticsArchives(
  options: AnalyticsRefreshOptions = {}
): Promise<AnalyticsRefreshResult> {
  const result: AnalyticsRefreshResult = {
    checkedDates: [],
    refreshedDates: [],
    changedDates: [],
    errors: [],
  };
  if (!resolveApiFootballKey()) {
    result.skipped = 'API_FOOTBALL_KEY is not configured; archived results are unchanged.';
    return result;
  }

  const nowMs = options.nowMs ?? Date.now();
  const lookbackDays = options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const maxDates = options.maxDates ?? DEFAULT_MAX_DATES;
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const today = getTodayIsoDate();
  const earliest = addDaysToIsoDate(today, -lookbackDays);

  const candidates = (await listArchivedSlateDates())
    .filter((dateIso) => dateIso >= earliest && dateIso <= today)
    .sort()
    .reverse()
    .slice(0, maxDates);

  for (const dateIso of candidates) {
    result.checkedDates.push(dateIso);
    const slate = await readArchivedSlate(dateIso);
    if (!slate) continue;

    const pendingIds = slate.fixtures
      .filter((fixture) => !isFinal(fixture) && kickoffPassed(fixture, nowMs))
      .map((fixture) => fixture.id)
      .filter((id) => /^\d+$/.test(id));
    if (pendingIds.length === 0) continue;

    if (!options.force && nowMs - (lastRefreshAt.get(dateIso) ?? 0) < cooldownMs) {
      continue;
    }
    lastRefreshAt.set(dateIso, nowMs);

    try {
      const fresh: Fixture[] = [];
      for (let offset = 0; offset < pendingIds.length; offset += ID_BATCH_SIZE) {
        const response = await fetchApiFootball<RawApiFixture>('/fixtures', {
          ids: pendingIds.slice(offset, offset + ID_BATCH_SIZE).join('-'),
        });
        for (const raw of response.response ?? []) {
          fresh.push(toFixture(raw, undefined, dateIso, Date.now()));
        }
      }
      if (fresh.length === 0) continue;
      result.refreshedDates.push(dateIso);

      const fixtures = overlayResults(slate.fixtures, fresh);
      const changed = fixtures.some((fixture, index) => {
        const before = slate.fixtures[index];
        return (
          fixture.status !== before.status ||
          fixture.score?.home !== before.score?.home ||
          fixture.score?.away !== before.score?.away
        );
      });
      await writeArchivedSlate({
        dateIso,
        capturedAt: slate.capturedAt,
        updatedAt: new Date().toISOString(),
        fixtures,
      });
      if (changed) result.changedDates.push(dateIso);
    } catch (error) {
      result.errors.push(
        `${dateIso}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (result.changedDates.length > 0) clearAnalyticsCaches();
  return result;
}
