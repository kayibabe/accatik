import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Fixture } from '../../src/types/fixtures.ts';
import type { MarketFrameworkAssessment } from '../../src/framework/assessment.ts';
import type { FrameworkStatus } from '../../src/framework/config.ts';
import { makeFixture, makeMarket } from '../../src/utils/testFactories.ts';
import {
  buildDecisionRecords,
  clearDecisionLogCache,
  decisionLogDir,
  isoWeekKey,
  priorWeeklyStakeUnits,
  readDecisionFile,
  writeDecisionRecords,
  type FrameworkDecisionRecord,
} from './frameworkDecisionLog.ts';

const nowMs = Date.UTC(2026, 10, 22, 12);
const dateIso = '2026-11-22';

async function useDecisionDir(t: Pick<TestContext, 'after'>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matchslip-decisions-'));
  const previous = process.env.MATCHSLIP_FRAMEWORK_DECISIONS_DIR;
  process.env.MATCHSLIP_FRAMEWORK_DECISIONS_DIR = dir;
  clearDecisionLogCache();
  t.after(async () => {
    if (previous === undefined) delete process.env.MATCHSLIP_FRAMEWORK_DECISIONS_DIR;
    else process.env.MATCHSLIP_FRAMEWORK_DECISIONS_DIR = previous;
    clearDecisionLogCache();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

function marketDecision(
  marketId: string,
  status: FrameworkStatus = 'QUALIFIED',
  overrides: Partial<MarketFrameworkAssessment> = {}
): MarketFrameworkAssessment {
  return {
    marketId,
    selectionKey: '1X2-H',
    status,
    reasonCodes: [],
    pModel: 0.6,
    pFair: 0.55,
    edge: 0.05,
    relativeEdge: 0.1,
    ev: 0.06,
    evStress: 0.02,
    pStress: 0.56,
    fairOdds: 1.82,
    confidence: 'Medium',
    confidenceDowngrades: [],
    flags: [],
    marketContext: null,
    oddsAgeSeconds: 42,
    marketComplete: true,
    benchmarkBook: 'Sharp',
    executionBook: 'Book A',
    value: null,
    ...overrides,
  };
}

function assessedFixture(
  id: string = 'f1',
  matchDate: string = dateIso
): Fixture {
  const market = makeMarket(`${id}-1x2-h`, 2.1, '1X2', 'Home Win', 'Book A');
  market.framework = marketDecision(market.id);
  return makeFixture({
    id,
    matchDateIso: matchDate,
    status: 'Scheduled',
    statusShort: 'NS',
    priceQuality: 'prematch',
    score: { home: null, away: null },
    pricedAt: new Date(nowMs).toISOString(),
    markets: [market, makeMarket(`${id}-unassessed`, 3, '1X2', 'Draw')],
    framework: {
      version: '1.2',
      modelVersion: 'test-model',
      status: 'QUALIFIED',
      confidence: 'Medium',
      dataOk: true,
      flags: [],
      reasonCodes: [],
      model: null,
      summary: 'test summary',
      counts: {
        qualified: 1,
        review: 0,
        screenOnly: 0,
        rejected: 0,
        insufficient: 0,
      },
    },
  });
}

function seededRecord(
  id: string,
  matchDate: string,
  staked: boolean
): FrameworkDecisionRecord {
  const fixture = assessedFixture(id, matchDate);
  fixture.markets[0].framework = {
    ...fixture.markets[0].framework!,
    staked,
  };
  return buildDecisionRecords([fixture], nowMs)[0];
}

test('builds one immutable record per assessed market with its price snapshot', () => {
  const [record] = buildDecisionRecords([assessedFixture()], nowMs);
  const fixture = assessedFixture();

  assert.equal(buildDecisionRecords([fixture], nowMs).length, 1);
  assert.equal(record.decisionId, `${dateIso}:f1:f1-1x2-h`);
  assert.equal(record.frameworkVersion, '1.2');
  assert.equal(record.modelVersion, 'test-model');
  assert.equal(record.decidedAt, new Date(nowMs).toISOString());
  assert.equal(record.selectionKey, '1X2-H');
  assert.equal(record.status, 'QUALIFIED');
  assert.equal(record.odds, 2.1);
  assert.equal(record.executionBook, 'Book A');
  assert.equal(record.oddsAgeSeconds, 42);
  assert.deepEqual(record.oddsSnapshot, {
    odds: 2.1,
    bookmaker: 'Book A',
    capturedAt: new Date(nowMs).toISOString(),
    matchDateIso: dateIso,
    fixtureStatus: 'Scheduled',
  });
  assert.equal(record.staked, false);
  assert.deepEqual(record.capReasonCodes, []);
});

test('copies mutable decision arrays instead of aliasing the assessment', () => {
  const decision = marketDecision('m1', 'REJECTED', {
    reasonCodes: ['EDGE_BELOW_MIN'],
    confidenceDowngrades: ['LOW_SAMPLE'],
    flags: ['LOW_SCORING_WARNING'],
  });
  const fixture = assessedFixture();
  fixture.markets[0].framework = decision;
  const record = buildDecisionRecords([fixture], nowMs)[0];
  record.reasonCodes.push('SLATE_CAP_EXCEEDED');
  record.confidenceDowngrades.push('ODDS_STALE');
  record.flags.push('DRAW_RISK');

  assert.deepEqual(decision.reasonCodes, ['EDGE_BELOW_MIN']);
  assert.deepEqual(decision.confidenceDowngrades, ['LOW_SAMPLE']);
  assert.deepEqual(decision.flags, ['LOW_SCORING_WARNING']);
});

test('isoWeekKey uses Monday-based ISO weeks across year boundaries', () => {
  assert.equal(isoWeekKey('2026-11-22'), '2026-W47');
  assert.equal(isoWeekKey('2026-11-16'), '2026-W47');
  assert.equal(isoWeekKey('2026-01-01'), '2026-W01');
  assert.equal(isoWeekKey('2023-01-01'), '2022-W52');
  assert.equal(isoWeekKey('2027-01-01'), '2026-W53');
  assert.equal(isoWeekKey('not-a-date'), '');
});

test('writes atomically and upserts decisions by id in a temp directory', async (t) => {
  const dir = await useDecisionDir(t);
  assert.equal(decisionLogDir(), dir);

  const initial = buildDecisionRecords([assessedFixture()], nowMs);
  await writeDecisionRecords(dateIso, initial, nowMs);

  const refined: FrameworkDecisionRecord[] = initial.map((record) => ({
    ...record,
    status: 'REJECTED' as const,
    reasonCodes: ['EDGE_BELOW_MIN'] as FrameworkDecisionRecord['reasonCodes'],
    staked: true,
  }));
  const extra: FrameworkDecisionRecord = {
    ...initial[0],
    decisionId: `${dateIso}:f1:f1-goals`,
    marketId: 'f1-goals',
    selectionKey: 'GOALS-O2.5',
  };
  await writeDecisionRecords(dateIso, [...refined, extra], nowMs + 1000);

  clearDecisionLogCache();
  const file = await readDecisionFile(dateIso, nowMs + 2000);
  assert.ok(file);
  assert.equal(file.decisions.length, 2);
  assert.deepEqual(
    file.decisions.map((record) => record.decisionId),
    [`${dateIso}:f1:f1-1x2-h`, `${dateIso}:f1:f1-goals`]
  );
  assert.equal(file.decisions[0].status, 'REJECTED');
  assert.deepEqual(file.decisions[0].reasonCodes, ['EDGE_BELOW_MIN']);
  assert.equal(file.decisions[0].staked, true);
  assert.equal(file.decisions[1].status, 'QUALIFIED');
  assert.equal(file.createdAt, new Date(nowMs).toISOString());
  assert.equal(file.updatedAt, new Date(nowMs + 1000).toISOString());
});

test('priorWeeklyStakeUnits counts only staked decisions earlier in the same ISO week', async (t) => {
  await useDecisionDir(t);

  await writeDecisionRecords(
    '2026-11-20',
    [seededRecord('same-week', '2026-11-20', true)],
    nowMs
  );
  await writeDecisionRecords(
    '2026-11-18',
    [seededRecord('same-week-unstaked', '2026-11-18', false)],
    nowMs
  );
  await writeDecisionRecords(
    '2026-11-15',
    [seededRecord('previous-week', '2026-11-15', true)],
    nowMs
  );
  await writeDecisionRecords(
    dateIso,
    [seededRecord('current-day', dateIso, true)],
    nowMs + 1000
  );

  assert.deepEqual(await priorWeeklyStakeUnits(dateIso, nowMs + 2000), {
    units: 1,
    weekKey: '2026-W47',
  });
  assert.deepEqual(await priorWeeklyStakeUnits('bad-date', nowMs + 2000), {
    units: 0,
    weekKey: '',
  });
});
