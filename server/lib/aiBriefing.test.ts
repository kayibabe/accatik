import test from 'node:test';
import assert from 'node:assert/strict';
import type { MarketFrameworkAssessment } from '../../src/framework/assessment.ts';
import type { ReasonCode } from '../../src/framework/config.ts';
import type { Fixture, FixtureFrameworkSummary, MarketOption } from '../../src/types/fixtures.ts';
import type { PickAnalyticsResponse } from '../../src/types/analytics.ts';
import type { AiPick } from '../../src/types/ai.ts';
import { makeFixture, makeMarket } from '../../src/utils/testFactories.ts';
import {
  buildAiAccumulator,
  buildBriefing,
  poissonSelectionProbability,
  providerSelectionProbability,
} from './aiBriefing.ts';

const FUTURE_KICKOFF = Date.now() + 24 * 60 * 60 * 1000;

function assessment(
  overrides: Partial<MarketFrameworkAssessment> = {}
): MarketFrameworkAssessment {
  return {
    marketId: 'test-1x2-h',
    selectionKey: '1X2-H',
    status: 'QUALIFIED',
    reasonCodes: [],
    pModel: 0.5,
    pFair: 0.4,
    edge: 0.1,
    relativeEdge: 0.25,
    ev: 0.1,
    evStress: 0.05,
    pStress: 0.55,
    fairOdds: 2.5,
    confidence: 'High',
    confidenceDowngrades: [],
    flags: [],
    marketContext: null,
    oddsAgeSeconds: 0,
    marketComplete: true,
    benchmarkBook: 'Book A',
    executionBook: 'Book A',
    value: null,
    ...overrides,
  };
}

function frameworkSummary(): FixtureFrameworkSummary {
  return {
    version: '1.2',
    modelVersion: 'test-model',
    status: 'QUALIFIED',
    confidence: 'High',
    dataOk: true,
    flags: [],
    reasonCodes: [],
    model: {
      lambdaHome: 1.6,
      lambdaAway: 1.2,
      rho: -0.05,
      attackHome: 1,
      attackAway: 1,
      defenceHome: 1,
      defenceAway: 1,
      formHome: 0,
      formAway: 0,
      failedToScoreHome: 0.1,
      failedToScoreAway: 0.1,
      sampleHome: 20,
      sampleAway: 20,
      leagueMatches: 20,
      leagueUsedFallback: false,
    },
    summary: 'Test framework summary',
    counts: {
      qualified: 1,
      review: 0,
      screenOnly: 0,
      rejected: 0,
      insufficient: 0,
    },
  };
}

interface FixtureOptions {
  competition?: string;
  odds?: number;
  pModel?: number;
  pStress?: number;
  status?: Fixture['status'];
  withFramework?: boolean;
  assessmentStatus?: NonNullable<MarketOption['framework']>['status'];
  reasonCodes?: ReasonCode[];
}

function assessedFixture(id: string, options: FixtureOptions = {}): Fixture {
  const market: MarketOption = {
    ...makeMarket(`${id}-1x2-h`, options.odds ?? 2.1, '1X2', 'Home Win'),
    fairProbability: 45,
    framework:
      options.withFramework === false
        ? undefined
        : assessment({
            marketId: `${id}-1x2-h`,
            pModel: options.pModel ?? 0.6,
            pStress: options.pStress ?? 0.65,
            status: options.assessmentStatus ?? 'QUALIFIED',
            reasonCodes: options.reasonCodes ?? [],
          }),
  };
  return makeFixture({
    id,
    status: options.status ?? 'Scheduled',
    kickoffTimestamp: FUTURE_KICKOFF,
    score: { home: null, away: null },
    competition: options.competition ?? 'Premier League',
    markets: [market],
    allMarkets: [market],
    modelProbabilities: { home: 52, draw: 25, away: 23 },
    framework: frameworkSummary(),
  });
}

function analytics(): PickAnalyticsResponse {
  return {
    strategy: 'balanced',
    generatedAt: '2026-11-22T10:00:00.000Z',
    firstDateIso: null,
    lastDateIso: null,
    sampleDates: 3,
    sampleFixtures: 12,
    marketPicks: 0,
    stakePerPick: 1,
    priceQuality: { prematch: 0, live: 0, unknown: 0 },
    featured: [],
    featuredBySelection: [],
    marketsByType: [],
    marketsBySelection: [],
    daily: [],
  };
}

function aiPick(overrides: Partial<AiPick> = {}): AiPick {
  return {
    fixtureId: 'f1',
    homeTeam: 'Home FC',
    awayTeam: 'Away FC',
    competition: 'Premier League',
    country: 'England',
    kickoffTime: '18:00 CAT',
    kickoffTimestamp: FUTURE_KICKOFF,
    marketId: 'f1-1x2-h',
    marketType: '1X2',
    selectionKey: '1X2-H',
    label: 'Home Win',
    odds: 2.2,
    bookmaker: 'Book A',
    pModel: 0.55,
    pStress: 0.55,
    pFair: 0.4,
    edge: 0.15,
    ev: 0.21,
    evStress: 0.21,
    aiScore: 80,
    band: 'High',
    confidence: 0.9,
    disagreement: 0.05,
    stakePct: 0.01,
    frameworkStatus: 'QUALIFIED',
    frameworkConfidence: 'High',
    signals: {
      framework: 0.55,
      poisson: 0.5,
      provider: 0.52,
      bookFair: 0.4,
      historyRoi: null,
      historySample: 0,
      promoted: false,
    },
    reasons: [],
    risks: [],
    ...overrides,
  };
}

test('Poisson matrix produces coherent complementary selection probabilities', () => {
  const home = poissonSelectionProbability('1X2-H', 1.5, 1.5);
  const draw = poissonSelectionProbability('1X2-D', 1.5, 1.5);
  const away = poissonSelectionProbability('1X2-A', 1.5, 1.5);
  assert.ok(home !== null && draw !== null && away !== null);
  assert.ok(Math.abs(home + draw + away - 1) < 1e-9);
  assert.ok(Math.abs(home - away) < 1e-12);

  const dc = poissonSelectionProbability('DC-1X', 1.5, 1.5);
  assert.ok(dc !== null && Math.abs(dc - (home + draw)) < 1e-12);

  const dnbHome = poissonSelectionProbability('DNB-1', 1.5, 1.5);
  const dnbAway = poissonSelectionProbability('DNB-2', 1.5, 1.5);
  assert.ok(dnbHome !== null && dnbAway !== null);
  assert.ok(Math.abs(dnbHome + dnbAway - 1) < 1e-12);

  const over = poissonSelectionProbability('GOALS-O2.5', 1.5, 1.5);
  const under = poissonSelectionProbability('GOALS-U2.5', 1.5, 1.5);
  assert.ok(over !== null && under !== null);
  assert.ok(Math.abs(over + under - 1) < 1e-12);

  const bttsYes = poissonSelectionProbability('BTTS-YES', 1.5, 1.5);
  const bttsNo = poissonSelectionProbability('BTTS-NO', 1.5, 1.5);
  assert.ok(bttsYes !== null && bttsNo !== null);
  assert.ok(Math.abs(bttsYes + bttsNo - 1) < 1e-12);

  assert.equal(poissonSelectionProbability('ASIAN-H', 1.5, 1.5), null);
  assert.equal(poissonSelectionProbability('1X2-H', 0, 1.5), null);
  assert.equal(poissonSelectionProbability('1X2-H', null, 1.5), null);
});

test('provider 1X2 percentages map onto priced cover selections', () => {
  const fixture = makeFixture({
    id: 'provider',
    modelProbabilities: { home: 45, draw: 30, away: 25 },
  });

  assert.equal(providerSelectionProbability(fixture, '1X2-H'), 0.45);
  assert.equal(providerSelectionProbability(fixture, '1X2-D'), 0.3);
  assert.equal(providerSelectionProbability(fixture, '1X2-A'), 0.25);
  assert.equal(providerSelectionProbability(fixture, 'DC-1X'), 0.75);
  assert.equal(providerSelectionProbability(fixture, 'DC-X2'), 0.55);
  assert.ok(Math.abs((providerSelectionProbability(fixture, 'DNB-1') ?? 0) - 45 / 70) < 1e-12);
  assert.equal(providerSelectionProbability(fixture, 'BTTS-YES'), null);

  const missing = makeFixture({ id: 'missing' });
  assert.equal(providerSelectionProbability(missing, '1X2-H'), null);

  const invalid = makeFixture({
    id: 'invalid',
    modelProbabilities: { home: 110, draw: 30, away: 25 },
  });
  assert.equal(providerSelectionProbability(invalid, '1X2-H'), null);
});

test('briefing scores only eligible pre-match selections and keeps provenance', () => {
  const briefing = buildBriefing({
    fixtures: [
      assessedFixture('eligible'),
      assessedFixture('started', { status: 'Finished' }),
      assessedFixture('rejected', {
        assessmentStatus: 'REJECTED',
        reasonCodes: ['DATA_QUALITY_FAILURE'],
      }),
      assessedFixture('nomodel', { withFramework: false }),
      assessedFixture('negative', { pModel: 0.2, pStress: 0.2 }),
    ],
    dateIso: '2026-11-22',
    displayDate: '22 Nov 2026',
    strategy: 'balanced',
    marketFilter: 'all',
    competitionFilter: 'all',
    analytics: analytics(),
    combination: null,
    registry: [],
    qualified: null,
    ledger: null,
    sources: [{ title: 'Slate source', uri: 'https://example.test/slate' }],
    narratives: { 'eligible:eligible-1x2-h': 'Free-tier plain-English note.' },
  });

  assert.equal(briefing.picks.length, 1);
  assert.equal(briefing.diagnostics.fixturesScanned, 5);
  assert.equal(briefing.diagnostics.marketsScanned, 4);
  assert.equal(briefing.diagnostics.eligibleMarkets, 1);
  assert.equal(briefing.diagnostics.excludedStarted, 1);
  assert.equal(briefing.diagnostics.excludedNoModel, 1);
  assert.equal(briefing.diagnostics.excludedNegativeEv, 1);

  const pick = briefing.picks[0];
  assert.equal(pick.fixtureId, 'eligible');
  assert.ok(pick.evStress > 0);
  assert.ok(pick.signals.poisson !== null);
  assert.ok(pick.signals.provider !== null);
  assert.equal(pick.narrative, 'Free-tier plain-English note.');
  assert.match(pick.reasons.join(' '), /Stressed EV/);
  assert.ok(briefing.inputs.some((input) => input.page === 'AI Models'));
  assert.match(briefing.disclaimer, /Research and decision support only/);
});

test('value-only framework rejections are re-evaluated with an explicit risk flag', () => {
  const briefing = buildBriefing({
    fixtures: [
      assessedFixture('revalued', {
        assessmentStatus: 'REJECTED',
        reasonCodes: ['EDGE_BELOW_MIN'],
      }),
    ],
    dateIso: '2026-11-22',
    displayDate: '22 Nov 2026',
    strategy: 'balanced',
    marketFilter: 'all',
    competitionFilter: 'all',
    analytics: analytics(),
    combination: null,
    registry: [],
    qualified: null,
    ledger: null,
    sources: [],
  });

  assert.equal(briefing.picks.length, 1);
  assert.equal(briefing.picks[0].frameworkStatus, 'REJECTED');
  assert.ok(
    briefing.picks[0].risks.some((risk) => risk.includes('Framework rejected this market'))
  );
});

test('accumulator respects risk bands, fixture uniqueness and competition caps', () => {
  const home = aiPick({ fixtureId: 'a', competition: 'League A', odds: 2.2, pStress: 0.55 });
  const solid = aiPick({
    fixtureId: 'b',
    competition: 'League B',
    odds: 2,
    pStress: 0.56,
    band: 'Solid',
    aiScore: 76,
  });
  const lowerRanked = aiPick({
    fixtureId: 'c',
    competition: 'League C',
    odds: 3,
    pStress: 0.35,
    pModel: 0.35,
    pFair: 0.3,
    ev: 0.05,
    evStress: 0.05,
    band: 'Solid',
    aiScore: 55,
  });

  const ticket = buildAiAccumulator({
    dateIso: '2026-11-22',
    picks: [home, solid, lowerRanked],
    targetOdds: 3,
    maxLegs: 2,
    riskMode: 'conservative',
  });

  assert.equal(ticket.legs.length, 2);
  assert.deepEqual(
    ticket.legs.map((leg) => leg.band).sort(),
    ['High', 'Solid']
  );
  assert.equal(new Set(ticket.legs.map((leg) => leg.fixtureId)).size, 2);
  assert.equal(ticket.totalOdds, 4.4);
  assert.ok(Math.abs(ticket.hitProbability - 0.55 * 0.56) < 1e-12);
  assert.ok(ticket.stakePct <= 0.01);
  assert.equal(ticket.targetReached, true);
  assert.ok(ticket.rejected.some((row) => row.fixtureId === 'c'));

  const sameCompetition = buildAiAccumulator({
    dateIso: '2026-11-22',
    picks: [
      home,
      aiPick({ fixtureId: 'a2', competition: 'League A', odds: 2.1, pStress: 0.54 }),
      solid,
    ],
    targetOdds: 3,
    maxLegs: 3,
    riskMode: 'conservative',
  });
  assert.equal(new Set(sameCompetition.legs.map((leg) => leg.competition)).size, 2);

  const sameFixture = buildAiAccumulator({
    dateIso: '2026-11-22',
    picks: [home, aiPick({ fixtureId: 'a', marketId: 'a-1x2-a', odds: 2.1, pStress: 0.54 })],
    targetOdds: 3,
    maxLegs: 3,
    riskMode: 'conservative',
  });
  assert.equal(sameFixture.legs.length, 0);
  assert.match(sameFixture.reason, /No two selections/);
});

test('aggressive risk mode admits speculative picks that conservative mode rejects', () => {
  const high = aiPick({
    fixtureId: 'h',
    odds: 1.8,
    pStress: 0.62,
    pModel: 0.62,
    pFair: 0.55,
    ev: 0.116,
    evStress: 0.116,
    aiScore: 90,
  });
  const speculative = aiPick({
    fixtureId: 's',
    competition: 'Championship',
    odds: 4,
    pStress: 0.3,
    pModel: 0.3,
    pFair: 0.24,
    ev: 0.2,
    evStress: 0.2,
    aiScore: 42,
    band: 'Speculative',
    confidence: 0.3,
  });

  const conservative = buildAiAccumulator({
    dateIso: '2026-11-22',
    picks: [high, speculative],
    targetOdds: 3,
    maxLegs: 2,
    riskMode: 'conservative',
  });
  const aggressive = buildAiAccumulator({
    dateIso: '2026-11-22',
    picks: [high, speculative],
    targetOdds: 3,
    maxLegs: 2,
    riskMode: 'aggressive',
  });

  assert.equal(conservative.legs.length, 0);
  assert.equal(aggressive.legs.length, 2);
  assert.ok(aggressive.legs.some((leg) => leg.band === 'Speculative'));
  assert.ok(aggressive.totalOdds >= 3);

  const longshotA = aiPick({
    fixtureId: 'la',
    odds: 20,
    pStress: 0.055,
    pModel: 0.055,
    pFair: 0.05,
    ev: 0.1,
    evStress: 0.1,
    band: 'Speculative',
    confidence: 0.2,
  });
  const longshotTicket = buildAiAccumulator({
    dateIso: '2026-11-22',
    picks: [longshotA, aiPick({ fixtureId: 'lb', odds: 20, pStress: 0.055, band: 'Speculative' })],
    targetOdds: 3,
    maxLegs: 2,
    riskMode: 'aggressive',
  });
  assert.equal(longshotTicket.legs.length, 0);
  assert.match(longshotTicket.reason, /hit-probability gate/);
});
