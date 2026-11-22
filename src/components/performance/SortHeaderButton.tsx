import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import {
  SORT_ASC,
  type SortDirection,
  type SortState,
} from '../../utils/tableSort.ts';

interface SortHeaderButtonProps {
  label: string;
  columnKey: string;
  sort: SortState;
  onSort: (key: string, defaultDirection?: SortDirection) => void;
  /** Direction applied the first time this column is chosen. */
  defaultDirection?: SortDirection;
  align?: 'left' | 'right';
  title?: string;
}

/**
 * `SortableTh` renders its own `<th>`, which cannot be nested inside
 * `DataTable`'s header cell. This is the same control as its button content:
 * visible state, explicit label and a stable click target for every column.
 */
export function SortHeaderButton({
  label,
  columnKey,
  sort,
  onSort,
  defaultDirection = SORT_ASC,
  align = 'left',
  title,
}: SortHeaderButtonProps) {
  const active = sort.key === columnKey;
  const direction = active ? sort.direction : defaultDirection;
  const Icon = !active
    ? ArrowUpDown
    : direction === SORT_ASC
      ? ArrowUp
      : ArrowDown;
  const stateLabel = active
    ? `sorted ${direction === SORT_ASC ? 'ascending' : 'descending'}`
    : 'not sorted';

  return (
    <button
      type="button"
      onClick={() => onSort(columnKey, defaultDirection)}
      aria-label={`${label}, ${stateLabel}. Activate to sort.`}
      title={title}
      className={`group inline-flex w-full items-center gap-1 cursor-pointer transition-colors hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${
        active ? 'text-slate-900' : ''
      } ${align === 'right' ? 'justify-end' : ''}`}
    >
      <span>{label}</span>
      <Icon
        className={`h-3 w-3 shrink-0 ${
          active ? 'text-emerald-600' : 'text-slate-300 group-hover:text-slate-500'
        }`}
        aria-hidden="true"
      />
    </button>
  );
}

/** Screen-reader announcement for the currently sorted column. */
export function SortStatus({
  sort,
  label,
}: {
  sort: SortState;
  label: string;
}) {
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {sort.key
        ? `Sorted by ${label} ${sort.direction === SORT_ASC ? 'ascending' : 'descending'}`
        : 'Default order'}
    </span>
  );
}
