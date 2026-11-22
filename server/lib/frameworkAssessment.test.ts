import test from 'node:test';
import assert from 'node:assert/strict';
import type { Fixture } from '../../src/types/fixtures.ts';
import type { TeamMatchResult } from '../../src/framework/model.ts';
import { makeFixture, makeMarket } from '../../src/utils/testFactories.ts';
import {
  attachFrameworkAssessment,
  stripFrameworkFromFixture,
  summarizeFrameworkSlate,
} from './frameworkAssessment.ts';

const now = Date.UTC(2026, 10, 22, 10);
const competitionId = 'England::premier league';
const homeTeamId = 'England::home fc';
const awayTeamId = 'England::away fc';

function history(): TeamMatchResult[] {
  const rows: TeamMatchResult[] = [];
  for (let index = 0; index < 10; index += 1) {
    rows.push({
      fixtureId: `league-${index}`,
      teamId: `England::league-home-${index}`,
      opponentId: `England::league-away-${index}`,
      goalsFor: 1 + (index % 3),
      goalsAgainst: 1,
      home: true,
      dateIso: '2026-10-01',
      competitionId,
    });
    rows.push({
      fixtureId: `league-${index}`,
      teamId: `England::league-away-${index}`,
      opponentId: `England::league-home-${index}`,
      goalsFor: 1,
      goalsAgainst: 1 + (index % 3),
      home: false,
      dateIso: '2026-10-01',
      competitionId,
    });
  }
  for (let index = 0; index < 3; index += 1) {
    rows.push({
      fixtureId: `home-${index}`,
      teamId: homeTeamId,
      opponentId: `England::home-opponent-${index}`,
      goalsFor: 2,
      goalsAgainst: 1,
      home: true,
      dateIso: '2026-11-01',
      competitionId,
    });
    rows.push({
      fixtureId: `away-${index}`,
      teamId: awayTeamId,
      opponentId: `England::away-opponent-${index}`,
      goalsFor: 1,
      goalsAgainst: 2,
      home: false,
      dateIso: '2026-11-01',
      competitionId,
    });
  }
  return rows;
}

function fixture(): Fixture {
  return makeFixture({
    id: '1001',
    status: 'Scheduled',
    statusShort: 'NS',
    priceQuality: 'prematch',
    matchDateIso: '2026-11-22',
    kickoffTimestamp: now + 60 * 60 * 1000,
    pricedAt: new Date(now).toISOString(),
    score: { home: null, away: null },
    markets: [
      makeMarket('1001-1x2-h', 2.2, '1X2', 'Home Win', 'Book A'),
      makeMarket('1001-1x2-d', 3.4, '1X2', 'Draw', 'Book A'),
      makeMarket('1001-1x2-a', 3.2, '1X2', 'Away Win', 'Book A'),
      makeMarket('1001-ou-25', 1.9, 'Goals', 'Over 2.5 Goals', 'Book A'),
      makeMarket('1001-ou-u25', 1.95, 'Goals', 'Under 2.5 Goals', 'Book A'),
      makeMarket('1001-btts-yes', 1.8, 'BTTS', 'BTTS Yes', 'Book A'),
      makeMarket('1001-btts-no', 2, 'BTTS', 'BTTS No', 'Book A'),
    ],
  });
}

test('attaches a decision to every priced market and a fixture summary', () => {
  const attached = attachFrameworkAssessment(fixture(), history(), now);

  assert.ok(attached.framework);
  assert.notEqual(attached.framework?.status, 'INSUFFICIENT_DATA');
  assert.equal(attached.framework?.dataOk, true);
  assert.ok(attached.framework?.model);
  assert.equal(attached.markets.every((market) => market.framework), true);

  const counts = attached.framework!.counts;
  assert.equal(
    counts.qualified +
      counts.review +
      counts.screenOnly +
      counts.rejected +
      counts.insufficient,
    attached.markets.length
  );
});

test('insufficient history is reported as INSUFFICIENT_DATA, not invented', () => {
  const attached = attachFrameworkAssessment(fixture(), [], now);

  assert.equal(attached.framework?.status, 'INSUFFICIENT_DATA');
  assert.equal(attached.framework?.model, null);
  assert.equal(
    attached.markets.every(
      (market) => market.framework?.status === 'INSUFFICIENT_DATA'
    ),
    true
  );
});

test('stripping removes framework output without touching the prices', () => {
  const attached = attachFrameworkAssessment(fixture(), history(), now);
  const stripped = stripFrameworkFromFixture(attached);

  assert.equal(stripped.framework, undefined);
  assert.equal(stripped.markets.every((market) => market.framework === undefined), true);
  assert.deepEqual(
    stripped.markets.map((market) => [market.id, market.odds]),
    attached.markets.map((market) => [market.id, market.odds])
  );
});

test('the slate summary adds every fixture assessment', () => {
  const assessed = attachFrameworkAssessment(fixture(), history(), now);
  const unassessed = attachFrameworkAssessment(fixture(), [], now);
  const summary = summarizeFrameworkSlate([assessed, unassessed]);

  assert.equal(summary.fixturesAssessed, 2);
  assert.equal(summary.fixturesWithModel, 1);
  assert.equal(
    summary.qualifiedMarkets +
      summary.reviewMarkets +
      summary.screenOnlyMarkets +
      summary.rejectedMarkets +
      summary.insufficientMarkets,
    assessed.markets.length + unassessed.markets.length
  );
});
