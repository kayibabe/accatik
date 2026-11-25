import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  AiAccumulatorResponse,
  AiBriefingResponse,
  AiPick,
} from '../../src/types/ai.ts';
import {
  aiDeskArchiveDir,
  clearAiDeskArchiveCache,
  listAiDeskDates,
  readAiDeskArchive,
  recordAiAccumulator,
  recordAiBriefing,
} from './aiDeskArchive.ts';

const dateIso = '2026-11-24';
const scope = {
  dateIso,
  strategy: 'balanced' as const,
  marketFilter: 'all',
  competitionFilter: 'all',
};

async function useArchiveDir(t: Pick<TestContext, 'after'>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matchslip-ai-desk-'));
  const previous = process.env.MATCHSLIP_AI_DESK_DIR;
  process.env.MATCHSLIP_AI_DESK_DIR = dir;
  clearAiDeskArchiveCache();
  t.after(async () => {
    if (previous === undefined) delete process.env.MATCHSLIP_AI_DESK_DIR;
    else process.env.MATCHSLIP_AI_DESK_DIR = previous;
    clearAiDeskArchiveCache();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

function makePick(odds: number): AiPick {
  return {
    fixtureId: 'f1',
    homeTeam: 'Home FC',
    awayTeam: 'Away FC',
    competition: 'Test League',
    country: 'Testland',
    kickoffTime: '18:00 CAT',
    kickoffTimestamp: Date.UTC(2026, 10, 24, 16, 0),
    marketId: 'f1-1x2-h',
    marketType: '1X2',
    selectionKey: 'home',
    label: 'Home win',
    odds,
    bookmaker: 'Test book',
    pModel: 0.55,
    pStress: 0.51,
    pFair: 0.48,
    edge: 0.07,
    ev: 0.1,
    evStress: 0.02,
    aiScore: 82,
    band: 'High',
    confidence: 0.8,
    disagreement: 0.03,
    stakePct: 0.01,
    frameworkStatus: 'QUALIFIED',
    frameworkConfidence: 'High',
    calibration: null,
    signals: {
      framework: 0.55,
      poisson: 0.54,
      provider: null,
      bookFair: 0.48,
      historyRoi: null,
      historySample: 0,
      promoted: false,
    },
    reasons: ['Model edge survives the haircut.'],
    risks: [],
  };
}

function makeBriefing(generatedAt: string, odds: number): AiBriefingResponse {
  return {
    dateIso,
    displayDate: 'Tuesday, November 24, 2026',
    strategy: 'balanced',
    generatedAt,
    modelVersion: 'ai-ensemble-1.0',
    narrativeProvider: null,
    narrativeNote: '',
    avgClv: null,
    marketFilter: 'all',
    competitionFilter: 'all',
    summary: 'One eligible pick.',
    inputs: [],
    picks: [makePick(odds)],
    diagnostics: {
      fixturesScanned: 1,
      marketsScanned: 1,
      eligibleMarkets: 1,
      excludedStarted: 0,
      excludedNoModel: 0,
      excludedNegativeEv: 0,
      cacheNote: '',
    },
    disclaimer: 'Research estimates, not certainties.',
  };
}

function makeTicket(
  generatedAt: string,
  riskMode: 'balanced' | 'conservative' = 'balanced'
): AiAccumulatorResponse {
  return {
    dateIso,
    generatedAt,
    riskMode,
    targetOdds: 2,
    maxLegs: 2,
    minScore: 60,
    legs: [],
    totalOdds: 2,
    hitProbability: 0.5,
    breakEvenProbability: 0.5,
    evStress: 0.05,
    stakePct: 0.01,
    targetReached: true,
    reason: 'Test ticket.',
    risks: [],
    rejected: [],
    disclaimer: 'Research estimates, not certainties.',
  };
}

test('briefings upsert by snapshot id and keep their first-seen timestamp', async (t) => {
  await useArchiveDir(t);

  await recordAiBriefing(scope, makeBriefing('2026-11-24T08:00:00.000Z', 2), Date.parse('2026-11-24T08:00:00.000Z'));
  await recordAiBriefing(scope, makeBriefing('2026-11-24T09:00:00.000Z', 2.2), Date.parse('2026-11-24T09:00:00.000Z'));

  const archive = await readAiDeskArchive(dateIso);
  assert.equal(archive?.snapshots.length, 1);
  assert.equal(archive?.snapshots[0].firstSeenAt, '2026-11-24T08:00:00.000Z');
  assert.equal(archive?.snapshots[0].generatedAt, '2026-11-24T09:00:00.000Z');
  assert.equal(archive?.snapshots[0].picks[0].odds, 2.2);
  assert.deepEqual(await listAiDeskDates(), [dateIso]);

  const file = path.join(aiDeskArchiveDir(), `${dateIso}.json`);
  assert.equal((await fs.stat(file)).size > 0, true);
});

test('accumulators attach to the matching snapshot and never duplicate a config', async (t) => {
  await useArchiveDir(t);
  await recordAiBriefing(scope, makeBriefing('2026-11-24T08:00:00.000Z', 2));

  for (const riskMode of ['balanced', 'conservative'] as const) {
    await recordAiAccumulator(
      scope,
      'ai-ensemble-1.0',
      { riskMode, targetOdds: 2, maxLegs: 2, minScore: 60 },
      makeTicket('2026-11-24T08:10:00.000Z', riskMode)
    );
  }
  await recordAiAccumulator(
    scope,
    'ai-ensemble-1.0',
    { riskMode: 'balanced', targetOdds: 2, maxLegs: 2, minScore: 60 },
    makeTicket('2026-11-24T08:20:00.000Z', 'balanced')
  );

  const archive = await readAiDeskArchive(dateIso);
  const configs = archive?.snapshots[0].accumulators.map((item) => item.configKey) ?? [];
  assert.equal(configs.length, 2);
  assert.ok(configs.some((key) => key.startsWith('balanced')));
  assert.ok(configs.some((key) => key.startsWith('conservative')));
  const balanced = archive?.snapshots[0].accumulators.find((item) =>
    item.configKey.startsWith('balanced')
  );
  assert.equal(balanced?.generatedAt, '2026-11-24T08:20:00.000Z');
});
