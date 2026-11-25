import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  AiBriefingResponse,
  AiConfidenceBand,
  AiPick,
  AiPerformanceResponse,
} from '../../src/types/ai.ts';
import type { Fixture, MarketOption, MarketType } from '../../src/types/fixtures.ts';
import { makeFixture, makeMarket } from '../../src/utils/testFactories.ts';
import {
  clearAiDeskArchiveCache,
  recordAiBriefing,
} from './aiDeskArchive.ts';
import { computeAiPerformance } from './aiPerformance.ts';
import { writeArchivedSlate } from './slateArchive.ts';

const dateIso = '2026-11-24';
const scope = {
  dateIso,
  strategy: 'balanced' as const,
  marketFilter: 'all',
  competitionFilter: 'all',
};

async function useDataDirs(t: Pick<TestContext, 'after'>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matchslip-ai-perf-'));
  const previousAi = process.env.MATCHSLIP_AI_DESK_DIR;
  const previousSlates = process.env.MATCHSLIP_ARCHIVE_DIR;
  process.env.MATCHSLIP_AI_DESK_DIR = path.join(dir, 'ai-desk');
  process.env.MATCHSLIP_ARCHIVE_DIR = path.join(dir, 'slates');
  clearAiDeskArchiveCache();
  t.after(async () => {
    if (previousAi === undefined) delete process.env.MATCHSLIP_AI_DESK_DIR;
    else process.env.MATCHSLIP_AI_DESK_DIR = previousAi;
    if (previousSlates === undefined) delete process.env.MATCHSLIP_ARCHIVE_DIR;
    else process.env.MATCHSLIP_ARCHIVE_DIR = previousSlates;
    clearAiDeskArchiveCache();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const market = (id: string, odds: number, type: MarketType, label: string): MarketOption =>
    makeMarket(id, odds, type, label);
  const fixtures: Fixture[] = [
    makeFixture({
      id: 'f1',
      matchDateIso: dateIso,
      status: 'Finished',
      score: { home: 2, away: 1 },
      markets: [market('f1-1x2-h', 2, '1X2', 'Home Win')],
    }),
    makeFixture({
      id: 'f2',
      matchDateIso: dateIso,
      status: 'Finished',
      score: { home: 1, away: 1 },
      markets: [market('f2-1x2-d', 3, '1X2', 'Draw')],
    }),
    makeFixture({
      id: 'f3',
      matchDateIso: dateIso,
      status: 'Finished',
      score: { home: 0, away: 2 },
      markets: [market('f3-1x2-h', 2.5, '1X2', 'Home Win')],
    }),
    makeFixture({
      id: 'f4',
      matchDateIso: dateIso,
      status: 'Finished',
      score: { home: 1, away: 1 },
      markets: [market('f4-dnb-h', 2, 'Draw No Bet', 'Home')],
    }),
  ];
  await writeArchivedSlate({
    dateIso,
    capturedAt: '2026-11-24T07:00:00.000Z',
    updatedAt: '2026-11-24T09:00:00.000Z',
    fixtures,
  });
}

function makePick(
  fixtureId: string,
  marketId: string,
  label: string,
  marketType: MarketType,
  odds: number,
  aiScore: number,
  band: AiConfidenceBand
): AiPick {
  return {
    fixtureId,
    homeTeam: 'Home FC',
    awayTeam: 'Away FC',
    competition: 'Test League',
    country: 'Testland',
    kickoffTime: '18:00 CAT',
    kickoffTimestamp: Date.UTC(2026, 10, 24, 16, 0),
    marketId,
    marketType,
    selectionKey: 'home',
    label,
    odds,
    bookmaker: null,
    pModel: 0.55,
    pStress: 0.51,
    pFair: 0.48,
    edge: 0.07,
    ev: 0.1,
    evStress: 0.02,
    aiScore,
    band,
    confidence: 0.8,
    disagreement: 0.03,
    stakePct: 0.01,
    frameworkStatus: null,
    frameworkConfidence: null,
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
    reasons: [],
    risks: [],
  };
}

function makeBriefing(generatedAt: string, modelVersion: string, topOdds: number): AiBriefingResponse {
  return {
    dateIso,
    displayDate: 'Tuesday, November 24, 2026',
    strategy: 'balanced',
    generatedAt,
    modelVersion,
    narrativeProvider: null,
    narrativeNote: '',
    avgClv: null,
    marketFilter: 'all',
    competitionFilter: 'all',
    summary: 'Test briefing.',
    inputs: [],
    picks: [
      makePick('f1', 'f1-1x2-h', 'Home Win', '1X2', topOdds, 92, 'High'),
      makePick('f2', 'f2-1x2-d', 'Draw', '1X2', 3, 75, 'Solid'),
      makePick('f3', 'f3-1x2-h', 'Home Win', '1X2', 2.5, 65, 'Moderate'),
      makePick('f4', 'f4-dnb-h', 'Home', 'Draw No Bet', 2, 85, 'High'),
    ],
    diagnostics: {
      fixturesScanned: 4,
      marketsScanned: 4,
      eligibleMarkets: 4,
      excludedStarted: 0,
      excludedNoModel: 0,
      excludedNegativeEv: 0,
      cacheNote: '',
    },
    disclaimer: 'Research estimates, not certainties.',
  };
}

function row(report: AiPerformanceResponse, key: string) {
  const found = report.rows.find((item) => item.key === key);
  assert.ok(found, `expected a ${key} row`);
  return found;
}

test('grades archived picks by model-score band with one row per fixture/market', async (t) => {
  await useDataDirs(t);
  await recordAiBriefing(scope, makeBriefing('2026-11-24T08:00:00.000Z', 'v1', 2));
  await recordAiBriefing(scope, makeBriefing('2026-11-24T09:00:00.000Z', 'v2', 4));

  const report = await computeAiPerformance();

  assert.equal(report.sample.snapshots, 2);
  assert.equal(report.sample.archivedPicks, 8);
  assert.equal(report.sample.dedupedPicks, 4);
  assert.equal(report.sample.settled, 3);
  assert.equal(report.sample.wins, 2);
  assert.equal(report.sample.losses, 1);
  assert.equal(report.sample.voids, 1);
  assert.equal(report.sample.pending, 0);

  const overall = row(report, 'overall');
  assert.equal(overall.hitRate, 66.7);
  assert.equal(overall.profitUnits, 6);
  assert.equal(overall.roiPct, 200);

  const top = row(report, 'score-90');
  assert.equal(top.settled, 1);
  assert.equal(top.profitUnits, 4);
  assert.equal(top.roiPct, 400);

  const middle = row(report, 'score-70');
  assert.equal(middle.settled, 1);
  assert.equal(middle.profitUnits, 3);

  const low = row(report, 'score-60');
  assert.equal(low.settled, 1);
  assert.equal(low.profitUnits, -1);
  assert.equal(low.roiPct, -100);
});

test('model-version and date filters narrow the archived sample', async (t) => {
  await useDataDirs(t);
  await recordAiBriefing(scope, makeBriefing('2026-11-24T08:00:00.000Z', 'v1', 2));
  await recordAiBriefing(scope, makeBriefing('2026-11-24T09:00:00.000Z', 'v2', 4));

  const older = await computeAiPerformance({ modelVersion: 'v1' });
  assert.equal(older.sample.snapshots, 1);
  assert.equal(row(older, 'overall').profitUnits, 4);

  const empty = await computeAiPerformance({ fromDateIso: '2026-11-25' });
  assert.equal(empty.sample.dedupedPicks, 0);
  assert.equal(row(empty, 'overall').hitRate, null);
  assert.equal(row(empty, 'overall').roiPct, null);
});
