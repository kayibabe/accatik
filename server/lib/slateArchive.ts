import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Fixture } from '../../src/types/fixtures.ts';

/**
 * Permanent, on-disk slate archive.
 *
 * Every matchday pulled from API-Football is written here once and then read
 * from disk on later visits. A fully settled matchday is never requested from
 * the API again, so a date browsed today is still complete a year from now.
 *
 * What is frozen when a match has kicked off:
 *   - `markets` (prices, fair probabilities, rationales)
 *   - `recommendedPickId` (the balanced pick the server derived from them)
 *
 * Freezing those inputs is what persists the pick: `resolvePick(fixture, …)`
 * replays the exact recommendation the user saw, for every strategy, until the
 * user explicitly recaptures the date. Recapture is the only path allowed to
 * replace a kicked-off price block; ordinary refreshes must not.
 */

const RESULT_GRACE_MS = 1000 * 60 * 60 * 36;

export interface ArchivedSlate {
  dateIso: string;
  /** First time this matchday was captured. */
  capturedAt: string;
  /** Last time results were merged in. */
  updatedAt: string;
  fixtures: Fixture[];
}

function archiveDir(): string {
  return (
    process.env.MATCHSLIP_ARCHIVE_DIR ??
    path.join(process.cwd(), 'data', 'slates')
  );
}

function fileFor(dateIso: string): string {
  return path.join(archiveDir(), `${dateIso}.json`);
}

export function archivePathFor(dateIso: string): string {
  return fileFor(dateIso);
}

/** Newest-first list of matchdays with a durable slate, for archive scans. */
export async function listArchivedSlateDates(): Promise<string[]> {
  try {
    const names = await fs.readdir(archiveDir());
    return names
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
      .map((name) => name.slice(0, 10))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export async function readArchivedSlate(
  dateIso: string
): Promise<ArchivedSlate | null> {
  try {
    const raw = await fs.readFile(fileFor(dateIso), 'utf8');
    const parsed = JSON.parse(raw) as ArchivedSlate;
    if (!parsed || !Array.isArray(parsed.fixtures)) return null;
    if (typeof parsed.capturedAt !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Atomic write so a crash mid-save can never truncate an existing archive. */
export async function writeArchivedSlate(slate: ArchivedSlate): Promise<void> {
  const dir = archiveDir();
  await fs.mkdir(dir, { recursive: true });
  const target = fileFor(slate.dateIso);
  const temp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(slate), 'utf8');
  await fs.rename(temp, target);
}

export function isFixtureFinal(fixture: Fixture, nowMs: number): boolean {
  if (fixture.status === 'Finished' || fixture.status === 'Void') return true;
  // Feed never published a result: seal after a grace window instead of
  // refetching the same match forever.
  if (!fixture.kickoffTimestamp) return false;
  return nowMs - fixture.kickoffTimestamp > RESULT_GRACE_MS;
}

export function isSlateSettled(fixtures: Fixture[], nowMs: number): boolean {
  return fixtures.length > 0 && fixtures.every((f) => isFixtureFinal(f, nowMs));
}

/**
 * Explicit recapture: replaces the frozen price block with the freshly fetched
 * one and restamps it, while carrying over the model snapshot that the cold
 * build does not fetch. Unlike `mergeArchivedPrices`, kicked-off fixtures take
 * the new book too. Callers must treat the returned prices as live/late and
 * persist the slate with a new `capturedAt`.
 */
export function recaptureFixturePrices(
  fresh: Fixture[],
  archived: Fixture[],
  nowMs: number
): Fixture[] {
  const savedById = new Map(archived.map((fixture) => [fixture.id, fixture]));
  const pricedAt = new Date(nowMs).toISOString();

  return fresh.map((fixture) => {
    const saved = savedById.get(fixture.id);
    const modelSnapshot = saved
      ? {
          modelDataAt: fixture.modelDataAt ?? saved.modelDataAt,
          modelAdvice: fixture.modelAdvice ?? saved.modelAdvice,
          modelProbabilities: fixture.modelProbabilities ?? saved.modelProbabilities,
          analystNoteMarketId:
            fixture.analystNoteMarketId ?? saved.analystNoteMarketId,
          formHome: fixture.formHome === '—' ? saved.formHome : fixture.formHome,
          formAway: fixture.formAway === '—' ? saved.formAway : fixture.formAway,
          // Pick history spans price eras: a recapture appends, never replaces.
          featuredPickSnapshots:
            fixture.featuredPickSnapshots ?? saved.featuredPickSnapshots,
        }
      : {};

    return {
      ...fixture,
      ...modelSnapshot,
      ...(fixture.markets.length > 0 ? { pricedAt } : {}),
    };
  });
}

/**
 * Merges fresh results over an archived slate without losing its prices.
 *
 * Pre-kickoff prices still move, so a scheduled fixture takes the fresh book.
 * Once a fixture has kicked off, the archived price block wins: that is the
 * market the user was actually shown, and the one their ticket was built from.
 */
export function mergeArchivedPrices(
  archived: Fixture[],
  fresh: Fixture[]
): Fixture[] {
  const previous = new Map(archived.map((fixture) => [fixture.id, fixture]));

  return fresh.map((fixture) => {
    const saved = previous.get(fixture.id);
    const featuredPickSnapshots =
      saved?.featuredPickSnapshots ?? fixture.featuredPickSnapshots;
    if (!saved || saved.markets.length === 0) {
      return featuredPickSnapshots
        ? { ...fixture, featuredPickSnapshots }
        : fixture;
    }
    if (fixture.status === 'Scheduled') {
      return featuredPickSnapshots
        ? { ...fixture, featuredPickSnapshots }
        : fixture;
    }

    return {
      ...fixture,
      markets: saved.markets,
      allMarkets: saved.allMarkets ?? saved.markets,
      recommendedPickId: saved.recommendedPickId,
      bookmakerName: saved.bookmakerName,
      hasLiveOdds: saved.hasLiveOdds,
      pricedAt: saved.pricedAt,
      priceQuality: saved.priceQuality,
      featuredPickSnapshots,
    };
  });
}
