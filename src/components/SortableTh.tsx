import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { SortDirection, SortState } from '../utils/tableSort.ts';
import { SORT_ASC } from '../utils/tableSort.ts';

interface SortableThProps {
  /** Visible column name. */
  label: string;
  /** Key passed back to `onSort`, matching an accessor in the table. */
  columnKey: string;
  sort: SortState;
  onSort: (key: string, defaultDirection?: SortDirection) => void;
  /** Direction the first click on this column applies. */
  defaultDirection?: SortDirection;
  align?: 'left' | 'right';
  className?: string;
  title?: string;
}

/**
 * A `<th>` whose label is a button: click to sort, click again to reverse.
 * Exposes `aria-sort` so screen readers announce the current ordering.
 */
export function SortableTh({
  label,
  columnKey,
  sort,
  onSort,
  defaultDirection = SORT_ASC,
  align = 'left',
  className = '',
  title,
}: SortableThProps) {
  const isActive = sort.key === columnKey;
  const Icon = !isActive
    ? ArrowUpDown
    : sort.direction === SORT_ASC
    ? ArrowUp
    : ArrowDown;

  return (
    <th
      scope="col"
      aria-sort={
        isActive ? (sort.direction === SORT_ASC ? 'ascending' : 'descending') : 'none'
      }
      className={align === 'right' ? `text-right ${className}` : className}
      title={title}
    >
      <button
        type="button"
        onClick={() => onSort(columnKey, defaultDirection)}
        className={`group inline-flex items-center gap-1 cursor-pointer transition-colors hover:text-slate-900 ${
          isActive ? 'text-slate-900' : ''
        } ${align === 'right' ? 'w-full justify-end' : ''}`}
      >
        <span>{label}</span>
        <Icon
          className={`w-3 h-3 shrink-0 transition-colors ${
            isActive
              ? 'text-emerald-600'
              : 'text-slate-300 group-hover:text-slate-500'
          }`}
          aria-hidden="true"
        />
      </button>
    </th>
  );
}
