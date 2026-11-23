import test from 'node:test';
import assert from 'node:assert/strict';
import type { PositiveReadPick } from '../types/analytics.ts';
import {
  eligiblePositiveReadPicks,
  legFromPositiveReadPick,
  mergePositiveReadPicks,
} from './positiveReadSlip.ts';
import { makeLeg } from './testFactories.ts';

function makePick(
  fixtureId: string,
  overrides: Partial<PositiveReadPick> = {}
): PositiveReadPick {
  const base: PositiveReadPick = {
    comboKey: `note:High:${fixtureId}`,
    label: 'Analyst Note · High · Over 2.5 Goals',
    fixtureId,
    homeTeam: `Home ${fixtureId}`,
    awayTeam: `Away ${fixtureId}`,
    competition: 'Premier League',
    matchDate: '23 Nov 2026',
    kickoffTime: '18:00 CAT',
    marketId: `${fixtureId}-ou25o`,
    marketLabel: 'Over 2.5 Goals',
    marketType: 'Goals',
    odds: 2,
    impliedProbability: 50,
    fairProbability: 55,
    rationale: 'Study rationale',
    band: 'High',
    studyBand: 'High',
    bandDrift: false,
    status: 'Pending',
  };
  return { ...base, ...overrides };
}

test('positive-read picks copy their labelled market and price into a leg', () => {
  const pick = makePick('f1', {
    odds: 2.35,
    impliedProbability: 42.6,
    fairProbability: 48.1,
    bookmaker: 'Bet365',
  });

  assert.deepEqual(legFromPositiveReadPick(pick), {
    fixtureId: 'f1',
    homeTeam: 'Home f1',
    awayTeam: 'Away f1',
    competition: 'Premier League',
    matchDate: '23 Nov 2026',
    kickoffTime: '18:00 CAT',
    marketId: 'f1-ou25o',
    marketLabel: 'Over 2.5 Goals',
    marketType: 'Goals',
    odds: 2.35,
    impliedProbability: 42.6,
    fairProbability: 48.1,
    rationale: 'Study rationale',
    bookmaker: 'Bet365',
  });
});

test('add all eligible keeps every pick beyond the five-leg recommendation cap', () => {
  const picks = Array.from({ length: 7 }, (_, index) =>
    makePick(`f${index}`, { odds: 2 + index / 10 })
  );

  assert.equal(eligiblePositiveReadPicks(picks).length, 7);

  const merged = mergePositiveReadPicks([], picks);
  assert.equal(merged.length, 7);
  assert.equal(new Set(merged.map((leg) => leg.fixtureId)).size, 7);
  assert.deepEqual(
    merged.map((leg) => leg.odds),
    picks.map((pick) => pick.odds)
  );
});

test('a positive-read pick replaces the existing leg for its fixture', () => {
  const existing = makeLeg('f0', 'old-market', 1.8, { homeTeam: 'Old Home' });
  const replacement = makePick('f0', { odds: 2.4, rationale: '' });
  const added = makePick('f1');

  const merged = mergePositiveReadPicks([existing], [replacement, added]);

  assert.equal(merged.length, 2);
  assert.equal(merged[0].fixtureId, 'f0');
  assert.equal(merged[0].marketId, replacement.marketId);
  assert.equal(merged[0].odds, 2.4);
  assert.equal(merged[0].homeTeam, 'Home f0');
  assert.equal(merged[0].rationale, replacement.label);
  assert.equal(merged[1].fixtureId, 'f1');
  assert.deepEqual(existing, makeLeg('f0', 'old-market', 1.8, { homeTeam: 'Old Home' }));
});

test('settled picks are ignored and duplicate fixtures stay single-legged', () => {
  const settled = makePick('f0', { status: 'Lost' });
  const first = makePick('f1', { odds: 2.1 });
  const duplicate = makePick('f1', { odds: 3.1, marketId: 'f1-other' });

  const eligible = eligiblePositiveReadPicks([settled, first, duplicate]);
  assert.deepEqual(
    eligible.map((pick) => pick.odds),
    [2.1]
  );

  assert.equal(mergePositiveReadPicks([], [settled, first, duplicate]).length, 1);
  assert.equal(
    mergePositiveReadPicks([], [settled, first, duplicate])[0].marketId,
    first.marketId
  );
});
