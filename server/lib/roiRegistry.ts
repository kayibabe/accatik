import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AccaStrategy } from '../../src/types/fixtures.ts';
import type {
  QualifiedPicksResponse,
  RoiPromotionConfig,
  RoiPromotionResult,
  RoiRegistryEntry,
} from '../../src/types/analytics.ts';
import { computePickAnalytics } from './pickAnalytics.ts';
import {
  applyRoiPromotion,
  DEFAULT_ROI_PROMOTION_CONFIG,
  registryKey,
} from './roiPromotion.ts';

/**
 * Local JSON store for the daily ROI registry and its derived qualified-picks
 * tables. One file holds the registry; each date/strategy pair gets its own
 * qualified-picks file under `data/roi/qualified`.
 */

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
  const entries = await readJson<RoiRegistryEntry[]>(registryFile(), []);
  return strategy ? entries.filter((entry) => entry.strategy === strategy) : entries;
}

export async function writeRoiRegistry(
  entries: RoiRegistryEntry[],
  strategy?: AccaStrategy
): Promise<void> {
  const file = registryFile();
  const current = await readJson<RoiRegistryEntry[]>(file, []);

  // A strategy-scoped write replaces that strategy's rows so removed picks do
  // not linger. A full write still merges by key to preserve unrelated rows.
  const retained = strategy
    ? current.filter((entry) => entry.strategy !== strategy)
    : current;
  const byKey = new Map(
    retained.map((entry) => [
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
 * Exported so API handlers and local CLI scripts share one path.
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
  return readJson<QualifiedPicksResponse | null>(qualifiedFile(dateIso, strategy), null);
}

export async function writeQualifiedPicks(
  response: QualifiedPicksResponse
): Promise<void> {
  await writeJsonAtomic(
    qualifiedFile(response.dateIso, response.strategy),
    response
  );
}
