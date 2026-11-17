/**
 * Generic, dependency-free table sorting.
 *
 * Headers are declarative: a column key plus an accessor that turns a row into
 * a comparable value. Missing values always sink to the bottom, and the sort is
 * stable so equal rows keep their incoming order (which matters for the ticket,
 * where order is meaningful).
 */

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  key: string | null;
  direction: SortDirection;
}

export type SortValue = string | number | null | undefined;

export type SortAccessors<T> = Record<string, (row: T) => SortValue>;

/** Numeric columns read best biggest-first; text columns best A-Z. */
export const SORT_DESC: SortDirection = 'desc';
export const SORT_ASC: SortDirection = 'asc';

/**
 * Clicking the active column flips its direction; clicking a new column starts
 * at that column's natural direction.
 */
export function toggleSort(
  current: SortState,
  key: string,
  defaultDirection: SortDirection = SORT_ASC
): SortState {
  if (current.key === key) {
    return {
      key,
      direction: current.direction === SORT_ASC ? SORT_DESC : SORT_ASC,
    };
  }
  return { key, direction: defaultDirection };
}

const isMissing = (value: SortValue): boolean =>
  value === null || value === undefined || value === '';

export function sortRows<T>(
  rows: T[],
  state: SortState,
  accessors: SortAccessors<T>
): T[] {
  if (!state.key) return rows;

  const accessor = accessors[state.key];
  if (!accessor) return rows;

  const factor = state.direction === SORT_ASC ? 1 : -1;

  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const aValue = accessor(a.row);
      const bValue = accessor(b.row);

      // Blank cells never jump to the top just because the sort is reversed.
      if (isMissing(aValue) || isMissing(bValue)) {
        if (isMissing(aValue) && isMissing(bValue)) return a.index - b.index;
        return isMissing(aValue) ? 1 : -1;
      }

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return aValue === bValue
          ? a.index - b.index
          : (aValue - bValue) * factor;
      }

      const diff = String(aValue).localeCompare(String(bValue), undefined, {
        numeric: true,
        sensitivity: 'base',
      });
      return diff === 0 ? a.index - b.index : diff * factor;
    })
    .map(({ row }) => row);
}
