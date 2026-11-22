import { useState } from 'react';
import { fmtPercent } from '../../utils/format.ts';
import type { MarketTypePerformance } from '../../utils/slipAnalytics.ts';
import {
  SORT_DESC,
  makeSortHandler,
  sortRows,
  type SortAccessors,
  type SortState,
} from '../../utils/tableSort.ts';
import { DataTable, type DataTableColumn } from '../ui/DataTable.tsx';
import { EmptyState } from '../ui/States.tsx';
import { recordLabel } from './format.ts';
import { SortHeaderButton, SortStatus } from './SortHeaderButton.tsx';

const ACCESSORS: SortAccessors<MarketTypePerformance> = {
  marketType: (row) => row.marketType,
  legs: (row) => row.legs,
  record: (row) => recordLabel(row.won, row.lost, row.voided),
  open: (row) => row.open,
  hitRate: (row) => row.hitRate,
};

/** Leg-level hit rate by market, with the same sort contract as the old table. */
export function SlipMarketTypesTable({
  marketTypes,
}: {
  marketTypes: MarketTypePerformance[];
}) {
  const [sort, setSort] = useState<SortState>({
    key: null,
    direction: SORT_DESC,
  });
  const onSort = makeSortHandler(setSort, SORT_DESC);
  const rows = sortRows(marketTypes, sort, ACCESSORS);
  const sortable = (label: string, key: string) => (
    <SortHeaderButton label={label} columnKey={key} sort={sort} onSort={onSort} align="right" />
  );

  const columns: DataTableColumn<MarketTypePerformance>[] = [
    {
      key: 'marketType',
      header: (
        <SortHeaderButton label="Market" columnKey="marketType" sort={sort} onSort={onSort} />
      ),
      cell: (row) => <span className="font-medium text-slate-800">{row.marketType}</span>,
      priority: 'primary',
    },
    {
      key: 'legs',
      header: sortable('Legs', 'legs'),
      cell: (row) => row.legs,
      align: 'right',
      priority: 'secondary',
    },
    {
      key: 'record',
      header: sortable('W-L-V', 'record'),
      cell: (row) => recordLabel(row.won, row.lost, row.voided),
      align: 'right',
      priority: 'tertiary',
    },
    {
      key: 'open',
      header: sortable('Open', 'open'),
      cell: (row) => row.open,
      align: 'right',
      priority: 'tertiary',
    },
    {
      key: 'hitRate',
      header: sortable('Hit rate', 'hitRate'),
      cell: (row) => <span className="font-semibold text-slate-800">{fmtPercent(row.hitRate)}</span>,
      align: 'right',
      priority: 'primary',
    },
  ];

  return (
    <div className="space-y-2">
      <div className="px-1">
        <h3 className="text-xs font-semibold text-slate-700">
          Leg hit rate by market
        </h3>
        <p className="mt-0.5 text-[11px] text-slate-400">
          Every leg on a saved slip, settled independently.
        </p>
      </div>
      <SortStatus sort={sort} label="market table" />
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.marketType}
        caption="Leg hit rate by market type"
        minWidth="min-w-[460px]"
        compact
        details={(row) => (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            <div>
              <dt className="text-slate-400">Legs</dt>
              <dd className="font-mono text-slate-700">{row.legs}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Record (W-L-V)</dt>
              <dd className="font-mono text-slate-700">
                {recordLabel(row.won, row.lost, row.voided)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Open</dt>
              <dd className="font-mono text-slate-700">{row.open}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Hit rate</dt>
              <dd className="font-mono text-slate-700">{fmtPercent(row.hitRate)}</dd>
            </div>
          </dl>
        )}
        empty={<EmptyState title="No legs saved yet" />}
      />
    </div>
  );
}
