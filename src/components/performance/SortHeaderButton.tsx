import {
  SORT_ASC,
  type SortDirection,
  type SortState,
} from '../../utils/tableSort.ts';
import { SortableTh } from '../SortableTh.tsx';

interface SortHeaderButtonProps {
  label: string;
  columnKey: string;
  sort: SortState;
  onSort: (key: string, defaultDirection?: SortDirection) => void;
  /** Direction applied the first time this column is chosen. */
  defaultDirection?: SortDirection;
  /** Legacy hint; headers are always left-aligned to match their cells. */
  align?: 'left' | 'right';
  title?: string;
}

/**
 * `SortableTh` renders its own `<th>`, which cannot be nested inside
 * `DataTable`'s header cell. This is the canonical sort control in bare mode:
 * the same visible state and accessible name, without a second header cell.
 */
export function SortHeaderButton({
  label,
  columnKey,
  sort,
  onSort,
  defaultDirection = SORT_ASC,
  title,
}: SortHeaderButtonProps) {
  const active = sort.key === columnKey;
  const direction = active ? sort.direction : defaultDirection;
  const stateLabel = active
    ? `sorted ${direction === SORT_ASC ? 'ascending' : 'descending'}`
    : 'not sorted';

  return (
    <SortableTh
      bare
      label={label}
      columnKey={columnKey}
      sort={sort}
      onSort={onSort}
      defaultDirection={defaultDirection}
      ariaLabel={`${label}, ${stateLabel}. Activate to sort.`}
      title={title}
      className="w-full font-medium text-slate-600"
    />
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
