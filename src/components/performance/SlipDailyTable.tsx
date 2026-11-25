import { useMemo, useState } from 'react';
import { formatMwk } from '../../utils/accaMath.ts';
import { groupRowsByDate } from '../../utils/dateGroups.ts';
import { fmtShortDate, fmtSignedPercent } from '../../utils/format.ts';
import type { DayPerformance } from '../../utils/slipAnalytics.ts';
import {
  SORT_DESC,
  makeSortHandler,
  sortRows,
  type SortAccessors,
  type SortState,
} from '../../utils/tableSort.ts';
import { EMPTY_COPY, pnlTone } from '../../utils/uiTone.ts';
import { DateGroups } from '../ui/DateGroups.tsx';
import { DataTable, type DataTableColumn } from '../ui/DataTable.tsx';
import { EmptyState } from '../ui/States.tsx';
import { recordLabel, signedMwk } from './format.ts';
import { SortHeaderButton, SortStatus } from './SortHeaderButton.tsx';

const ACCESSORS: SortAccessors<DayPerformance> = {
  date: (row) => row.dateIso,
  slips: (row) => row.slips,
  record: (row) => recordLabel(row.won, row.lost, row.voided),
  staked: (row) => row.settledStake,
  returns: (row) => row.returns,
  netPnl: (row) => row.netPnl,
  roi: (row) => row.roi,
};

interface SlipDailyTableProps {
  daily: DayPerformance[];
  todayDate: string;
  selectedDate: string;
}

/** P&L grouped by matchday, sortable on every column. */
export function SlipDailyTable({
  daily,
  todayDate,
  selectedDate,
}: SlipDailyTableProps) {
  const [sort, setSort] = useState<SortState>({
    key: null,
    direction: SORT_DESC,
  });
  const onSort = makeSortHandler(setSort, SORT_DESC);
  const rows = useMemo(
    () => sortRows(daily, sort, ACCESSORS),
    [daily, sort]
  );
  const groups = useMemo(
    () => groupRowsByDate(rows, (row) => row.dateIso),
    [rows]
  );
  const sortable = (label: string, key: string, align?: 'left' | 'right') => (
    <SortHeaderButton
      label={label}
      columnKey={key}
      sort={sort}
      onSort={onSort}
      align={align}
    />
  );

  const columns: DataTableColumn<DayPerformance>[] = [
    {
      key: 'date',
      header: sortable('Matchday', 'date'),
      cell: (row) => (
        <span className="font-medium text-slate-800">
          {fmtShortDate(row.dateIso)}
          {row.open > 0 && (
            <span className="ml-1.5 text-xs text-slate-600">
              ({row.open} open)
            </span>
          )}
        </span>
      ),
      priority: 'primary',
    },
    {
      key: 'slips',
      header: sortable('Slips', 'slips', 'right'),
      cell: (row) => row.slips,
      align: 'right',
      priority: 'secondary',
    },
    {
      key: 'record',
      header: sortable('W-L-V', 'record', 'right'),
      cell: (row) => recordLabel(row.won, row.lost, row.voided),
      align: 'right',
      priority: 'secondary',
    },
    {
      key: 'staked',
      header: sortable('Staked', 'staked', 'right'),
      cell: (row) => formatMwk(row.settledStake),
      align: 'right',
      priority: 'tertiary',
    },
    {
      key: 'returns',
      header: sortable('Returns', 'returns', 'right'),
      cell: (row) => formatMwk(row.returns),
      align: 'right',
      priority: 'tertiary',
    },
    {
      key: 'netPnl',
      header: sortable('Net P&L', 'netPnl', 'right'),
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
      header: sortable('ROI', 'roi', 'right'),
      cell: (row) => (
        <span
          className={`font-semibold ${
            row.roi === null ? 'text-slate-600' : pnlTone(row.roi)
          }`}
        >
          {fmtSignedPercent(row.roi)}
        </span>
      ),
      align: 'right',
      priority: 'primary',
    },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h3 className="text-sm font-semibold text-slate-700">
          P&amp;L by matchday
        </h3>
        <span className="text-xs text-slate-600">
          Grouped by date · void days stay flat
        </span>
      </div>
      <SortStatus sort={sort} label="matchday table" />
      <DateGroups
        groups={groups}
        todayDate={todayDate}
        focusDate={selectedDate}
        idPrefix="slip-daily"
        renderDay={(dayRows) => (
          <DataTable
            columns={columns}
            rows={dayRows}
            rowKey={(row) => row.dateIso}
            caption="Settled slip profit and loss by matchday"
            minWidth="min-w-[720px]"
            compact
            details={(row) => (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <div>
                  <dt className="text-slate-600">Slips</dt>
                  <dd className="font-mono text-slate-700">{row.slips}</dd>
                </div>
                <div>
                  <dt className="text-slate-600">Open</dt>
                  <dd className="font-mono text-slate-700">{row.open}</dd>
                </div>
                <div>
                  <dt className="text-slate-600">Record (W-L-V)</dt>
                  <dd className="font-mono text-slate-700">
                    {recordLabel(row.won, row.lost, row.voided)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-600">Void stake returned</dt>
                  <dd className="font-mono text-slate-700">
                    {formatMwk(row.voidedStake)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-600">Staked</dt>
                  <dd className="font-mono text-slate-700">
                    {formatMwk(row.settledStake)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-600">Returns</dt>
                  <dd className="font-mono text-slate-700">
                    {formatMwk(row.returns)}
                  </dd>
                </div>
              </dl>
            )}
          />
        )}
        empty={
          <EmptyState
            title={EMPTY_COPY.settledMatchdays}
            description="Saved slips appear here once their matchday has been settled."
          />
        }
      />
    </div>
  );
}
