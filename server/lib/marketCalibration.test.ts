import test from 'node:test';
import assert from 'node:assert/strict';
import type { MarketFrameworkAssessment } from '../../src/framework/assessment.ts';
import type {
  Fixture,
  MarketType,
  PriceQuality,
} from '../../src/types/fixtures.ts';
import type {
  LedgerFile,
  LedgerLeg,
  LedgerTicket,
} from '../../src/types/ledger.ts';
import { computeMarketCalibration } from './marketCalibration.ts';

function finishedFixture(id: string, home: number, away: number): Fixture {
  return {
    id,
    homeTeam: 'Home FC',
    awayTeam: 'Away FC',
    competition: 'Premier League',
    country: 'England',
    matchDate: '22 Nov 2026',
    matchDateIso: '2026-11-22',
    kickoffTime: '18:00 CAT',
    status: 'Finished',
    score: { home, away },
    venue: 'Home Park',
    formHome: '',
    formAway: '',
    tacticalSummary: '',
    recommendedPickId: `${id}-1x2-h`,
    hasLiveOdds: false,
    markets: [],
  };
}

function framework(pModel: number): MarketFrameworkAssessment {
  return {
    marketId: 'm',
    selectionKey: '1X2-H',
    status: 'QUALIFIED',
    reasonCodes: [],
    pModel,
    pFair: 0.45,
    edge: 0.05,
    relativeEdge: 0.1,
    ev: 0.1,
    evStress: 0.08,
    pStress: pModel - 0.02,
    fairOdds: 2.2,
    confidence: 'High',
    confidenceDowngrades: [],
    flags: [],
    marketContext: null,
    oddsAgeSeconds: 0,
    marketComplete: true,
    benchmarkBook: 'Book A',
    executionBook: 'Book A',
    value: null,
  };
}

function leg(
  fixtureId: string,
  pModel: number | null,
  priceQuality: PriceQuality = 'prematch'
): LedgerLeg {
  const marketId = `${fixtureId}-1x2-h`;
  return {
    fixtureId,
    homeTeam: 'Home FC',
    awayTeam: 'Away FC',
    competition: 'Premier League',
    matchDate: '22 Nov 2026',
    kickoffTime: '18:00 CAT',
    marketId,
    marketLabel: 'Home Win',
    marketType: '1X2' as MarketType,
    odds: 2.1,
    impliedProbability: 47.6,
    fairProbability: 45,
    rationale: 'test leg',
    priceQuality,
    framework: pModel === null ? undefined : framework(pModel),
  };
}

function ticket(id: string, legs: LedgerLeg[], status: LedgerTicket['status']): LedgerTicket {
  return {
    id,
    dateIso: '2026-11-22',
    createdAt: '2026-11-22T10:00:00.000Z',
    kind: 'strategy',
    strategy: 'balanced',
    label: 'Test',
    targetOdds: 2,
    maxLegs: 1,
    priceQuality: 'prematch',
    legCount: legs.length,
    totalOdds: 2.1,
    fairProbability: 0.45,
    stake: 1,
    status,
    legs,
  };
}

test('market calibration uses settled prematch model probabilities once per selection', () => {
  const fixtures = new Map<string, Fixture>([
    ['f1', finishedFixture('f1', 2, 0)],
    ['f2', finishedFixture('f2', 0, 1)],
    ['f3', finishedFixture('f3', 1, 0)],
    ['f4', finishedFixture('f4', 1, 0)],
  ]);
  const ledger: LedgerFile = {
    version: 1,
    updatedAt: '2026-11-22T12:00:00.000Z',
    tickets: [
      ticket('t1', [leg('f1', 0.8)], 'Win'),
      ticket('t2', [leg('f2', 0.3)], 'Lost'),
      // Same selection repeated by another strategy: not independent evidence.
      ticket('t3', [leg('f1', 0.8)], 'Win'),
      // Live prices and missing model probabilities cannot calibrate a model.
      ticket('t4', [leg('f3', 0.9, 'live')], 'Win'),
      ticket('t5', [leg('f4', null)], 'Win'),
      // Open tickets have no outcome yet.
      ticket('t6', [leg('f1', 0.8)], 'Pending'),
    ],
  };

  const calibration = computeMarketCalibration(ledger, fixtures);

  assert.deepEqual(calibration['1X2-H'], { settled: 2, brier: 0.065 });
  assert.deepEqual(Object.keys(calibration), ['1X2-H']);
});

test('missing archive fixtures and void outcomes contribute no calibration record', () => {
  const fixtures = new Map<string, Fixture>([
    ['f1', { ...finishedFixture('f1', 2, 0), status: 'Void' }],
  ]);
  const ledger: LedgerFile = {
    version: 1,
    updatedAt: '2026-11-22T12:00:00.000Z',
    tickets: [
      ticket('t1', [leg('f1', 0.8)], 'Win'),
      ticket('t2', [leg('missing', 0.8)], 'Win'),
    ],
  };

  assert.deepEqual(computeMarketCalibration(ledger, fixtures), {});
});
