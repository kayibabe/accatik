import { useState } from 'react';
import { formatMwk } from '../../utils/accaMath.ts';
import { fmtPercent, fmtSignedPercent } from '../../utils/format.ts';
import type { OddsBandPerformance } from '../../utils/slipAnalytics.ts';
import {
  SORT_DESC,
  makeSortHandler,
  sortRows,
  type SortAccessors,
  type SortState,
} from '../../utils/tableSort.ts';
import { pnlTone } from '../../utils/uiTone.ts';
import { DataTable, type DataTableColumn } from '../ui/DataTable.tsx';
import { EmptyState } from '../ui/States.tsx';
import { recordLabel, signedMwk } from './format.ts';
import { SortHeaderButton, SortStatus } from './SortHeaderButton.tsx';

const ACCESSORS: SortAccessors<OddsBandPerformance> = {
  label: (row) => row.label,
  slips: (row) => row.slips,
  record: (row) => recordLabel(row.won, row.lost, row.voided),
  netPnl: (row) => row.netPnl,
  roi: (row) => row.roi,
  hitRate: (row) => row.hitRate,
};

/** Settled slips grouped by their effective (void-adjusted) total odds. */
export function SlipOddsBandsTable({
  oddsBands,
}: {
  oddsBands: OddsBandPerformance[];
}) {
  const [sort, setSort] = useState<SortState>({
    key: null,
    direction: SORT_DESC,
  });
  const onSort = makeSortHandler(setSort, SORT_DESC);
  const rows = sortRows(oddsBands, sort, ACCESSORS);
  const sortable = (label: string, key: string) => (
    <SortHeaderButton label={label} columnKey={key} sort={sort} onSort={onSort} align="right" />
  );

  const columns: DataTableColumn<OddsBandPerformance>[] = [
    {
      key: 'label',
      header: (
        <SortHeaderButton label="Odds" columnKey="label" sort={sort} onSort={onSort} />
      ),
      cell: (row) => <span className="font-medium text-slate-800">{row.label}</span>,
      priority: 'primary',
    },
    {
      key: 'slips',
      header: sortable('Slips', 'slips'),
      cell: (row) => row.slips,
      align: 'right',
      priority: 'secondary',
    },
    {
      key: 'record',
      header: sortable('W-L-V', 'record'),
      cell: (row) => recordLabel(row.won, row.lost, row.voided),
      align: 'right',
      priority: 'secondary',
    },
    {
      key: 'netPnl',
      header: sortable('Net P&L', 'netPnl'),
      cell: (row) => (
        <span className={`font-semibold ${pnlTone(row.netPnl)}`}>
          {signedMwk(row.netPnl)}
        </span>
      ),
      align: 'right',
      priority: 'primary',
    },
    {
      key: 'roi',
      header: sortable('ROI', 'roi'),
      cell: (row) => (
        <span
          className={`font-semibold ${
            row.roi === null ? 'text-slate-400' : pnlTone(row.roi)
          }`}
        >
          {fmtSignedPercent(row.roi)}
        </span>
      ),
      align: 'right',
      priority: 'primary',
    },
    {
      key: 'hitRate',
      header: sortable('Hit rate', 'hitRate'),
      cell: (row) => (
        <span className="font-semibold text-slate-800">{fmtPercent(row.hitRate)}</span>
      ),
      align: 'right',
      priority: 'tertiary',
    },
  ];

  return (
    <div className="space-y-2">
      <div className="px-1">
        <h3 className="text-xs font-semibold text-slate-700">
          P&amp;L by odds band
        </h3>
        <p className="mt-0.5 text-[11px] text-slate-400">
          Settled slips grouped by their void-adjusted total odds.
        </p>
      </div>
      <SortStatus sort={sort} label="odds band table" />
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        caption="Profit and loss by odds band"
        minWidth="min-w-[560px]"
        compact
        details={(row) => (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            <div>
              <dt className="text-slate-400">Slips</dt>
              <dd className="font-mono text-slate-700">{row.slips}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Record (W-L-V)</dt>
              <dd className="font-mono text-slate-700">
                {recordLabel(row.won, row.lost, row.voided)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Settled stake</dt>
              <dd className="font-mono text-slate-700">{formatMwk(row.settledStake)}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Hit rate</dt>
              <dd className="font-mono text-slate-700">{fmtPercent(row.hitRate)}</dd>
            </div>
          </dl>
        )}
        empty={<EmptyState title="No settled slips in these bands" />}
      />
      <p className="border-t border-slate-100 px-1 pt-2 text-[11px] text-slate-400">
        Hit rate counts wins against Win/Lost slips only. Void and open slips stay
        out of both ratios.
      </p>
    </div>
  );
}
