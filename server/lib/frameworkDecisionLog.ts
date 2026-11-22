import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Fixture } from '../../src/types/fixtures.ts';
import type {
  ConfidenceClass,
  FixtureModelSummary,
  FrameworkStatus,
  ReasonCode,
  SuitabilityFlag,
} from '../../src/framework/index.ts';
import type { TeamGoalsContext } from '../../src/framework/marketRules.ts';

/**
 * Durable, immutable decision records (§15.3, R-18).
 *
 * Slate archives deliberately strip derived framework output so a stored slate
 * stays reproducible from its frozen prices. The decision log is the separate,
 * append-only home for what the framework actually decided: every accepted,
 * held and rejected market with its price snapshot, model version and reasons.
 * Records are upserted by decision id, so a later request can refine a decision
 * (for example after slate caps) without rewriting the price it was based on.
 */

export const DECISION_SCHEMA_VERSION = '1.0';

export interface FrameworkOddsSnapshot {
  odds: number;
  bookmaker: string | null;
  capturedAt: string | null;
  matchDateIso: string;
  fixtureStatus: string;
}

export interface FrameworkDecisionRecord {
  decisionId: string;
  schemaVersion: string;
  frameworkVersion: string;
  modelVersion: string;
  decidedAt: string;
  matchDateIso: string;
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  country: string;
  marketId: string;
  selectionKey: string;
  status: FrameworkStatus;
  reasonCodes: ReasonCode[];
  confidence: ConfidenceClass;
  confidenceDowngrades: string[];
  flags: SuitabilityFlag[];
  pModel: number | null;
  pFair: number | null;
  edge: number | null;
  relativeEdge: number | null;
  ev: number | null;
  pStress: number | null;
  evStress: number | null;
  fairOdds: number | null;
  odds: number;
  benchmarkBook: string | null;
  executionBook: string | null;
  oddsAgeSeconds: number | null;
  marketComplete: boolean;
  model: FixtureModelSummary | null;
  marketContext: TeamGoalsContext | null;
  oddsSnapshot: FrameworkOddsSnapshot;
  staked: boolean;
  capReasonCodes: ReasonCode[];
}

export interface FrameworkDecisionFile {
  dateIso: string;
  createdAt: string;
  updatedAt: string;
  decisions: FrameworkDecisionRecord[];
}

/** Pure projection: one record per assessed market on a fixture. */
export function buildDecisionRecords(
  fixtures: Fixture[],
  nowMs: number
): FrameworkDecisionRecord[] {
  const decidedAt = new Date(nowMs).toISOString();
  const records: FrameworkDecisionRecord[] = [];

  for (const fixture of fixtures) {
    for (const market of fixture.markets) {
      const decision = market.framework;
      if (!decision) continue;
      records.push({
        decisionId: `${fixture.matchDateIso}:${fixture.id}:${market.id}`,
        schemaVersion: DECISION_SCHEMA_VERSION,
        frameworkVersion: fixture.framework?.version ?? '',
        modelVersion: fixture.framework?.modelVersion ?? '',
        decidedAt,
        matchDateIso: fixture.matchDateIso,
        fixtureId: fixture.id,
        homeTeam: fixture.homeTeam,
        awayTeam: fixture.awayTeam,
        competition: fixture.competition,
        country: fixture.country,
        marketId: market.id,
        selectionKey: decision.selectionKey,
        status: decision.status,
        reasonCodes: [...decision.reasonCodes],
        confidence: decision.confidence,
        confidenceDowngrades: [...decision.confidenceDowngrades],
        flags: [...decision.flags],
        pModel: decision.pModel,
        pFair: decision.pFair,
        edge: decision.edge,
        relativeEdge: decision.relativeEdge,
        ev: decision.ev,
        pStress: decision.pStress,
        evStress: decision.evStress,
        fairOdds: decision.fairOdds,
        odds: market.odds,
        benchmarkBook: decision.benchmarkBook,
        executionBook: decision.executionBook,
        oddsAgeSeconds: decision.oddsAgeSeconds,
        marketComplete: decision.marketComplete,
        model: fixture.framework?.model ?? null,
        marketContext: decision.marketContext,
        oddsSnapshot: {
          odds: market.odds,
          bookmaker: market.bookmaker ?? null,
          capturedAt: fixture.pricedAt ?? null,
          matchDateIso: fixture.matchDateIso,
          fixtureStatus: fixture.status,
        },
        staked: decision.staked ?? false,
        capReasonCodes: (decision.capReasonCodes ?? []).slice(),
      });
    }
  }
  return records;
}

export function decisionLogDir(): string {
  return (
    process.env.MATCHSLIP_FRAMEWORK_DECISIONS_DIR ??
    path.join(process.cwd(), 'data', 'framework-decisions')
  );
}

function fileFor(dateIso: string): string {
  return path.join(decisionLogDir(), `${dateIso}.json`);
}

const cache = new Map<string, { loadedAt: number; file: FrameworkDecisionFile }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

export function clearDecisionLogCache(): void {
  cache.clear();
}

export async function readDecisionFile(
  dateIso: string,
  nowMs: number = Date.now()
): Promise<FrameworkDecisionFile | null> {
  const cached = cache.get(dateIso);
  if (cached && nowMs - cached.loadedAt < CACHE_TTL_MS) return cached.file;
  try {
    const raw = await fs.readFile(fileFor(dateIso), 'utf8');
    const parsed = JSON.parse(raw) as FrameworkDecisionFile;
    if (!parsed || !Array.isArray(parsed.decisions)) return null;
    const file = {
      dateIso,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
      decisions: parsed.decisions,
    };
    cache.set(dateIso, { loadedAt: nowMs, file });
    return file;
  } catch {
    return null;
  }
}

/** Upserts by decision id and writes atomically. */
export async function writeDecisionRecords(
  dateIso: string,
  records: FrameworkDecisionRecord[],
  nowMs: number = Date.now()
): Promise<void> {
  if (records.length === 0) return;
  const previous = await readDecisionFile(dateIso, nowMs);
  const byId = new Map(
    (previous?.decisions ?? []).map((record) => [record.decisionId, record])
  );
  for (const record of records) byId.set(record.decisionId, record);

  const file: FrameworkDecisionFile = {
    dateIso,
    createdAt: previous?.createdAt ?? new Date(nowMs).toISOString(),
    updatedAt: new Date(nowMs).toISOString(),
    decisions: [...byId.values()].sort((a, b) =>
      a.decisionId.localeCompare(b.decisionId)
    ),
  };

  const dir = decisionLogDir();
  await fs.mkdir(dir, { recursive: true });
  const target = fileFor(dateIso);
  const temp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(file), 'utf8');
  await fs.rename(temp, target);
  cache.set(dateIso, { loadedAt: nowMs, file });
}

/** ISO week key (Monday-based) used to scope weekly exposure. */
export function isoWeekKey(dateIso: string): string {
  const parsed = Date.parse(`${dateIso}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return '';
  const date = new Date(parsed);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7
  );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function dateIsoDaysBefore(dateIso: string, days: number): string | null {
  const parsed = Date.parse(`${dateIso}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Units already staked earlier in the same ISO week. The current matchday is
 * excluded, so a repeated request cannot inflate its own exposure.
 */
export async function priorWeeklyStakeUnits(
  matchDateIso: string,
  nowMs: number = Date.now()
): Promise<{ units: number; weekKey: string }> {
  const weekKey = isoWeekKey(matchDateIso);
  if (!weekKey) return { units: 0, weekKey: '' };
  let units = 0;
  for (let days = 1; days <= 7; days += 1) {
    const dateIso = dateIsoDaysBefore(matchDateIso, days);
    if (!dateIso || isoWeekKey(dateIso) !== weekKey) continue;
    const file = await readDecisionFile(dateIso, nowMs);
    if (!file) continue;
    units += file.decisions.filter(
      (record) => record.staked && isoWeekKey(record.matchDateIso) === weekKey
    ).length;
  }
  return { units, weekKey };
}
