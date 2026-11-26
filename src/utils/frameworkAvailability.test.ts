import assert from 'node:assert/strict';
import test from 'node:test';
import type { Fixture, FrameworkSlateSummary } from '../types/fixtures.ts';
import { noQualifiedPicksCopy } from './frameworkAvailability.ts';

function framework(overrides: Partial<FrameworkSlateSummary> = {}): FrameworkSlateSummary {
  return {
    version: '1.2',
    modelVersion: 'test',
    fixturesAssessed: 10,
    fixturesWithModel: 2,
    qualifiedMarkets: 0,
    reviewMarkets: 0,
    screenOnlyMarkets: 0,
    rejectedMarkets: 0,
    insufficientMarkets: 0,
    note: 'No market cleared every framework gate; the board is screening only.',
    ...overrides,
  };
}

function pricedFixture(id: string): Fixture {
  return {
    id,
    homeTeam: 'Home',
    awayTeam: 'Away',
    competition: 'League',
    country: 'World',
    matchDate: '26 Nov 2026',
    matchDateIso: '2026-11-26',
    kickoffTime: '19:45 CAT',
    status: 'Scheduled',
    venue: '',
    formHome: '',
    formAway: '',
    tacticalSummary: '',
    recommendedPickId: '',
    hasLiveOdds: false,
    markets: [
      {
        id: `${id}-m`,
        marketType: '1X2',
        label: 'Home Win',
        odds: 2.1,
        impliedProbability: 47.6,
        rationale: '',
      },
    ],
  };
}

test('a slate with qualified picks gets no drought copy', () => {
  assert.equal(noQualifiedPicksCopy(framework({ qualifiedMarkets: 1 })), null);
  assert.equal(noQualifiedPicksCopy(undefined), null);
});

test('zero qualified markets explains that auto-build cannot add legs', () => {
  const copy = noQualifiedPicksCopy(
    framework({ fixturesWithModel: 2, rejectedMarkets: 3, insufficientMarkets: 5 }),
    [pricedFixture('a'), pricedFixture('b')]
  );
  assert.ok(copy);
  assert.match(copy.headline, /qualified picks/i);
  assert.match(copy.detail, /2 priced matches/);
  assert.match(copy.detail, /manually/i);
});

test('a slate with no assessed fixtures gets a different explanation', () => {
  const copy = noQualifiedPicksCopy(framework({ fixturesAssessed: 0 }));
  assert.ok(copy);
  assert.match(copy.headline, /could be assessed/i);
  assert.match(copy.detail, /another matchday/i);
});

test('a lone priced match uses singular wording', () => {
  const copy = noQualifiedPicksCopy(framework(), [pricedFixture('a')]);
  assert.ok(copy);
  assert.match(copy.detail, /1 priced match is on the board/);
});
