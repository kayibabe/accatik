import { useCallback, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { SortDirection, SortState } from '../utils/tableSort.ts';
import { SORT_ASC } from '../utils/tableSort.ts';

interface SortableThProps {
  /** Visible column name (or richer label such as a value plus a unit). */
  label: ReactNode;
  /** Key passed back to `onSort`, matching an accessor in the table. */
  columnKey: string;
  sort: SortState;
  onSort: (key: string, defaultDirection?: SortDirection) => void;
  /** Direction the first click on this column applies. */
  defaultDirection?: SortDirection;
  /** Legacy hint; headers are always left-aligned to match their cells. */
  align?: 'left' | 'right';
  className?: string;
  title?: string;
  /** Optional accessible name; the visible label is used when omitted. */
  ariaLabel?: string;
  /**
   * Render only the sort button for placement inside an existing `<th>`.
   * `DataTable` owns the header cell, so a second `<th>` would be invalid HTML.
   * In this mode the sort direction is mirrored onto the parent cell with
   * `aria-sort`, preserving the screen-reader behaviour of the normal mode.
   */
  bare?: boolean;
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
  className = '',
  title,
  ariaLabel,
  bare = false,
}: SortableThProps) {
  const isActive = sort.key === columnKey;
  const Icon = !isActive
    ? ArrowUpDown
    : sort.direction === SORT_ASC
    ? ArrowUp
    : ArrowDown;
  const ariaSort = isActive
    ? sort.direction === SORT_ASC
      ? 'ascending'
      : 'descending'
    : 'none';

  const setParentSort = useCallback(
    (node: HTMLButtonElement | null) => {
      if (!bare || !node) return;
      const parentTh = node.closest('th');
      if (parentTh) parentTh.setAttribute('aria-sort', ariaSort);
    },
    [ariaSort, bare]
  );

  const button = (
    <button
      type="button"
      ref={bare ? setParentSort : undefined}
      onClick={() => onSort(columnKey, defaultDirection)}
      aria-label={ariaLabel}
      title={title}
      className={`group inline-flex min-h-11 items-center justify-start gap-1.5 rounded-md px-2 text-sm transition-colors hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 cursor-pointer ${
        isActive ? 'text-slate-900' : ''
      } ${bare ? className : ''}`}
    >
      <span>{label}</span>
      <Icon
        className={`h-3.5 w-3.5 shrink-0 transition-colors ${
          isActive
            ? 'text-emerald-700'
            : 'text-slate-500 group-hover:text-slate-800'
        }`}
        aria-hidden="true"
      />
    </button>
  );

  if (bare) return button;

  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={`text-left ${className}`}
      title={title}
    >
      {button}
    </th>
  );
}
