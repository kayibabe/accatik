import test from 'node:test';
import assert from 'node:assert/strict';
import { addDaysToIsoDate } from './time.ts';

test('addDaysToIsoDate shifts dates without a timezone slip', () => {
  assert.equal(addDaysToIsoDate('2026-11-20', 1), '2026-11-21');
  assert.equal(addDaysToIsoDate('2026-11-20', -1), '2026-11-19');
});

test('addDaysToIsoDate crosses month, year and leap-day boundaries', () => {
  assert.equal(addDaysToIsoDate('2026-12-31', 1), '2027-01-01');
  assert.equal(addDaysToIsoDate('2026-01-01', -1), '2025-12-31');
  assert.equal(addDaysToIsoDate('2028-02-28', 1), '2028-02-29');
});

test('addDaysToIsoDate leaves invalid dates alone', () => {
  assert.equal(addDaysToIsoDate('not-a-date', 1), 'not-a-date');
});
