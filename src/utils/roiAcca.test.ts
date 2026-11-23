import test from 'node:test';
import assert from 'node:assert/strict';
import type { Fixture } from '../types/fixtures.ts';
import type { FeaturedPickSource, RoiRegistryEntry } from '../types/analytics.ts';
import {
  buildRoiAcca,
  guardRoiAcca,
  isLiveStakingRequest,
} from './roiAcca.ts';
import { makeFixture, makeMarket } from './testFactories.ts';

function entry(
  source: FeaturedPickSource,
  selectionKey: string,
  overrides: Partial<RoiRegistryEntry> = {}
): RoiRegistryEntry {
  return {
    strategy: 'balanced',
    source,
    selectionKey,
    marketType: '1X2',
    label: selectionKey,
    settled: 80,
    wins: 70,
    losses: 10,
    roi: 3.1,
    roiCiLow: 0.5,
    roiCiHigh: 6,
    hitRateCiLow: 70,
    hitRateCiHigh: 95,
    avgOdds: 1.2,
    firstDateIso: '2026-10-01',
    lastDateIso: '2026-11-20',
    status: 'promoted',
    promotedAt: '2026-11-20',
    lastSeenDateIso: '2026-11-20',
    qualifyingStreak: 2,
    failingStreak: 0,
    reason: 'Promoted: positive clustered ROI.',
    snapshotDateIso: '2026-11-20',
    ...overrides,
  };
}

function homeFixture(id: string, odds = 1.35): Fixture {
  return makeFixture({
    id,
    status: 'Scheduled',
    statusShort: 'NS',
    priceQuality: 'prematch',
    score: { home: null, away: null },
    kickoffTimestamp: Date.UTC(2026, 10, 20, 16),
    recommendedPickId: `${id}-1x2-h`,
    markets: [makeMarket(`${id}-1x2-h`, odds, '1X2', 'Home FC Win')],
  });
}

const later = Date.UTC(2026, 10, 20, 10);

test('uses only promoted pairs and reaches a 5.00 target without padding', () => {
  const fixtures = Array.from({ length: 6 }, (_, i) => homeFixture(`f${i}`));
  const registry = [entry('angle', '1X2-H')];

  const built = buildRoiAcca(fixtures, registry, 'balanced', {
    targetOdds: 5,
    maxLegs: 8,
    nowMs: later,
  });

  assert.equal(built.legs.length, 6);
  assert.equal(built.targetReached, true);
  assert.ok(built.totalOdds >= 5);
  assert.equal(new Set(built.legs.map((leg) => leg.fixtureId)).size, 6);
  assert.ok(built.legs.every((leg) => leg.marketId.endsWith('-1x2-h')));
});

test('never combines two selections from one fixture', () => {
  const fixture = makeFixture({
    id: 'multi',
    status: 'Scheduled',
    statusShort: 'NS',
    priceQuality: 'prematch',
    score: { home: null, away: null },
    kickoffTimestamp: Date.UTC(2026, 10, 20, 16),
    recommendedPickId: 'multi-1x2-h',
    markets: [
      makeMarket('multi-1x2-h', 1.35, '1X2', 'Home FC Win'),
      makeMarket('multi-ou-25', 1.25, 'Goals', 'Over 2.5 Goals'),
    ],
  });
  const registry = [entry('angle', '1X2-H'), entry('cover', 'GOALS-O2.5')];

  const built = buildRoiAcca([fixture], registry, 'balanced', {
    targetOdds: 5,
    maxLegs: 8,
    nowMs: later,
  });

  assert.equal(built.legs.length, 1);
  assert.ok(
    built.rejected.some((row) => row.reason.includes('already on the ticket'))
  );
});

test('rejects opposite DNB sides from the same match', () => {
  const fixture = makeFixture({
    id: 'dnb',
    status: 'Scheduled',
    statusShort: 'NS',
    priceQuality: 'prematch',
    score: { home: null, away: null },
    kickoffTimestamp: Date.UTC(2026, 10, 20, 16),
    recommendedPickId: 'dnb-dnb-h',
    modelAdvice: 'Away Win',
    analystNoteMarketId: 'dnb-dnb-a',
    markets: [
      makeMarket('dnb-dnb-h', 1.5, 'Draw No Bet', '1 (DNB)'),
      makeMarket('dnb-dnb-a', 2.1, 'Draw No Bet', '2 (DNB)'),
    ],
  });
  const registry = [entry('angle', 'DNB-1'), entry('note', 'DNB-2')];

  const built = buildRoiAcca([fixture], registry, 'balanced', {
    targetOdds: 5,
    maxLegs: 8,
    nowMs: later,
  });

  assert.equal(built.legs.length, 1);
  assert.ok(
    built.rejected.some((row) => row.reason.includes('already on the ticket'))
  );
});

test('leaves the ticket short instead of adding non-qualifying legs', () => {
  const fixtures = [homeFixture('a'), homeFixture('b')];
  const registry = [entry('angle', '1X2-H')];

  const built = buildRoiAcca(fixtures, registry, 'balanced', {
    targetOdds: 5,
    maxLegs: 8,
    nowMs: later,
  });

  assert.equal(built.legs.length, 2);
  assert.equal(built.targetReached, false);
  assert.ok(built.totalOdds < 5);
});

test('ignores watched selections, started fixtures and non-prematch prices', () => {
  const upcoming = homeFixture('up');
  const started = homeFixture('started');
  started.kickoffTimestamp = later - 1;
  const live = homeFixture('live');
  live.priceQuality = 'live';

  const registry = [
    entry('angle', '1X2-H', { status: 'watch' }),
  ];
  const promoted = [entry('angle', '1X2-H')];

  assert.equal(
    buildRoiAcca([upcoming], registry, 'balanced', { targetOdds: 5, maxLegs: 8, nowMs: later }).legs.length,
    0
  );
  const built = buildRoiAcca(
    [started, live, upcoming],
    promoted,
    'balanced',
    { targetOdds: 5, maxLegs: 8, nowMs: later }
  );
  assert.deepEqual(
    built.legs.map((leg) => leg.fixtureId),
    ['up']
  );
});

test('research guard trims long tickets to five legs and never recommends them', () => {
  const legs = Array.from({ length: 6 }, (_, i) => homeFixture(`g${i}`)).map(
    (fixture) => ({
      fixtureId: fixture.id,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      competition: fixture.competition,
      kickoffTime: fixture.kickoffTime,
      marketId: `${fixture.id}-1x2-h`,
      marketLabel: 'Home FC Win',
      marketType: '1X2' as const,
      odds: 1.35,
      impliedProbability: 74.1,
      fairProbability: 65,
      rationale: '',
    })
  );
  const graded = guardRoiAcca(legs);

  assert.equal(graded.recommended, false);
  assert.equal(graded.economics.legCount, 5);
  assert.match(graded.riskWarning, /Research only/);
  assert.match(graded.reason, /not a recommendation/);
});

test('generated tickets cannot be turned into live stakes', () => {
  assert.equal(isLiveStakingRequest({ strategy: 'balanced' }), false);
  assert.equal(isLiveStakingRequest({ targetOdds: 5, maxLegs: 8 }), false);
  assert.equal(isLiveStakingRequest(null), false);

  assert.equal(isLiveStakingRequest({ stake: 100 }), true);
  assert.equal(isLiveStakingRequest({ stakeAmount: 10 }), true);
  assert.equal(isLiveStakingRequest({ placeBet: true }), true);
  assert.equal(isLiveStakingRequest({ live: true }), true);
  assert.equal(isLiveStakingRequest({ mode: 'live' }), true);
  assert.equal(isLiveStakingRequest({ recommended: true }), true);
});
