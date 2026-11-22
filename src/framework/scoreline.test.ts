import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScorelineMatrix,
  dcTau,
  deriveMarketProbabilities,
  matrixConsistencyFailures,
  matrixProbability,
  poissonPmf,
  sameFixtureCombination,
} from './scoreline.ts';

const close = (a: number, b: number, tolerance = 1e-9): boolean =>
  Math.abs(a - b) <= tolerance;

test('Poisson pmf is a valid distribution', () => {
  const total = Array.from({ length: 40 }, (_, k) => poissonPmf(k, 1.6)).reduce(
    (sum, value) => sum + value,
    0
  );
  assert.ok(close(total, 1, 1e-12));
});

test('Poisson pmf rejects invalid inputs', () => {
  assert.throws(() => poissonPmf(-1, 1));
  assert.throws(() => poissonPmf(1.5, 1));
  assert.throws(() => poissonPmf(1, -0.1));
});

test('Dixon-Coles tau adjusts only the four low-score cells', () => {
  const lambdaHome = 1.5;
  const lambdaAway = 1.1;
  const rho = 0.04;
  assert.ok(close(dcTau(0, 0, lambdaHome, lambdaAway, rho), 1 - 1.5 * 1.1 * 0.04));
  assert.ok(close(dcTau(0, 1, lambdaHome, lambdaAway, rho), 1 + 1.5 * 0.04));
  assert.ok(close(dcTau(1, 0, lambdaHome, lambdaAway, rho), 1 + 1.1 * 0.04));
  assert.ok(close(dcTau(1, 1, lambdaHome, lambdaAway, rho), 1 - 0.04));
  assert.equal(dcTau(2, 0, lambdaHome, lambdaAway, rho), 1);
  assert.equal(dcTau(0, 2, lambdaHome, lambdaAway, rho), 1);
});

test('scoreline matrix normalises and records the omitted tail', () => {
  const built = buildScorelineMatrix(1.55, 1.1, 0.02, 10);
  const total = built.matrix.flat().reduce((sum, value) => sum + value, 0);
  assert.ok(close(total, 1, 1e-12));
  assert.ok(built.tail >= 0);
  assert.ok(built.tail < 1e-6);
});

test('a small truncation reports a large tail rather than hiding it', () => {
  const built = buildScorelineMatrix(1.55, 1.1, 0, 0);
  assert.ok(built.tail > 0.5);
});

test('rho outside the valid range fails loudly', () => {
  assert.throws(() => buildScorelineMatrix(2, 2, 0.5, 10), /negative/);
});

test('market derivation satisfies the §7.6 consistency identities', () => {
  const built = buildScorelineMatrix(1.7, 1.05, 0.03, 10);
  const probabilities = deriveMarketProbabilities(built.matrix);

  assert.ok(close(probabilities['1X2-H'] + probabilities['1X2-D'] + probabilities['1X2-A'], 1));
  assert.ok(close(probabilities['DC-1X'], probabilities['1X2-H'] + probabilities['1X2-D']));
  assert.ok(close(probabilities['DC-X2'], probabilities['1X2-D'] + probabilities['1X2-A']));
  assert.ok(close(probabilities['DC-12'], probabilities['1X2-H'] + probabilities['1X2-A']));
  assert.ok(close(probabilities['GOALS-O2.5'] + probabilities['GOALS-U2.5'], 1));
  assert.ok(close(probabilities['BTTS-YES'] + probabilities['BTTS-NO'], 1));
  assert.deepEqual(matrixConsistencyFailures(probabilities), []);
});

test('same-fixture combinations are summed from the joint matrix', () => {
  const built = buildScorelineMatrix(1.4, 1.2, 0, 10);
  const combination = sameFixtureCombination(
    built.matrix,
    (home, away) => away >= home && home + away <= 3
  );
  const manual =
    matrixProbability(built.matrix, (home, away) => home === 0 && away <= 3) +
    matrixProbability(built.matrix, (home, away) => home === 1 && away >= 1 && away <= 2);

  assert.ok(close(combination, manual, 1e-12));
  assert.ok(combination > 0 && combination < 1);
});

test('team-goal probabilities are internally consistent', () => {
  const built = buildScorelineMatrix(1.6, 1.2, 0, 10);
  const probabilities = deriveMarketProbabilities(built.matrix);
  for (const side of ['H', 'A']) {
    for (const line of [0.5, 1.5, 2.5]) {
      assert.ok(
        close(
          probabilities[`TEAM-${side}-O${line}`] +
            probabilities[`TEAM-${side}-U${line}`],
          1
        )
      );
    }
  }
});
