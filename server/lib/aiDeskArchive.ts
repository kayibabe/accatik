import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  AiAccumulatorResponse,
  AiBriefingResponse,
  AiPick,
  AiRiskMode,
} from '../../src/types/ai.ts';
import type { AccaStrategy } from '../../src/types/fixtures.ts';
import { writeJsonAtomic } from './atomicWrite.ts';
import { createTtlCache } from './cache.ts';

/**
 * Durable history for the AI Desk.
 *
 * The existing briefing cache is deliberately short-lived (two minutes) and
 * exists only to keep repeated requests cheap. This archive is the reference
 * record: the exact ranked picks and generated tickets the desk showed, frozen
 * at generation time so they can be graded once the matchday settles.
 *
 * Files follow the same per-date JSON pattern as slate and framework-decision
 * archives. Writes are upserts by snapshot id, so retries and cache hits can
 * never inflate a performance sample.
 */

export const AI_DESK_ARCHIVE_SCHEMA = '1.0';

/** Reconstructed snapshots carry this suffix so live and replayed runs stay distinct. */
export const AI_DESK_BACKFILL_SUFFIX = '+backfill';

export function isBackfilledModelVersion(modelVersion: string): boolean {
  return modelVersion.endsWith(AI_DESK_BACKFILL_SUFFIX);
}

export interface AiDeskRequestScope {
  dateIso: string;
  strategy: AccaStrategy;
  marketFilter: string;
  competitionFilter: string;
}

export interface AiDeskAccumulatorRecord {
  configKey: string;
  riskMode: AiRiskMode;
  targetOdds: number;
  maxLegs: number;
  minScore: number;
  generatedAt: string;
  ticket: AiAccumulatorResponse;
}

export interface AiDeskSnapshot {
  snapshotId: string;
  schemaVersion: string;
  dateIso: string;
  strategy: AccaStrategy;
  marketFilter: string;
  competitionFilter: string;
  modelVersion: string;
  /** Kept so a later regeneration cannot rewrite the first-seen timestamp. */
  firstSeenAt: string;
  generatedAt: string;
  updatedAt: string;
  narrativeProvider: string | null;
  picks: AiPick[];
  accumulators: AiDeskAccumulatorRecord[];
}

export interface AiDeskArchiveFile {
  dateIso: string;
  createdAt: string;
  updatedAt: string;
  snapshots: AiDeskSnapshot[];
}

export function aiDeskArchiveDir(): string {
  return (
    process.env.MATCHSLIP_AI_DESK_DIR ??
    path.join(process.cwd(), 'data', 'ai-desk')
  );
}

function fileFor(dateIso: string): string {
  return path.join(aiDeskArchiveDir(), `${dateIso}.json`);
}

/** Identity of the briefing a ticket was built from. */
export function aiSnapshotKey(scope: AiDeskRequestScope, modelVersion: string): string {
  return [
    scope.dateIso,
    scope.strategy,
    scope.marketFilter,
    scope.competitionFilter,
    modelVersion,
  ].join('|');
}

export function aiAccumulatorConfigKey(config: {
  riskMode: AiRiskMode;
  targetOdds: number;
  maxLegs: number;
  minScore: number;
}): string {
  return [
    config.riskMode,
    config.targetOdds,
    config.maxLegs,
    config.minScore,
  ].join('|');
}

const cache = createTtlCache<AiDeskArchiveFile>(10 * 60 * 1000, 32);

export function clearAiDeskArchiveCache(): void {
  cache.clear();
}

export async function listAiDeskDates(): Promise<string[]> {
  try {
    const names = await fs.readdir(aiDeskArchiveDir());
    return names
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
      .map((name) => name.slice(0, 10))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export async function readAiDeskArchive(
  dateIso: string,
  nowMs: number = Date.now()
): Promise<AiDeskArchiveFile | null> {
  const cached = cache.get(dateIso);
  if (cached) return cached;
  try {
    const raw = await fs.readFile(fileFor(dateIso), 'utf8');
    const parsed = JSON.parse(raw) as AiDeskArchiveFile;
    if (!parsed || !Array.isArray(parsed.snapshots)) return null;
    const file: AiDeskArchiveFile = {
      dateIso,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
      snapshots: parsed.snapshots,
    };
    cache.set(dateIso, file);
    return file;
  } catch {
    return null;
  }
}

/** Atomic write so a crash mid-save cannot truncate an existing archive. */
async function writeArchive(file: AiDeskArchiveFile): Promise<void> {
  const dir = aiDeskArchiveDir();
  await fs.mkdir(dir, { recursive: true });
  const target = fileFor(file.dateIso);
  await writeJsonAtomic(target, file);
  cache.set(file.dateIso, file);
}

function snapshotFromBriefing(
  scope: AiDeskRequestScope,
  briefing: AiBriefingResponse,
  nowMs: number,
  accumulators: AiDeskAccumulatorRecord[]
): AiDeskSnapshot {
  const timestamp = new Date(nowMs).toISOString();
  return {
    snapshotId: aiSnapshotKey(scope, briefing.modelVersion),
    schemaVersion: AI_DESK_ARCHIVE_SCHEMA,
    dateIso: scope.dateIso,
    strategy: scope.strategy,
    marketFilter: scope.marketFilter,
    competitionFilter: scope.competitionFilter,
    modelVersion: briefing.modelVersion,
    firstSeenAt: timestamp,
    generatedAt: briefing.generatedAt,
    updatedAt: timestamp,
    narrativeProvider: briefing.narrativeProvider,
    picks: briefing.picks.map((pick) => ({ ...pick })),
    accumulators: accumulators.map((record) => ({ ...record, ticket: { ...record.ticket } })),
  };
}

/** Upsert the ranked picks the desk generated for one request scope. */
export async function recordAiBriefing(
  scope: AiDeskRequestScope,
  briefing: AiBriefingResponse,
  nowMs: number = Date.now(),
  accumulators: AiDeskAccumulatorRecord[] = []
): Promise<void> {
  if (briefing.picks.length === 0) return;

  const previous = await readAiDeskArchive(scope.dateIso, nowMs);
  const fresh = snapshotFromBriefing(scope, briefing, nowMs, accumulators);
  const snapshots = [...(previous?.snapshots ?? [])];
  const index = snapshots.findIndex((item) => item.snapshotId === fresh.snapshotId);
  if (index >= 0) {
    const existing = snapshots[index];
    snapshots[index] = {
      ...fresh,
      firstSeenAt: existing.firstSeenAt,
      accumulators: existing.accumulators ?? [],
    };
  } else {
    snapshots.push(fresh);
  }

  await writeArchive({
    dateIso: scope.dateIso,
    createdAt: previous?.createdAt ?? fresh.firstSeenAt,
    updatedAt: fresh.updatedAt,
    snapshots,
  });
}

/** Attach a generated accumulator to the briefing snapshot it came from. */
export async function recordAiAccumulator(
  scope: AiDeskRequestScope,
  modelVersion: string,
  config: {
    riskMode: AiRiskMode;
    targetOdds: number;
    maxLegs: number;
    minScore: number;
  },
  ticket: AiAccumulatorResponse,
  nowMs: number = Date.now()
): Promise<void> {
  const previous = await readAiDeskArchive(scope.dateIso, nowMs);
  const snapshotId = aiSnapshotKey(scope, modelVersion);
  const configKey = aiAccumulatorConfigKey(config);
  const snapshots = [...(previous?.snapshots ?? [])];
  const index = snapshots.findIndex((item) => item.snapshotId === snapshotId);

  const record: AiDeskAccumulatorRecord = {
    configKey,
    riskMode: config.riskMode,
    targetOdds: config.targetOdds,
    maxLegs: config.maxLegs,
    minScore: config.minScore,
    generatedAt: ticket.generatedAt,
    ticket: { ...ticket },
  };

  if (index >= 0) {
    const existing = snapshots[index];
    const accumulators = [...(existing.accumulators ?? [])].filter(
      (item) => item.configKey !== configKey
    );
    accumulators.push(record);
    snapshots[index] = { ...existing, accumulators, updatedAt: new Date(nowMs).toISOString() };
  } else {
    snapshots.push({
      snapshotId,
      schemaVersion: AI_DESK_ARCHIVE_SCHEMA,
      dateIso: scope.dateIso,
      strategy: scope.strategy,
      marketFilter: scope.marketFilter,
      competitionFilter: scope.competitionFilter,
      modelVersion,
      firstSeenAt: record.generatedAt,
      generatedAt: record.generatedAt,
      updatedAt: new Date(nowMs).toISOString(),
      narrativeProvider: null,
      picks: [],
      accumulators: [record],
    });
  }

  await writeArchive({
    dateIso: scope.dateIso,
    createdAt: previous?.createdAt ?? record.generatedAt,
    updatedAt: new Date(nowMs).toISOString(),
    snapshots,
  });
}
