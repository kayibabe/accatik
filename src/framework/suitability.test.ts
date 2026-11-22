import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessIndexFlags,
  assessMarketSuitability,
  favouriteAttack,
  favouriteSide,
} from './suitability.ts';

interface FixtureCase {
  id: string;
  attack: { home: number; away: number };
  defence: { home: number; away: number };
  expected: string[];
}

const cases: FixtureCase[] = [
  {
    id: 'FX-001',
    attack: { home: 0.81, away: 0.19 },
    defence: { home: 0.62, away: 0.38 },
    expected: ['ONE_SIDED_ATTACK', 'DEFENSIVE_WALL_WARNING'],
  },
  {
    id: 'FX-002',
    attack: { home: 0.48, away: 0.52 },
    defence: { home: 0.63, away: 0.38 },
    expected: ['BALANCED_ATTACK_WEAK_DEFENCE'],
  },
  {
    id: 'FX-003',
    attack: { home: 0.75, away: 0.25 },
    defence: { home: 0.8, away: 0.2 },
    expected: ['ONE_SIDED_ATTACK', 'DEFENSIVE_WALL_WARNING'],
  },
  {
    id: 'FX-004',
    attack: { home: 0.46, away: 0.54 },
    defence: { home: 0.13, away: 0.88 },
    expected: [
      'DEFENSIVE_WALL_WARNING',
      'BALANCED_ATTACK_WEAK_DEFENCE',
      'SIGNAL_CONFLICT',
    ],
  },
  {
    id: 'FX-005',
    attack: { home: 0.55, away: 0.45 },
    defence: { home: 0.57, away: 0.43 },
    expected: [],
  },
  {
    id: 'FX-006',
    attack: { home: 0.3, away: 0.7 },
    defence: { home: 0.67, away: 0.33 },
    expected: [],
  },
  {
    id: 'FX-007',
    attack: { home: 0.14, away: 0.86 },
    defence: { home: 0.55, away: 0.45 },
    expected: ['ONE_SIDED_ATTACK'],
  },
  {
    id: 'FX-008',
    attack: { home: 0.4, away: 0.6 },
    defence: { home: 0.17, away: 0.83 },
    expected: [
      'DEFENSIVE_WALL_WARNING',
      'BALANCED_ATTACK_WEAK_DEFENCE',
      'SIGNAL_CONFLICT',
    ],
  },
  {
    id: 'FX-009',
    attack: { home: 0.36, away: 0.64 },
    defence: { home: 0.5, away: 0.5 },
    expected: [],
  },
];

function favouriteFor(testCase: FixtureCase): {
  home: number;
  draw: number;
  away: number;
} {
  const homeStronger = testCase.attack.home > testCase.attack.away;
  return homeStronger
    ? { home: 0.6, draw: 0.25, away: 0.15 }
    : { home: 0.15, draw: 0.25, away: 0.6 };
}

for (const testCase of cases) {
  test(`${testCase.id} produces the recorded §5.3 flags`, () => {
    const flags = assessIndexFlags({
      attack: testCase.attack,
      defence: testCase.defence,
      fair1x2: favouriteFor(testCase),
      model1x2: favouriteFor(testCase),
    });
    assert.deepEqual(flags, testCase.expected);
  });
}

test('an attack index of exactly 30% is on the band edge, not below it', () => {
  const flags = assessIndexFlags({
    attack: { home: 0.3, away: 0.7 },
    defence: { home: 0.55, away: 0.45 },
    fair1x2: { home: 0.15, draw: 0.25, away: 0.6 },
    model1x2: { home: 0.15, draw: 0.25, away: 0.6 },
  });
  assert.deepEqual(flags, []);
});

test('a one-point attack tie tests both defences for the wall', () => {
  const flags = assessIndexFlags({
    attack: { home: 0.5, away: 0.5 },
    defence: { home: 0.65, away: 0.35 },
    fair1x2: { home: 0.6, draw: 0.25, away: 0.15 },
    model1x2: { home: 0.6, draw: 0.25, away: 0.15 },
  });
  assert.ok(flags.includes('DEFENSIVE_WALL_WARNING'));
});

test('an index pair that does not sum to 100% is invalid on its own', () => {
  const flags = assessIndexFlags({
    attack: { home: 0.7, away: 0.5 },
    defence: { home: 0.5, away: 0.5 },
  });
  assert.deepEqual(flags, ['INDEX_SUM_INVALID']);
});

test('the favourite is read from the benchmark, then the model', () => {
  const attack = { home: 0.45, away: 0.55 };
  assert.equal(favouriteSide({ home: 0.6, draw: 0.25, away: 0.15 }), 'home');
  assert.equal(favouriteSide(null, { home: 0.2, draw: 0.3, away: 0.5 }), 'away');
  assert.equal(favouriteAttack(attack, { home: 0.6, draw: 0.25, away: 0.15 }), 0.45);
});

test('FAVOURITE_WEAK_ATTACK fires when the favourite attacks below 50%', () => {
  const flags = assessIndexFlags({
    attack: { home: 0.45, away: 0.55 },
    defence: { home: 0.55, away: 0.45 },
    fair1x2: { home: 0.6, draw: 0.25, away: 0.15 },
    model1x2: { home: 0.6, draw: 0.25, away: 0.15 },
  });
  assert.deepEqual(flags, ['FAVOURITE_WEAK_ATTACK']);
});

test('DRAW_RISK fires when the top side and draw are within the band', () => {
  const flags = assessMarketSuitability({
    attack: { home: 0.55, away: 0.45 },
    defence: { home: 0.55, away: 0.45 },
    model1x2: { home: 0.45, draw: 0.45, away: 0.1 },
  });
  assert.deepEqual(flags, ['DRAW_RISK']);
});

test('DRAW_RISK does not fire when the top side is clearly ahead', () => {
  const flags = assessMarketSuitability({
    attack: { home: 0.55, away: 0.45 },
    defence: { home: 0.55, away: 0.45 },
    model1x2: { home: 0.6, draw: 0.25, away: 0.15 },
  });
  assert.deepEqual(flags, []);
});
