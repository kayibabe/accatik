import test from 'node:test';
import assert from 'node:assert/strict';
import type { TeamMatchResult } from './model.ts';
import {
  buildLeagueBaseline,
  buildModelInput,
  buildTeamStrength,
} from './model.ts';

const competition = 'England::Premier League';

function pair(
  fixtureId: string,
  dateIso: string,
  homeId: string,
  awayId: string,
  homeGoals: number,
  awayGoals: number
): TeamMatchResult[] {
  return [
    {
      fixtureId,
      teamId: homeId,
      opponentId: awayId,
      goalsFor: homeGoals,
      goalsAgainst: awayGoals,
      home: true,
      dateIso,
      competitionId: competition,
    },
    {
      fixtureId,
      teamId: awayId,
      opponentId: homeId,
      goalsFor: awayGoals,
      goalsAgainst: homeGoals,
      home: false,
      dateIso,
      competitionId: competition,
    },
  ];
}

function history(): TeamMatchResult[] {
  const results: TeamMatchResult[] = [];
  for (let i = 0; i < 6; i += 1) {
    results.push(
      ...pair(`a-c-${i}`, `2026-09-${String(i + 1).padStart(2, '0')}`, 'A', 'C', 2, 0)
    );
    results.push(
      ...pair(`c-a-${i}`, `2026-09-${String(i + 7).padStart(2, '0')}`, 'C', 'A', 1, 1)
    );
    results.push(
      ...pair(`b-d-${i}`, `2026-09-${String(i + 1).padStart(2, '0')}`, 'B', 'D', 0, 1)
    );
    results.push(
      ...pair(`d-b-${i}`, `2026-09-${String(i + 7).padStart(2, '0')}`, 'D', 'B', 2, 0)
    );
  }
  return results;
}

test('the league baseline separates home and away scoring', () => {
  const baseline = buildLeagueBaseline(history(), competition);
  assert.equal(baseline.matches, 24);
  assert.equal(baseline.usedFallback, false);
  assert.ok(baseline.homeGoals > baseline.awayGoals);
});

test('venue-aware strength is shrunk towards the league average', () => {
  const results = history();
  const baseline = buildLeagueBaseline(results, competition);
  const strength = buildTeamStrength(
    results,
    'A',
    'home',
    baseline,
    '2026-10-01'
  );
  assert.ok(strength);
  assert.equal(strength?.matches, 6);
  // Raw attack is 2.0 divided by the home baseline; six matches at k=6 shrink
  // it halfway towards the league average of 1.0.
  const rawAttack = 2 / baseline.homeGoals;
  const expectedAttack = (6 * rawAttack + 6) / 12;
  assert.ok(Math.abs((strength?.attack ?? 0) - expectedAttack) < 1e-9);
  assert.ok((strength?.form ?? 0) > 0);
});

test('the model input is positive and favours the stronger home side', () => {
  const input = buildModelInput({
    homeTeamId: 'A',
    awayTeamId: 'B',
    competitionId: competition,
    asOfIso: '2026-10-01',
    results: history(),
  });
  assert.ok(input);
  assert.ok(input?.lambdaHome > input?.lambdaAway!);
  assert.ok(input?.lambdaHome > 0 && input?.lambdaAway! > 0);
  assert.equal(input?.dataOk, true);
  assert.ok(['Low', 'Medium', 'High'].includes(input?.confidence ?? ''));
});

test('results on or after the decision date are excluded', () => {
  const base = buildModelInput({
    homeTeamId: 'A',
    awayTeamId: 'B',
    competitionId: competition,
    asOfIso: '2026-10-01',
    results: history(),
  });
  const leaked = history();
  leaked.push(
    ...pair('future', '2026-10-01', 'A', 'B', 10, 0)
  );
  const withFuture = buildModelInput({
    homeTeamId: 'A',
    awayTeamId: 'B',
    competitionId: competition,
    asOfIso: '2026-10-01',
    results: leaked,
  });
  assert.equal(base?.lambdaHome, withFuture?.lambdaHome);
  assert.equal(base?.lambdaAway, withFuture?.lambdaAway);
});

test('a team without enough history cannot be modelled', () => {
  assert.equal(
    buildModelInput({
      homeTeamId: 'A',
      awayTeamId: 'B',
      competitionId: competition,
      asOfIso: '2026-10-01',
      results: [],
    }),
    null
  );
});

test('a competition with too few matches falls back to the whole sample', () => {
  const results = history();
  const baseline = buildLeagueBaseline(results, 'Nowhere::Tiny League');
  assert.equal(baseline.usedFallback, true);
  assert.ok(baseline.matches > 0);
});
