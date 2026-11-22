import test from 'node:test';
import assert from 'node:assert/strict';
import type { ConfidenceClass, FrameworkStatus } from './config.ts';
import { evaluateValue } from './value.ts';
import type { SlateCandidate } from './slate.ts';
import { applySlateCaps } from './slate.ts';

function candidate(
  fixtureId: string,
  options: {
    leagueId?: string;
    evStress?: number;
    confidence?: ConfidenceClass;
    oddsAgeSeconds?: number;
    status?: FrameworkStatus;
    market?: string;
    marketId?: string;
  } = {}
): SlateCandidate {
  const value = evaluateValue({ pModel: 0.7, pFair: 0.5, odds: 2 });
  return {
    fixtureId,
    marketId: options.marketId ?? `${fixtureId}-${options.market ?? '1X2-H'}`,
    leagueId: options.leagueId ?? 'league-1',
    homeTeamId: `${fixtureId}-home`,
    awayTeamId: `${fixtureId}-away`,
    market: options.market ?? '1X2-H',
    status: options.status ?? 'QUALIFIED',
    reasonCodes: [],
    value: { ...value, evStress: options.evStress ?? value.evStress },
    confidence: options.confidence ?? 'Medium',
    oddsAgeSeconds: options.oddsAgeSeconds ?? 0,
  };
}

test('FX-V07: the higher stressed EV survives; the second fixture market is held', () => {
  const result = applySlateCaps([
    candidate('fixture-1', { evStress: 0.1 }),
    candidate('fixture-1', { evStress: 0.3, market: 'GOALS-O2.5' }),
  ]);

  const byMarket = new Map(result.candidates.map((entry) => [entry.market, entry]));
  assert.equal(byMarket.get('GOALS-O2.5')?.status, 'QUALIFIED');
  assert.equal(byMarket.get('GOALS-O2.5')?.staked, true);
  assert.equal(byMarket.get('1X2-H')?.status, 'CONDITIONAL_REVIEW');
  assert.deepEqual(byMarket.get('1X2-H')?.reasonCodes, ['SAME_FIXTURE_SECONDARY']);
  assert.equal(byMarket.get('1X2-H')?.staked, false);
});

test('duplicate selection keys on one fixture are ranked independently', () => {
  const result = applySlateCaps([
    candidate('fixture-1', { marketId: 'row-a', evStress: 0.2 }),
    candidate('fixture-1', { marketId: 'row-b', evStress: 0.3 }),
  ]);

  const byId = new Map(result.candidates.map((entry) => [entry.marketId, entry]));
  assert.equal(byId.get('row-b')?.staked, true);
  assert.equal(byId.get('row-a')?.status, 'CONDITIONAL_REVIEW');
  assert.deepEqual(byId.get('row-a')?.reasonCodes, ['SAME_FIXTURE_SECONDARY']);
});

test('the per-league cap cuts the lowest-ranked qualified selection', () => {
  const result = applySlateCaps(
    [
      candidate('fixture-1', { evStress: 0.3 }),
      candidate('fixture-2', { evStress: 0.2 }),
      candidate('fixture-3', { evStress: 0.1 }),
    ],
    { maxPerLeague: 2, maxDailySelections: 10, maxPerTeam: 10 }
  );

  const cut = result.candidates.filter((entry) =>
    entry.reasonCodes.includes('SLATE_CAP_EXCEEDED')
  );
  assert.equal(cut.length, 1);
  assert.equal(cut[0].fixtureId, 'fixture-3');
  assert.equal(cut[0].status, 'QUALIFIED');
  assert.equal(cut[0].staked, false);
  assert.equal(result.summary.cutByCaps, 1);
});

test('the per-team cap sees both sides of a fixture', () => {
  const first = candidate('fixture-1', { evStress: 0.3 });
  const second = candidate('fixture-2', { evStress: 0.2 });
  second.homeTeamId = first.homeTeamId;

  const result = applySlateCaps([first, second], {
    maxPerLeague: 10,
    maxPerTeam: 1,
    maxDailySelections: 10,
  });

  assert.equal(
    result.candidates.find((entry) => entry.fixtureId === 'fixture-2')?.staked,
    false
  );
});

test('the daily selection cap is also the flat-stake exposure cap', () => {
  const result = applySlateCaps(
    [
      candidate('fixture-1', { evStress: 0.3 }),
      candidate('fixture-2', { evStress: 0.2 }),
    ],
    { maxDailySelections: 1, maxPerLeague: 10, maxPerTeam: 10 }
  );

  assert.equal(result.candidates.filter((entry) => entry.staked).length, 1);
  assert.equal(result.candidates.filter((entry) => entry.staked)[0].fixtureId, 'fixture-1');
});

test('ranking is stressed EV, then confidence, then fresher odds', () => {
  const result = applySlateCaps(
    [
      candidate('fixture-1', { evStress: 0.2, confidence: 'Low', oddsAgeSeconds: 0 }),
      candidate('fixture-2', { evStress: 0.2, confidence: 'High', oddsAgeSeconds: 30 }),
      candidate('fixture-3', { evStress: 0.2, confidence: 'High', oddsAgeSeconds: 10 }),
    ],
    { maxDailySelections: 2, maxPerLeague: 10, maxPerTeam: 10 }
  );

  // The returned array keeps input order; the staked set reflects the ranking.
  const staked = result.candidates
    .filter((entry) => entry.staked)
    .map((entry) => entry.fixtureId)
    .sort();
  assert.deepEqual(staked, ['fixture-2', 'fixture-3']);
  assert.equal(
    result.candidates.find((entry) => entry.fixtureId === 'fixture-1')?.staked,
    false
  );
});

test('non-qualified candidates are not staked or re-ranked', () => {
  const result = applySlateCaps([
    candidate('fixture-1', { status: 'CONDITIONAL_REVIEW' }),
    candidate('fixture-2', { status: 'SCREEN_ONLY' }),
  ]);
  assert.equal(result.candidates.every((entry) => entry.staked === false), true);
  assert.equal(result.summary.qualified, 0);
});

test('weekly exposure caps staking after earlier stakes in the week', () => {
  const result = applySlateCaps(
    [candidate('fixture-1'), candidate('fixture-2'), candidate('fixture-3')],
    { maxWeeklyExposureUnits: 3, priorWeeklyStakeUnits: 2 }
  );

  assert.equal(result.candidates.filter((entry) => entry.staked).length, 1);
  assert.equal(result.summary.priorWeeklyStakeUnits, 2);
  assert.equal(result.summary.remainingWeeklyExposureUnits, 0);
  assert.equal(
    result.candidates.filter((entry) =>
      entry.reasonCodes.includes('SLATE_CAP_EXCEEDED')
    ).length,
    2
  );
  // Cut on exposure, not on merit: the selection stays QUALIFIED.
  assert.equal(
    result.candidates.filter((entry) => entry.status === 'QUALIFIED').length,
    3
  );
});
