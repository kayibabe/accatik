import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFixture } from '../../src/utils/testFactories.ts';
import { resultsFromFinishedFixture } from './frameworkHistory.ts';

test('a finished fixture becomes one home and one away result', () => {
  const fixture = makeFixture({
    id: '1001',
    status: 'Finished',
    matchDateIso: '2026-11-20',
    score: { home: 3, away: 1 },
  });

  const rows = resultsFromFinishedFixture(fixture);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    fixtureId: '1001',
    teamId: 'England::home fc',
    opponentId: 'England::away fc',
    goalsFor: 3,
    goalsAgainst: 1,
    home: true,
    dateIso: '2026-11-20',
    competitionId: 'England::premier league',
  });
  assert.deepEqual(rows[1], {
    fixtureId: '1001',
    teamId: 'England::away fc',
    opponentId: 'England::home fc',
    goalsFor: 1,
    goalsAgainst: 3,
    home: false,
    dateIso: '2026-11-20',
    competitionId: 'England::premier league',
  });
});

test('an unfinished fixture or a missing score contributes no history', () => {
  const scheduled = makeFixture({
    id: '1002',
    status: 'Scheduled',
    score: { home: null, away: null },
  });
  const noScore = makeFixture({
    id: '1003',
    status: 'Finished',
    score: { home: null, away: null },
  });

  assert.deepEqual(resultsFromFinishedFixture(scheduled), []);
  assert.deepEqual(resultsFromFinishedFixture(noScore), []);
});

test('a 0-0 is real history, not a missing result', () => {
  const fixture = makeFixture({
    id: '1004',
    status: 'Finished',
    score: { home: 0, away: 0 },
  });

  const rows = resultsFromFinishedFixture(fixture);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].goalsFor, 0);
  assert.equal(rows[1].goalsFor, 0);
});
