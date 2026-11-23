import test from 'node:test';
import assert from 'node:assert/strict';
import type { FrameworkStatus } from './config.ts';
import type { AccumulatorLegInput } from './accumulator.ts';
import { evaluateAccumulator } from './accumulator.ts';

function leg(
  fixtureId: string,
  options: {
    leagueId?: string;
    status?: FrameworkStatus;
    odds?: number;
    pModel?: number;
    pStress?: number;
  } = {}
): AccumulatorLegInput {
  return {
    fixtureId,
    leagueId: options.leagueId ?? 'league-1',
    homeTeamId: `${fixtureId}-home`,
    awayTeamId: `${fixtureId}-away`,
    status: options.status ?? 'QUALIFIED',
    odds: options.odds ?? 2,
    value: {
      pModel: options.pModel ?? 0.7,
      pStress: options.pStress ?? 0.6,
    },
  };
}

test('two independent qualified legs with positive stressed EV are QUALIFIED', () => {
  const result = evaluateAccumulator([leg('fixture-1'), leg('fixture-2')]);
  assert.equal(result.status, 'QUALIFIED');
  assert.deepEqual(result.reasonCodes, []);
  assert.ok(result.metrics);
  assert.ok(result.metrics.ev > 0);
  assert.ok(result.metrics.evStress > 0);
});

test('FX-V10: a shared team is a dependence review, not a rejection', () => {
  const first = leg('fixture-1');
  const second = leg('fixture-2');
  second.homeTeamId = first.homeTeamId;

  const result = evaluateAccumulator([first, second]);
  assert.equal(result.status, 'CONDITIONAL_REVIEW');
  assert.deepEqual(result.reasonCodes, ['SHARED_TEAM_DEPENDENCE']);
});

test('a shared competition is reviewed only when configured', () => {
  const legs = [leg('fixture-1'), leg('fixture-2')];
  assert.equal(evaluateAccumulator(legs).status, 'QUALIFIED');
  assert.deepEqual(
    evaluateAccumulator(legs, { requireDistinctLeagues: true }).reasonCodes,
    ['SHARED_COMPETITION_DEPENDENCE']
  );
});

test('one leg and six legs are both invalid accumulator shapes', () => {
  assert.deepEqual(evaluateAccumulator([leg('fixture-1')]), {
    status: 'REJECTED',
    reasonCodes: ['INVALID_LEG_COUNT'],
    metrics: null,
  });
  assert.equal(
    evaluateAccumulator(
      Array.from({ length: 6 }, (_, index) => leg(`fixture-${index + 1}`))
    ).status,
    'REJECTED'
  );
});

test('five independent qualified legs are a valid accumulator', () => {
  const result = evaluateAccumulator(
    Array.from({ length: 5 }, (_, index) => leg(`fixture-${index + 1}`))
  );
  assert.equal(result.status, 'QUALIFIED');
  assert.deepEqual(result.reasonCodes, []);
});

test('every leg must be qualified as a single', () => {
  const result = evaluateAccumulator([
    leg('fixture-1'),
    leg('fixture-2', { status: 'CONDITIONAL_REVIEW' }),
  ]);
  assert.deepEqual(result.reasonCodes, ['UNQUALIFIED_LEG']);
});

test('same-fixture legs are a combination, not an accumulator', () => {
  const result = evaluateAccumulator([leg('fixture-1'), leg('fixture-1')]);
  assert.deepEqual(result.reasonCodes, ['SAME_FIXTURE_NOT_ACCA']);
});

test('a non-positive combined or stressed EV is rejected', () => {
  const result = evaluateAccumulator([
    leg('fixture-1', { pModel: 0.4, pStress: 0.35, odds: 2 }),
    leg('fixture-2', { pModel: 0.4, pStress: 0.35, odds: 2 }),
  ]);
  assert.deepEqual(result.reasonCodes, ['ACCA_NON_POSITIVE_EV']);
  assert.ok(result.metrics);
  assert.ok(result.metrics.ev <= 0);
});
