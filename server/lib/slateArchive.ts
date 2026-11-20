import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Query, type Databases } from 'node-appwrite';
import type { Fixture } from '../../src/types/fixtures.ts';
import {
  getDataDatabases,
  listAllDocuments,
  mapWithConcurrency,
  upsertDocument,
} from './appwriteData.ts';
import { APPWRITE_DATABASE_ID } from './auth.ts';

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
 * replays the exact recommendation the user saw, for every strategy, forever.
 */

const RESULT_GRACE_MS = 1000 * 60 * 60 * 36;

/**
 * Appwrite documents are capped at 64 KB. A full matchday of priced fixtures
 * is larger, so the archive stores a handful of chunk documents instead of one
 * document per fixture. Keep the payload well below the cap to leave room for
 * the metadata attributes and multi-byte team names.
 */
export const ARCHIVE_CHUNK_MAX_CHARS = 40_000;

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

/**
 * Packs fixtures into JSON arrays small enough for one Appwrite document each.
 * Pure so the chunking boundary can be tested without a live database.
 */
export function chunkFixturesForStorage(
  fixtures: Fixture[],
  maxChars = ARCHIVE_CHUNK_MAX_CHARS
): string[] {
  const chunks: string[] = [];
  let batch: Fixture[] = [];

  for (const fixture of fixtures) {
    const candidate = [...batch, fixture];
    if (batch.length > 0 && JSON.stringify(candidate).length > maxChars) {
      chunks.push(JSON.stringify(batch));
      batch = [fixture];
    } else {
      batch = candidate;
    }
  }
  // Always write at least one chunk so an empty slate is distinguishable from
  // a missing archive.
  chunks.push(JSON.stringify(batch));
  return chunks;
}

/**
 * Reads both the current chunk payloads (arrays of fixtures) and the legacy
 * one-document-per-fixture payloads (single fixtures), preferring the newer
 * format and de-duplicating by fixture ID.
 */
export function parseArchiveFixturePayloads(payloads: string[]): Fixture[] {
  const legacy: Fixture[] = [];
  const chunked: Fixture[] = [];

  for (const payload of payloads) {
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof (item as Fixture).id === 'string') {
            chunked.push(item as Fixture);
          }
        }
      } else if (parsed && typeof (parsed as Fixture).id === 'string') {
        legacy.push(parsed as Fixture);
      }
    } catch {
      // A single corrupt document must not lose the rest of the archive.
    }
  }

  const byId = new Map<string, Fixture>();
  for (const fixture of [...legacy, ...chunked]) byId.set(fixture.id, fixture);
  return [...byId.values()].sort(
    (a, b) =>
      (a.kickoffTimestamp ?? 0) - (b.kickoffTimestamp ?? 0) ||
      String(a.id).localeCompare(String(b.id))
  );
}

async function readSlateFromAppwrite(
  databases: Databases,
  dateIso: string
): Promise<ArchivedSlate | null> {
  try {
    const meta = await databases.getDocument({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId: 'slates',
      documentId: dateIso,
    });
    const documents = await listAllDocuments(databases, 'slate_fixtures', [
      Query.equal('dateIso', dateIso),
    ]);
    const fixtures = parseArchiveFixturePayloads(
      documents.map((document) => String(document.payloadJson))
    );
    return {
      dateIso,
      capturedAt: String(meta.capturedAt),
      updatedAt: String(meta.updatedAt),
      fixtures,
    };
  } catch {
    return null;
  }
}

async function writeSlateToAppwrite(
  databases: Databases,
  slate: ArchivedSlate
): Promise<void> {
  const { dateIso, capturedAt, updatedAt, fixtures } = slate;
  await upsertDocument(databases, 'slates', dateIso, {
    dateIso,
    capturedAt,
    updatedAt,
    fixtureCount: fixtures.length,
  });

  const payloads = chunkFixturesForStorage(fixtures);
  const wanted = new Set(
    payloads.map((_, index) => `${dateIso}_chunk_${index}`)
  );
  await mapWithConcurrency(payloads, 4, async (payloadJson, index) => {
    await upsertDocument(
      databases,
      'slate_fixtures',
      `${dateIso}_chunk_${index}`,
      {
        dateIso,
        fixtureId: `chunk_${index}`,
        capturedAt,
        updatedAt,
        payloadJson,
      }
    );
  });

  // Never prune from an empty slate: a partial write must not erase the archive.
  if (fixtures.length === 0) return;
  const existing = await listAllDocuments(databases, 'slate_fixtures', [
    Query.equal('dateIso', dateIso),
  ]);
  for (const document of existing) {
    if (wanted.has(document.$id)) continue;
    await databases.deleteDocument({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId: 'slate_fixtures',
      documentId: document.$id,
    });
  }
}

/** Newest-first list of matchdays with a durable slate, for archive scans. */
export async function listArchivedSlateDates(): Promise<string[]> {
  const databases = getDataDatabases();
  if (databases) {
    try {
      const documents = await listAllDocuments(databases, 'slates');
      return documents
        .map((document) => String(document.dateIso ?? ''))
        .filter((dateIso) => /^\d{4}-\d{2}-\d{2}$/.test(dateIso))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }
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
  const databases = getDataDatabases();
  if (databases) return readSlateFromAppwrite(databases, dateIso);
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
  const databases = getDataDatabases();
  if (databases) {
    await writeSlateToAppwrite(databases, slate);
    return;
  }
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
    if (!saved || saved.markets.length === 0) return fixture;
    if (fixture.status === 'Scheduled') return fixture;

    return {
      ...fixture,
      markets: saved.markets,
      recommendedPickId: saved.recommendedPickId,
      bookmakerName: saved.bookmakerName,
      hasLiveOdds: saved.hasLiveOdds,
      pricedAt: saved.pricedAt,
      priceQuality: saved.priceQuality,
    };
  });
}
