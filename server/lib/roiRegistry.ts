import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Query, type Databases } from 'node-appwrite';
import type { AccaStrategy } from '../../src/types/fixtures.ts';
import type {
  QualifiedPicksResponse,
  RoiPromotionConfig,
  RoiPromotionResult,
  RoiRegistryEntry,
} from '../../src/types/analytics.ts';
import {
  computePickAnalytics,
} from './pickAnalytics.ts';
import {
  applyRoiPromotion,
  DEFAULT_ROI_PROMOTION_CONFIG,
  registryKey,
} from './roiPromotion.ts';
import {
  getDataDatabases,
  listAllDocuments,
  upsertDocument,
} from './appwriteData.ts';
import { APPWRITE_DATABASE_ID } from './auth.ts';

/**
 * Durable store for the daily ROI registry and the derived qualified-picks
 * tables. Appwrite keeps one document per row with a `payloadJson` copy of the
 * full entry (the same pattern as `ledger_tickets`), so the collections need
 * only index attributes. A local JSON fallback keeps the flow runnable offline.
 */

const REGISTRY_COLLECTION = 'roi_registry';
const QUALIFIED_COLLECTION = 'qualified_daily';

function registryFile(): string {
  return (
    process.env.MATCHSLIP_ROI_REGISTRY_FILE ??
    path.join(process.cwd(), 'data', 'roi', 'registry.json')
  );
}

function qualifiedFile(dateIso: string, strategy: AccaStrategy): string {
  const dir =
    process.env.MATCHSLIP_QUALIFIED_DIR ??
    path.join(process.cwd(), 'data', 'roi', 'qualified');
  return path.join(dir, `${dateIso}_${strategy}.json`);
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value), 'utf8');
  await fs.rename(temp, file);
}

export async function readRoiRegistry(
  strategy?: AccaStrategy
): Promise<RoiRegistryEntry[]> {
  const databases = getDataDatabases();
  if (databases) {
    try {
      const queries = strategy ? [Query.equal('strategy', strategy)] : [];
      const documents = await listAllDocuments(databases, REGISTRY_COLLECTION, queries);
      return documents
        .map((document) => {
          try {
            return JSON.parse(String(document.payloadJson)) as RoiRegistryEntry;
          } catch {
            return null;
          }
        })
        .filter((entry): entry is RoiRegistryEntry => entry !== null);
    } catch {
      return [];
    }
  }
  const entries = await readJson<RoiRegistryEntry[]>(registryFile(), []);
  return strategy ? entries.filter((entry) => entry.strategy === strategy) : entries;
}

export async function writeRoiRegistry(
  entries: RoiRegistryEntry[],
  strategy?: AccaStrategy
): Promise<void> {
  const databases = getDataDatabases();
  if (databases) {
    const touchedStrategies = strategy
      ? [strategy]
      : [...new Set(entries.map((entry) => entry.strategy))];
    const byKey = new Map(
      entries.map((entry) => [
        registryKey(entry.strategy, entry.source, entry.selectionKey),
        entry,
      ])
    );
    for (const entry of entries) {
      await upsertDocument(databases, REGISTRY_COLLECTION, registryKey(entry.strategy, entry.source, entry.selectionKey), {
        strategy: entry.strategy,
        source: entry.source,
        selectionKey: entry.selectionKey,
        snapshotDateIso: entry.snapshotDateIso,
        status: entry.status,
        payloadJson: JSON.stringify(entry),
      });
    }
    // Prune only the strategies this write touched; never erase unrelated rows.
    for (const item of touchedStrategies) {
      const existing = await listAllDocuments(databases, REGISTRY_COLLECTION, [
        Query.equal('strategy', item),
      ]);
      for (const document of existing) {
        if (!byKey.has(document.$id)) {
          await databases.deleteDocument({
            databaseId: APPWRITE_DATABASE_ID,
            collectionId: REGISTRY_COLLECTION,
            documentId: document.$id,
          });
        }
      }
    }
    return;
  }
  const file = registryFile();
  const current = await readJson<RoiRegistryEntry[]>(file, []);
  const byKey = new Map(
    current.map((entry) => [
      registryKey(entry.strategy, entry.source, entry.selectionKey),
      entry,
    ])
  );
  for (const entry of entries) {
    byKey.set(registryKey(entry.strategy, entry.source, entry.selectionKey), entry);
  }
  await writeJsonAtomic(file, [...byKey.values()]);
}

/**
 * Runs one snapshot end to end: clean analytics -> state transitions -> store.
 * Exported so both the API handler and the scheduled function use one path.
 */
export async function runDailyRoiPromotion(
  strategy: AccaStrategy,
  config: RoiPromotionConfig = DEFAULT_ROI_PROMOTION_CONFIG,
  force = false,
  snapshotDateIso?: string
): Promise<RoiPromotionResult> {
  const analytics = await computePickAnalytics(strategy, force, {
    prematchOnly: config.prematchOnly,
  });
  const previous = await readRoiRegistry(strategy);
  const result = applyRoiPromotion(
    previous,
    analytics,
    strategy,
    config,
    snapshotDateIso ?? analytics.generatedAt.slice(0, 10)
  );
  await writeRoiRegistry(result.entries, strategy);
  return result;
}

export async function readQualifiedPicks(
  dateIso: string,
  strategy: AccaStrategy
): Promise<QualifiedPicksResponse | null> {
  const databases = getDataDatabases();
  if (databases) {
    try {
      const document = await databases.getDocument({
        databaseId: APPWRITE_DATABASE_ID,
        collectionId: QUALIFIED_COLLECTION,
        documentId: `${dateIso}_${strategy}`,
      });
      return JSON.parse(String(document.payloadJson)) as QualifiedPicksResponse;
    } catch {
      return null;
    }
  }
  return readJson<QualifiedPicksResponse | null>(qualifiedFile(dateIso, strategy), null);
}

export async function writeQualifiedPicks(
  response: QualifiedPicksResponse
): Promise<void> {
  const databases = getDataDatabases();
  if (databases) {
    await upsertDocument(
      databases,
      QUALIFIED_COLLECTION,
      `${response.dateIso}_${response.strategy}`,
      {
        dateIso: response.dateIso,
        strategy: response.strategy,
        generatedAt: response.generatedAt,
        eligibleCount: response.eligibleCount,
        payloadJson: JSON.stringify(response),
      }
    );
    return;
  }
  await writeJsonAtomic(
    qualifiedFile(response.dateIso, response.strategy),
    response
  );
}
