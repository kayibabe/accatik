import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clipProbability,
  combinedEv,
  devig,
  evaluateValue,
  fairFromOneSide,
} from './value.ts';

const close = (a: number, b: number, tolerance = 1e-9): boolean =>
  Math.abs(a - b) <= tolerance;

test('proportional de-vig returns a complete distribution', () => {
  const fair = devig({ home: 2, draw: 3.5, away: 4 });
  const total = Object.values(fair).reduce((sum, value) => sum + value, 0);
  assert.ok(close(total, 1));
  assert.ok(fair.home > fair.draw && fair.draw > fair.away);
});

test('de-vig rejects incomplete or invalid markets', () => {
  assert.throws(() => devig({ home: 2 }));
  assert.throws(() => devig({ home: 1, draw: 3 }));
  assert.throws(() => devig({ home: 2, draw: 0 }));
});

test('one-sided fair probability is the proportional approximation', () => {
  assert.ok(close(fairFromOneSide(2, 0.05), 0.5 / 1.05));
  assert.throws(() => fairFromOneSide(1, 0.05));
});

test('probabilities are clipped away from zero and one', () => {
  assert.equal(clipProbability(0, 0.005), 0.005);
  assert.equal(clipProbability(1, 0.005), 0.995);
  assert.equal(clipProbability(0.4, 0.005), 0.4);
});

test('FX-V03: a +4.8 pp edge is rejected by the edge gate', () => {
  const value = evaluateValue({ pModel: 0.7, pFair: 0.652, odds: 1.5 });
  assert.ok(close(value.edge, 0.048));
  assert.deepEqual(value.hardFail, ['EDGE_BELOW_MIN']);
  assert.ok(value.ev > 0);
  assert.ok(value.evStress > 0);
});

test('FX-V02: a price below 1.30 is rejected by the odds floor', () => {
  const value = evaluateValue({ pModel: 0.85, pFair: 0.65, odds: 1.29 });
  assert.ok(value.hardFail.includes('ODDS_BELOW_MIN'));
  assert.ok(value.ev > 0);
  assert.ok(value.evStress > 0);
});

test('a model zero cannot manufacture an edge', () => {
  const value = evaluateValue({ pModel: 0, pFair: 0.045, odds: 4.5 });
  assert.equal(value.pModel, 0.005);
  assert.ok(value.edge < 0);
  assert.ok(value.hardFail.includes('EDGE_BELOW_MIN'));
});

test('stress EV shrinks the model a quarter of the way to the market', () => {
  const value = evaluateValue({ pModel: 0.8, pFair: 0.6, odds: 1.6 });
  assert.ok(close(value.pStress, 0.75));
  assert.ok(close(value.evStress, 0.75 * 1.6 - 1));
  assert.ok(value.evStress < value.ev);
});

test('an edge above the outlier threshold is flagged', () => {
  const value = evaluateValue({ pModel: 0.9, pFair: 0.4, odds: 2 });
  assert.ok(value.edge > 0.35);
  assert.equal(value.outlier, true);
  assert.deepEqual(value.hardFail, []);
});

test('relative edge and fair odds are reported alongside the point edge', () => {
  const value = evaluateValue({ pModel: 0.6, pFair: 0.4, odds: 1.8 });
  assert.ok(close(value.relativeEdge, 0.5));
  assert.ok(close(value.fairOdds, 1 / 0.6));
});

test('combined accumulator EV multiplies leg probabilities and prices', () => {
  const metrics = combinedEv([
    { pModel: 0.6, pStress: 0.55, odds: 1.8 },
    { pModel: 0.5, pStress: 0.45, odds: 2.1 },
  ]);
  assert.ok(close(metrics.p, 0.3));
  assert.ok(close(metrics.odds, 3.78));
  assert.ok(close(metrics.ev, 0.3 * 3.78 - 1));
  assert.ok(metrics.evStress < metrics.ev);
});
