import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDateDayLabel,
  formatDateMonthLabel,
  groupRowsByDate,
  normalizeIsoDate,
} from './dateGroups.ts';

interface Row {
  id: string;
  date: string;
}

test('ISO date normalisation rejects malformed calendar dates', () => {
  assert.equal(normalizeIsoDate('2026-11-18'), '2026-11-18');
  assert.equal(normalizeIsoDate('18 Nov 2026'), null);
  assert.equal(normalizeIsoDate('2026-13-01'), null);
});

test('rows group into year → month → date and keep input order inside a day', () => {
  const rows: Row[] = [
    { id: 'nov-18-late', date: '2026-11-18' },
    { id: 'sep-30', date: '2026-09-30' },
    { id: 'nov-18-early', date: '2026-11-18' },
    { id: 'nov-10', date: '2026-11-10' },
    { id: 'last-year', date: '2025-12-31' },
    { id: 'undated', date: 'not a date' },
  ];

  const groups = groupRowsByDate(rows, (row) => row.date);

  assert.deepEqual(
    groups.map((group) => group.year),
    [2026, 2025, 0]
  );
  assert.deepEqual(
    groups[0].months.map((month) => month.month),
    [11, 9]
  );
  assert.deepEqual(
    groups[0].months[0].days.map((day) => day.dateIso),
    ['2026-11-18', '2026-11-10']
  );
  assert.deepEqual(
    groups[0].months[0].days[0].rows.map((row) => row.id),
    ['nov-18-late', 'nov-18-early']
  );
  assert.deepEqual(
    groups[2].months[0].days[0].rows.map((row) => row.id),
    ['undated']
  );
});

test('day and month labels are safe for unknown dates', () => {
  assert.equal(
    formatDateDayLabel('2026-11-18', '2026-11-18'),
    'Today · Wednesday, 18 November 2026'
  );
  assert.equal(
    formatDateDayLabel('2026-11-17', '2026-11-18'),
    'Yesterday · Tuesday, 17 November 2026'
  );
  assert.equal(formatDateDayLabel('', '2026-11-18'), 'Unknown date');
  assert.equal(formatDateMonthLabel(0), 'Unknown month');
});
