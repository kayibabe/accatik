import test from 'node:test';
import assert from 'node:assert/strict';
import type { FrameworkModelInput } from './model.ts';
import type { AssessmentFixtureInput } from './assessment.ts';
import { assessFixtureFramework } from './assessment.ts';

const now = Date.UTC(2026, 10, 22, 10);
const pricedAt = new Date(now).toISOString();

const modelInput: FrameworkModelInput = {
  lambdaHome: 1.8,
  lambdaAway: 0.9,
  rho: 0,
  attackHome: 1.2,
  attackAway: 0.8,
  defenceHome: 0.9,
  defenceAway: 1.1,
  formHome: 70,
  formAway: 45,
  failedToScoreHome: 0.15,
  failedToScoreAway: 0.2,
  sampleHome: 10,
  sampleAway: 10,
  leagueMatches: 60,
  leagueUsedFallback: false,
  modelVersion: 'test-model',
  confidence: 'High',
  dataOk: true,
  providerAudited: false,
};

function fixture(
  overrides: Partial<AssessmentFixtureInput> = {}
): AssessmentFixtureInput {
  const markets = [
    { id: 'f-1x2-h', selectionKey: '1X2-H', odds: 2.2, bookmaker: 'Book A' },
    { id: 'f-1x2-d', selectionKey: '1X2-D', odds: 3.4, bookmaker: 'Book A' },
    { id: 'f-1x2-a', selectionKey: '1X2-A', odds: 3.2, bookmaker: 'Book A' },
    { id: 'f-ou-25', selectionKey: 'GOALS-O2.5', odds: 1.9, bookmaker: 'Book A' },
    { id: 'f-ou-u25', selectionKey: 'GOALS-U2.5', odds: 1.95, bookmaker: 'Book A' },
    { id: 'f-btts-yes', selectionKey: 'BTTS-YES', odds: 1.8, bookmaker: 'Book A' },
    { id: 'f-btts-no', selectionKey: 'BTTS-NO', odds: 2.0, bookmaker: 'Book A' },
  ];
  return {
    id: 'f',
    homeTeam: 'Home FC',
    awayTeam: 'Away FC',
    competition: 'Premier League',
    country: 'England',
    matchDateIso: '2026-11-22',
    kickoffTimestamp: now + 60 * 60 * 1000,
    status: 'Scheduled',
    pricedAt,
    markets,
    allMarkets: markets,
    ...overrides,
  };
}

test('a priced fixture with a passing model produces a QUALIFIED market', () => {
  const assessment = assessFixtureFramework(fixture(), [], {
    nowMs: now,
    modelInput,
  });
  const home = assessment.markets.find((market) => market.selectionKey === '1X2-H');
  assert.equal(home?.status, 'QUALIFIED');
  assert.ok((home?.pModel ?? 0) > 0.55);
  assert.ok((home?.pFair ?? 0) > 0.4);
  assert.ok((home?.edge ?? 0) > 0.15);
  assert.equal(assessment.status, 'QUALIFIED');
  assert.equal(assessment.dataOk, true);
});

test('no model input means INSUFFICIENT_DATA, not an invented probability', () => {
  const assessment = assessFixtureFramework(fixture(), [], { nowMs: now });
  assert.equal(assessment.status, 'INSUFFICIENT_DATA');
  assert.equal(assessment.dataOk, false);
  assert.equal(assessment.model, null);
  assert.ok(
    assessment.markets.every(
      (market) => market.status === 'INSUFFICIENT_DATA' && market.pModel === null
    )
  );
});

test('a one-sided market is held as INCOMPLETE_MARKET', () => {
  const markets = [
    { id: 'f-ou-u45', selectionKey: 'GOALS-U4.5', odds: 1.5, bookmaker: 'Book A' },
  ];
  const assessment = assessFixtureFramework(
    fixture({ markets, allMarkets: markets }),
    [],
    { nowMs: now, modelInput }
  );
  const market = assessment.markets[0];
  assert.equal(market.marketComplete, false);
  assert.equal(market.status, 'CONDITIONAL_REVIEW');
  assert.ok(market.reasonCodes.includes('INCOMPLETE_MARKET'));
});

test('stale odds hold every passing market', () => {
  const stale = new Date(now - 9 * 60 * 60 * 1000).toISOString();
  const assessment = assessFixtureFramework(fixture({ pricedAt: stale }), [], {
    nowMs: now,
    modelInput,
  });
  const home = assessment.markets.find((market) => market.selectionKey === '1X2-H');
  assert.equal(home?.status, 'CONDITIONAL_REVIEW');
  assert.ok(home?.reasonCodes.includes('STALE_ODDS'));
});

test('provider comparative indices drive the §5.3 flags', () => {
  // A price that clears the value gate, so the suitability reject is the
  // deciding reason rather than an earlier hard-fail.
  const markets = fixture().markets.map((market) =>
    market.selectionKey === 'BTTS-YES' ? { ...market, odds: 4.0 } : market
  );
  const assessment = assessFixtureFramework(
    fixture({
      markets,
      allMarkets: markets,
      providerIndices: {
        attackHome: 0.81,
        attackAway: 0.19,
        defenceHome: 0.62,
        defenceAway: 0.38,
      },
    }),
    [],
    { nowMs: now, modelInput }
  );
  assert.ok(assessment.flags.includes('ONE_SIDED_ATTACK'));
  assert.ok(assessment.flags.includes('DEFENSIVE_WALL_WARNING'));
  const btts = assessment.markets.find((market) => market.selectionKey === 'BTTS-YES');
  assert.equal(btts?.status, 'REJECTED');
  assert.deepEqual(btts?.reasonCodes, ['MARKET_UNSUITABLE']);
});

test('every market assessment records the explainability fields', () => {
  const assessment = assessFixtureFramework(fixture(), [], {
    nowMs: now,
    modelInput,
  });
  for (const market of assessment.markets) {
    assert.equal(typeof market.status, 'string');
    assert.ok(Array.isArray(market.reasonCodes));
    assert.equal(market.benchmarkBook, 'Book A');
    assert.equal(market.executionBook, 'Book A');
    assert.ok(market.oddsAgeSeconds !== null);
  }
});
