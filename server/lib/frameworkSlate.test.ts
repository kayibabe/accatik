import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Fixture, MarketOption } from '../../src/types/fixtures.ts';
import type { MarketFrameworkAssessment } from '../../src/framework/assessment.ts';
import type { FrameworkStatus } from '../../src/framework/config.ts';
import { evaluateValue } from '../../src/framework/value.ts';
import { makeFixture, makeMarket } from '../../src/utils/testFactories.ts';
import {
  buildDecisionRecords,
  clearDecisionLogCache,
  readDecisionFile,
  writeDecisionRecords,
} from './frameworkDecisionLog.ts';
import { applyFrameworkSlateControls } from './frameworkSlate.ts';

const nowMs = Date.UTC(2026, 10, 22, 12);
const dateIso = '2026-11-22';

async function useDecisionDir(t: Pick<TestContext, 'after'>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matchslip-slate-decisions-'));
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

function decision(
  marketId: string,
  selectionKey: string,
  evStress: number,
  status: FrameworkStatus = 'QUALIFIED'
): MarketFrameworkAssessment {
  const value = evaluateValue({ pModel: 0.7, pFair: 0.5, odds: 2 });
  return {
    marketId,
    selectionKey,
    status,
    reasonCodes: [],
    pModel: 0.7,
    pFair: 0.5,
    edge: 0.2,
    relativeEdge: 0.4,
    ev: 0.4,
    evStress,
    pStress: 0.68,
    fairOdds: 1.43,
    confidence: 'Medium',
    confidenceDowngrades: [],
    flags: [],
    marketContext: null,
    oddsAgeSeconds: 0,
    marketComplete: true,
    benchmarkBook: 'Sharp',
    executionBook: 'Book A',
    value: { ...value, evStress },
  };
}

function assessedMarket(
  id: string,
  selectionKey: string,
  evStress: number
): MarketOption {
  return Object.assign(makeMarket(id, 2, '1X2', selectionKey, 'Book A'), {
    framework: decision(id, selectionKey, evStress),
  });
}

function assessedFixture(
  id: string,
  primaryEv: number,
  competition = 'Premier League'
): Fixture {
  return makeFixture({
    id,
    homeTeam: `${id} Home`,
    awayTeam: `${id} Away`,
    country: 'England',
    competition,
    matchDateIso: dateIso,
    status: 'Scheduled',
    statusShort: 'NS',
    priceQuality: 'prematch',
    score: { home: null, away: null },
    pricedAt: new Date(nowMs).toISOString(),
    markets: [
      assessedMarket(`${id}-h`, '1X2-H', primaryEv),
      assessedMarket(`${id}-a`, '1X2-A', primaryEv - 0.05),
    ],
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
        qualified: 2,
        review: 0,
        screenOnly: 0,
        rejected: 0,
        insufficient: 0,
      },
    },
  });
}

test('applies slate caps, writes verdicts back, and persists the decisions', async (t) => {
  await useDecisionDir(t);
  const fixtures = [
    assessedFixture('f1', 0.3),
    assessedFixture('f2', 0.2),
    assessedFixture('f3', 0.1),
  ];

  const result = await applyFrameworkSlateControls(fixtures, dateIso, nowMs);

  const [first, second, third] = result.fixtures;
  assert.equal(first.markets[0].framework?.staked, true);
  assert.deepEqual(first.markets[0].framework?.capReasonCodes, []);
  assert.equal(first.markets[1].framework?.status, 'CONDITIONAL_REVIEW');
  assert.ok(
    first.markets[1].framework?.reasonCodes.includes('SAME_FIXTURE_SECONDARY')
  );
  assert.deepEqual(first.markets[1].framework?.capReasonCodes, [
    'SAME_FIXTURE_SECONDARY',
  ]);

  assert.equal(second.markets[0].framework?.staked, true);
  assert.equal(second.markets[1].framework?.status, 'CONDITIONAL_REVIEW');

  assert.equal(third.markets[0].framework?.status, 'QUALIFIED');
  assert.equal(third.markets[0].framework?.staked, false);
  assert.ok(
    third.markets[0].framework?.reasonCodes.includes('SLATE_CAP_EXCEEDED')
  );
  assert.deepEqual(third.markets[0].framework?.capReasonCodes, [
    'SLATE_CAP_EXCEEDED',
  ]);

  assert.equal(result.caps.cutByCaps, 1);
  assert.equal(result.caps.priorWeeklyStakeUnits, 0);
  assert.equal(result.weekKey, '2026-W47');

  clearDecisionLogCache();
  const file = await readDecisionFile(dateIso, nowMs + 2000);
  assert.ok(file);
  assert.equal(file.decisions.length, 6);
  const byId = new Map(
    file.decisions.map((record) => [record.decisionId, record])
  );
  assert.equal(byId.get(`${dateIso}:f1:f1-h`)?.staked, true);
  assert.deepEqual(byId.get(`${dateIso}:f1:f1-a`)?.capReasonCodes, [
    'SAME_FIXTURE_SECONDARY',
  ]);
  assert.deepEqual(byId.get(`${dateIso}:f3:f3-h`)?.capReasonCodes, [
    'SLATE_CAP_EXCEEDED',
  ]);
});

test('prior weekly stakes reduce the slate exposure before staking', async (t) => {
  await useDecisionDir(t);
  const priorFixture = assessedFixture('prior', 0.4);
  const [base] = buildDecisionRecords([priorFixture], nowMs);
  const prior = Array.from({ length: 19 }, (_, index) => ({
    ...base,
    decisionId: `${dateIso}:prior:${index}`,
    marketId: `prior-${index}`,
    matchDateIso: '2026-11-20',
    staked: true,
  }));
  await writeDecisionRecords('2026-11-20', prior, nowMs);

  const result = await applyFrameworkSlateControls(
    [
      assessedFixture('f1', 0.3, 'League A'),
      assessedFixture('f2', 0.2, 'League B'),
    ],
    dateIso,
    nowMs + 1000
  );

  const firstSecondary = result.fixtures[0]?.markets[0]?.framework;
  const secondPrimary = result.fixtures[1]?.markets[0]?.framework;
  assert.equal(firstSecondary?.staked, true);
  assert.equal(secondPrimary?.staked, false);
  assert.ok(secondPrimary?.capReasonCodes?.includes('SLATE_CAP_EXCEEDED'));
  assert.equal(result.caps.priorWeeklyStakeUnits, 19);
  assert.equal(result.caps.remainingWeeklyExposureUnits, 0);
  assert.equal(result.weekKey, '2026-W47');
});
