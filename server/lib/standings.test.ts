import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFixture, makeMarket } from '../../src/utils/testFactories.ts';
import {
  clearStandingsCache,
  enrichWithStandings,
  mapStandingsByTeam,
  positionsFromMap,
  type RawApiStandingsLeague,
} from './standings.ts';

const standings: RawApiStandingsLeague[] = [
  {
    league: {
      id: 123,
      season: 2026,
      standings: [
        [
          { rank: 1, team: { id: 10, name: 'Železničar Pančevo' } },
          { rank: 4, team: { id: 11, name: 'Homeboyz' } },
          { rank: 11, team: { id: 12, name: 'Shabana' } },
          { rank: 0, team: { id: 13, name: 'Unranked' } },
        ],
      ],
    },
  },
];

test('maps ranks by team id and accent-insensitive name', () => {
  const byTeam = mapStandingsByTeam({ response: standings });

  assert.equal(byTeam.get('id:11'), 4);
  assert.equal(byTeam.get('name:homeboyz'), 4);
  assert.equal(byTeam.get('name:zeleznicarpancevo'), 1);
  assert.equal(byTeam.has('name:unranked'), false);
});

test('prefers team ids but falls back to names for older fixtures', () => {
  const byTeam = mapStandingsByTeam({ response: standings });

  assert.deepEqual(
    positionsFromMap(byTeam, {
      homeTeam: 'Homeboyz',
      awayTeam: 'Shabana',
      homeTeamId: 11,
      awayTeamId: 12,
    }),
    { home: 4, away: 11 }
  );
  assert.deepEqual(
    positionsFromMap(byTeam, {
      homeTeam: 'homeboyz',
      awayTeam: 'shabana',
    }),
    { home: 4, away: 11 }
  );
});

test('missing teams produce no position rather than a guessed one', () => {
  const byTeam = mapStandingsByTeam({ response: standings });
  assert.deepEqual(
    positionsFromMap(byTeam, {
      homeTeam: 'Unknown FC',
      awayTeam: 'Shabana',
    }),
    { home: undefined, away: 11 }
  );
});

test('enrichment freezes standings onto a picked fixture', async () => {
  const previousKey = process.env.API_FOOTBALL_KEY;
  const previousBase = process.env.API_FOOTBALL_BASE_URL;
  const originalFetch = globalThis.fetch;
  process.env.API_FOOTBALL_KEY = 'test-key';
  process.env.API_FOOTBALL_BASE_URL = 'https://api-football.test';

  let calls = 0;
  globalThis.fetch = (async (input) => {
    calls += 1;
    assert.match(String(input), /\/standings/);
    return new Response(JSON.stringify({ response: standings }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  clearStandingsCache();
  try {
    const fixture = makeFixture({
      id: 'picked',
      homeTeam: 'Homeboyz',
      awayTeam: 'Shabana',
      matchDateIso: '2026-11-25',
      leagueId: 123,
      leagueSeason: 2026,
      markets: [makeMarket('picked-1x2-h', 2, '1X2', 'Home Win')],
    });

    await enrichWithStandings([fixture], new Set(['picked']));

    assert.equal(fixture.positionHome, 4);
    assert.equal(fixture.positionAway, 11);
    assert.ok(fixture.standingsAt);
    assert.equal(calls, 1);
  } finally {
    clearStandingsCache();
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.API_FOOTBALL_KEY;
    else process.env.API_FOOTBALL_KEY = previousKey;
    if (previousBase === undefined) delete process.env.API_FOOTBALL_BASE_URL;
    else process.env.API_FOOTBALL_BASE_URL = previousBase;
  }
});
