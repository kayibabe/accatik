import test from 'node:test';
import assert from 'node:assert/strict';
import { researchCopy, shadowLedgerNote } from './researchCopy.ts';

test('research statuses share one clear voice', () => {
  assert.equal(researchCopy.notRecommendation, 'Research, not a betting recommendation.');
  assert.match(researchCopy.verifyPrices, /Verify prices and results/);
  assert.match(researchCopy.wideSlip, /kept in full.*never marked as recommended/);
  assert.match(researchCopy.ledgerBoundary, /separate append-only record/);
});

test('the shadow ledger note keeps the stake and the never-staked rule together', () => {
  assert.equal(
    shadowLedgerNote(),
    'Recorded in the shadow ledger at a flat one-unit stake; never placed with a bookmaker.'
  );
  assert.match(shadowLedgerNote(2), /flat 2-unit stake/);
  assert.match(shadowLedgerNote(2), /never placed with a bookmaker/);
});
