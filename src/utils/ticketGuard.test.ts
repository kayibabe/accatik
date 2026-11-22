import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_RECOMMENDED_LEGS,
  guardTicket,
  recommendedLegCap,
  ticketEconomics,
} from './ticketGuard.ts';
import { makeLeg } from './testFactories.ts';

function legs(count: number, odds: number, fairProbability: number) {
  return Array.from({ length: count }, (_, index) =>
    makeLeg(`f${index}`, `f${index}-1x2-h`, odds, { fairProbability })
  );
}

test('research mode allows short prices but still applies the three-leg cap', () => {
  const shortLegs = legs(8, 1.12, 85);
  const normal = guardTicket(shortLegs);
  const research = guardTicket(shortLegs, { researchMode: true, maxLegs: 8 });

  assert.ok(normal.legs.length <= 3);
  assert.equal(research.legs.length, 3);
  assert.equal(research.recommended, false);
  assert.match(research.reason, /not a recommendation/);
  assert.equal(research.economics.legCount, 3);
});

test('ticket economics removes the margin and reports the compounded overround', () => {
  const economics = ticketEconomics(legs(2, 1.5, 60));

  assert.equal(economics.legCount, 2);
  assert.equal(economics.totalOdds, 2.25);
  assert.equal(economics.fairChance, 36);
  assert.equal(economics.breakEvenChance, 44.4);
  assert.equal(economics.edgePts, -8.4);
  assert.equal(economics.expectedRoi, -19);
  assert.equal(economics.combinedOverround, 1.23);
  assert.equal(economics.basis, 'fair');
});

test('missing fair prices fall back to implied and say so', () => {
  const economics = ticketEconomics(legs(2, 1.5, 60).map((leg) => ({
    ...leg,
    fairProbability: undefined,
  })));

  assert.equal(economics.basis, 'implied');
  assert.equal(economics.fairChance, 44.5);
  assert.equal(economics.edgePts, 0.1);
});

test('an implied-basis ticket is never recommended, even at a nominal edge', () => {
  const result = guardTicket(
    legs(2, 1.5, 60).map((leg) => ({ ...leg, fairProbability: undefined }))
  );

  assert.equal(result.economics.basis, 'implied');
  assert.equal(result.recommended, false);
  assert.match(result.reason, /includes the bookmaker margin/);
});

test('the cap holds ultra-short legs to two selections', () => {
  assert.equal(recommendedLegCap(legs(8, 1.07, 93)), 2);
});

test('the cap holds normal short legs to three selections', () => {
  assert.equal(recommendedLegCap(legs(5, 1.5, 66)), 3);
});

test('the cap never pads a ticket that is already short', () => {
  assert.equal(recommendedLegCap(legs(2, 1.5, 66)), 2);
  assert.equal(recommendedLegCap(legs(1, 1.5, 66)), 1);
});

test('one long price cannot disguise three ultra-short legs', () => {
  const mixed = [
    ...legs(3, 1.1, 90),
    makeLeg('long', 'long-1x2-h', 5, { fairProbability: 20 }),
  ];

  assert.equal(recommendedLegCap(mixed), 2);

  const result = guardTicket(mixed);
  assert.equal(result.legs.length, 2);
  assert.ok(result.legs.every((leg) => leg.odds === 1.1));
});

test('guarding an eight-leg ticket trims it to two and explains why', () => {
  const result = guardTicket(legs(8, 1.07, 93));

  assert.equal(result.originalLegCount, 8);
  assert.equal(result.legs.length, 2);
  assert.equal(result.trimmedCount, 6);
  assert.equal(result.recommended, false);
  assert.match(result.reason, /Capped at 2 legs/);
});

test('guarding a five-leg ticket trims it to the three-leg maximum', () => {
  const result = guardTicket(legs(5, 1.5, 66));

  assert.equal(result.legs.length, MAX_RECOMMENDED_LEGS);
  assert.equal(result.trimmedCount, 2);
});

test('a negative-EV ticket is never labelled recommended', () => {
  const result = guardTicket(legs(3, 2, 50));

  assert.equal(result.economics.edgePts, 0);
  assert.equal(result.recommended, false);
  assert.match(result.reason, /negative-EV/);
});

test('a ticket that genuinely beats fair keeps the recommended label', () => {
  const result = guardTicket(legs(3, 2, 60));

  assert.ok(result.economics.edgePts > 0);
  assert.equal(result.recommended, true);
  assert.match(result.reason, /beats fair/);
});

test('locked selections survive the trim', () => {
  const legsWithLocks = legs(5, 1.5, 66).map((leg, index) => ({
    ...leg,
    locked: index >= 3,
  }));

  const result = guardTicket(legsWithLocks, { preserveLocked: true });

  assert.equal(result.legs.length, 3);
  assert.equal(result.legs.filter((leg) => leg.locked).length, 2);
  assert.ok(result.legs.some((leg) => !leg.locked));
});

test('locks cannot lift the ticket above the cap', () => {
  const allLocked = legs(4, 1.5, 66).map((leg) => ({ ...leg, locked: true }));

  const result = guardTicket(allLocked, { preserveLocked: true });

  assert.equal(result.legs.length, 3);
  assert.ok(result.legs.every((leg) => leg.locked));
});

test('an empty ticket has no economics and is not recommended', () => {
  const result = guardTicket([]);

  assert.deepEqual(result.legs, []);
  assert.equal(result.recommended, false);
  assert.equal(result.economics.legCount, 0);
  assert.equal(result.reason, 'No selections yet.');
});
