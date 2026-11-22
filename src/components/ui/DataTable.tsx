import { Fragment, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  align?: 'left' | 'right';
  /** Primary columns stay on phones; secondary appear at sm, tertiary at lg. */
  priority?: 'primary' | 'secondary' | 'tertiary';
  className?: string;
}

const PRIORITY_CLASS: Record<'primary' | 'secondary' | 'tertiary', string> = {
  primary: '',
  secondary: 'hidden sm:table-cell',
  tertiary: 'hidden lg:table-cell',
};

interface DataTableProps<T> {
  columns: ReadonlyArray<DataTableColumn<T>>;
  rows: ReadonlyArray<T>;
  rowKey: (row: T, index: number) => string | number;
  caption: string;
  /** Expanded content for rows whose secondary columns are hidden. */
  details?: (row: T) => ReactNode;
  /** Card rendering for the smallest screens; the table stays as fallback. */
  renderCard?: (row: T, index: number) => ReactNode;
  empty?: ReactNode;
  minWidth?: string;
  className?: string;
  compact?: boolean;
}

/**
 * Table shell with explicit column priority. On small screens the primary
 * columns remain in place and the rest move into an expandable detail row or
 * an optional card view, rather than forcing horizontal scroll as the only
 * way to read the data.
 */
export function DataTable<T,>({
  columns,
  rows,
  rowKey,
  caption,
  details,
  renderCard,
  empty,
  minWidth = 'min-w-[640px]',
  className = '',
  compact = false,
}: DataTableProps<T>) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const cellPadding = compact ? 'px-3 py-2' : 'px-4 py-3';

  if (rows.length === 0 && empty) {
    return <>{empty}</>;
  }

  return (
    <div className={className}>
      {renderCard && (
        <div className="space-y-2 sm:hidden">
          {rows.map((row, index) => (
            <div key={rowKey(row, index)}>{renderCard(row, index)}</div>
          ))}
        </div>
      )}
      <div className={`overflow-x-auto rounded-xl border border-slate-200 bg-white ${renderCard ? 'hidden sm:block' : ''}`}>
        <table className={`w-full ${minWidth} border-collapse text-left text-xs`}>
          <caption className="sr-only">{caption}</caption>
          <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`${cellPadding} ${PRIORITY_CLASS[column.priority ?? 'primary']} ${
                    column.align === 'right' ? 'text-right' : ''
                  } ${column.className ?? ''}`}
                >
                  {column.header}
                </th>
              ))}
              {details && (
                <th scope="col" className={`${cellPadding} lg:hidden`}>
                  <span className="sr-only">Row details</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, index) => {
              const key = String(rowKey(row, index));
              const isExpanded = Boolean(expanded[key]);
              return (
                <Fragment key={key}>
                  <tr className="hover:bg-slate-50/70">
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={`${cellPadding} align-middle ${PRIORITY_CLASS[column.priority ?? 'primary']} ${
                          column.align === 'right'
                            ? 'text-right font-mono tabular-nums'
                            : ''
                        } ${column.className ?? ''}`}
                      >
                        {column.cell(row, index)}
                      </td>
                    ))}
                    {details && (
                      <td className={`${cellPadding} lg:hidden`}>
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          onClick={() =>
                            setExpanded((current) => ({
                              ...current,
                              [key]: !current[key],
                            }))
                          }
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          Details
                        </button>
                      </td>
                    )}
                  </tr>
                  {details && isExpanded && (
                    <tr className="bg-slate-50 lg:hidden">
                      <td colSpan={columns.length + 1} className="px-4 py-3">
                        {details(row)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
