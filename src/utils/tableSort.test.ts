import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SORT_ASC,
  SORT_DESC,
  makeSortHandler,
  sortRows,
  toggleSort,
} from './tableSort.ts';

interface Row {
  name: string;
  odds?: number;
  note?: string;
}

const accessors = {
  name: (row: Row) => row.name,
  odds: (row: Row) => row.odds,
  note: (row: Row) => row.note,
};

test('clicking the active column flips direction', () => {
  const opened = toggleSort({ key: null, direction: SORT_ASC }, 'odds', SORT_DESC);
  assert.deepEqual(opened, { key: 'odds', direction: SORT_DESC });
  assert.deepEqual(toggleSort(opened, 'odds', SORT_DESC), {
    key: 'odds',
    direction: SORT_ASC,
  });
});

test('clicking a new column starts at that column default', () => {
  const sorted = toggleSort({ key: 'name', direction: SORT_DESC }, 'odds', SORT_DESC);
  assert.deepEqual(sorted, { key: 'odds', direction: SORT_DESC });
});

test('no active column leaves the rows untouched', () => {
  const rows: Row[] = [{ name: 'b' }, { name: 'a' }];
  const result = sortRows(rows, { key: null, direction: SORT_ASC }, accessors);
  assert.equal(result, rows);
});

test('numbers sort descending and ascending', () => {
  const rows: Row[] = [
    { name: 'a', odds: 1.28 },
    { name: 'b', odds: 4.2 },
    { name: 'c', odds: 1.95 },
  ];

  assert.deepEqual(
    sortRows(rows, { key: 'odds', direction: SORT_DESC }, accessors).map((r) => r.name),
    ['b', 'c', 'a']
  );
  assert.deepEqual(
    sortRows(rows, { key: 'odds', direction: SORT_ASC }, accessors).map((r) => r.name),
    ['a', 'c', 'b']
  );
});

test('text sorts case-insensitively and numerically', () => {
  const rows: Row[] = [
    { name: 'Over 10.5 Goals' },
    { name: 'over 2.5 goals' },
    { name: 'BTTS Yes' },
  ];

  assert.deepEqual(
    sortRows(rows, { key: 'name', direction: SORT_ASC }, accessors).map((r) => r.name),
    ['BTTS Yes', 'over 2.5 goals', 'Over 10.5 Goals']
  );
});

test('blank cells sink to the bottom in both directions', () => {
  const rows: Row[] = [
    { name: 'missing', odds: undefined },
    { name: 'low', odds: 1.2 },
    { name: 'high', odds: 3.4 },
  ];

  assert.deepEqual(
    sortRows(rows, { key: 'odds', direction: SORT_DESC }, accessors).map((r) => r.name),
    ['high', 'low', 'missing']
  );
  assert.deepEqual(
    sortRows(rows, { key: 'odds', direction: SORT_ASC }, accessors).map((r) => r.name),
    ['low', 'high', 'missing']
  );
});

test('equal values keep their incoming order', () => {
  const rows: Row[] = [
    { name: 'first', odds: 2 },
    { name: 'second', odds: 2 },
    { name: 'third', odds: 2 },
  ];

  assert.deepEqual(
    sortRows(rows, { key: 'odds', direction: SORT_DESC }, accessors).map((r) => r.name),
    ['first', 'second', 'third']
  );
  assert.deepEqual(
    sortRows(rows, { key: 'odds', direction: SORT_ASC }, accessors).map((r) => r.name),
    ['first', 'second', 'third']
  );
});

test('sorting never mutates the source rows', () => {
  const rows: Row[] = [
    { name: 'a', odds: 1.2 },
    { name: 'b', odds: 3.4 },
  ];

  sortRows(rows, { key: 'odds', direction: SORT_DESC }, accessors);

  assert.deepEqual(rows.map((r) => r.name), ['a', 'b']);
});

test('an unknown column key is a no-op', () => {
  const rows: Row[] = [{ name: 'b' }, { name: 'a' }];
  const result = sortRows(rows, { key: 'nope', direction: SORT_ASC }, accessors);
  assert.equal(result, rows);
});

test('a shared sort handler flips the active column and honours its default', () => {
  let state = { key: null as string | null, direction: SORT_ASC };
  const setter = (update: (current: typeof state) => typeof state) => {
    state = update(state);
  };
  const onSort = makeSortHandler(setter, SORT_DESC);

  onSort('odds');
  assert.deepEqual(state, { key: 'odds', direction: SORT_DESC });
  onSort('odds');
  assert.deepEqual(state, { key: 'odds', direction: SORT_ASC });
  onSort('name');
  assert.deepEqual(state, { key: 'name', direction: SORT_DESC });
});
