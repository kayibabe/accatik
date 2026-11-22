import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  fmtCount,
  fmtFixed,
  fmtOdds,
  fmtPercent,
  fmtSignedPercent,
  fmtUnits,
} from '../../utils/format.ts';
import { pnlTone } from '../../utils/uiTone.ts';
import { SORT_DESC, type SortDirection, type SortState } from '../../utils/tableSort.ts';
import type {
  FeaturedPickSource,
  PickAnalyticsRow,
} from '../../types/analytics.ts';
import { InfoHint } from '../ui/DataCard.tsx';
import { DataTable, type DataTableColumn } from '../ui/DataTable.tsx';
import { EmptyState } from '../ui/States.tsx';
import { SortableTh } from '../SortableTh.tsx';
import { HitRateCell } from './HitRateCell.tsx';
import { groupPanelId, recordLabel, type FeaturedGroup, type Summary } from './analyticsModel.ts';

interface FeaturedPicksTableProps {
  groups: FeaturedGroup[];
  summary: Summary;
  totalSettled: number;
  strategyName: string;
  sort: SortState;
  onSort: (key: string, defaultDirection?: SortDirection) => void;
  expandedGroups: Record<string, boolean>;
  onToggleGroup: (key: string) => void;
  onToggleAll: () => void;
  allExpanded: boolean;
  showEmpty: boolean;
  onShowEmptyChange: (value: boolean) => void;
}

type RowKind = 'total' | 'group' | 'selection';

interface FlatRow {
  kind: RowKind;
  key: string;
  data: PickAnalyticsRow;
  source?: FeaturedPickSource;
  lineCount?: number;
  isExpanded?: boolean;
}

const TONE: Record<RowKind, string> = {
  total: 'bg-emerald-50/70 text-emerald-950 font-semibold',
  group: 'bg-slate-50/90 text-slate-800 font-semibold',
  selection: 'text-slate-700',
};

/** Fill the DataTable cell so group/total rows keep their tinted background. */
function toned(kind: RowKind, content: ReactNode): ReactNode {
  return <div className={`-mx-4 -my-3 px-4 py-3 ${TONE[kind]}`}>{content}</div>;
}

export function FeaturedPicksTable({
  groups,
  summary,
  totalSettled,
  strategyName,
  sort,
  onSort,
  expandedGroups,
  onToggleGroup,
  onToggleAll,
  allExpanded,
  showEmpty,
  onShowEmptyChange,
}: FeaturedPicksTableProps) {
  const totalRow: PickAnalyticsRow = {
    key: 'all-featured',
    label: 'All featured picks',
    settled: totalSettled,
    wins: summary.wins,
    losses: summary.losses,
    voids: summary.voids,
    hitRate: summary.hitRate,
    stake: summary.stake,
    returns: summary.returns,
    netPnl: summary.netPnl,
    roi: summary.roi,
    avgOdds: null,
    avgProbability: null,
  };

  const rows: FlatRow[] = [{ kind: 'total', key: 'all-featured', data: totalRow }];
  for (const group of groups) {
    const selections = showEmpty
      ? group.selections
      : group.selections.filter((row) => row.settled > 0);
    if (selections.length === 0) continue;
    const isExpanded = Boolean(expandedGroups[group.source]);
    rows.push({
      kind: 'group',
      key: `group:${group.source}`,
      data: group.row,
      source: group.source,
      lineCount: selections.length,
      isExpanded,
    });
    if (isExpanded) {
      for (const row of selections) {
        rows.push({ kind: 'selection', key: `sel:${row.key}`, data: row });
      }
    }
  }

  const labelFor = (row: FlatRow): ReactNode => {
    if (row.kind === 'total') {
      return (
        <span className="flex items-center gap-2">
          All featured picks
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700">
            overall
          </span>
        </span>
      );
    }
    if (row.kind === 'group' && row.source) {
      return (
        <button
          type="button"
          id={groupPanelId('featured-group', row.source)}
          onClick={() => onToggleGroup(row.source as FeaturedPickSource)}
          aria-expanded={row.isExpanded}
          className="flex w-full items-center gap-2 text-left cursor-pointer hover:text-slate-950"
        >
          <ChevronRight
            className={`h-3.5 w-3.5 shrink-0 transition-transform ${
              row.isExpanded ? 'rotate-90' : ''
            }`}
            aria-hidden="true"
          />
          <span>{row.data.label}</span>
          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">
            {row.lineCount} lines
          </span>
          <span className="text-[10px] font-normal text-slate-400">
            {row.data.settled} settled
          </span>
        </button>
      );
    }
    return (
      <span className="flex items-center gap-2">
        <span
          className="ml-3 h-1 w-1 shrink-0 rounded-full bg-slate-300"
          aria-hidden="true"
        />
        {row.data.label}
      </span>
    );
  };

  const sortHeader = (
    label: string,
    columnKey: string,
    align: 'left' | 'right' = 'right'
  ) => (
    <SortableTh
      bare
      label={label}
      columnKey={columnKey}
      sort={sort}
      onSort={onSort}
      defaultDirection={SORT_DESC}
      align={align}
      className="font-semibold"
    />
  );

  const columns: ReadonlyArray<DataTableColumn<FlatRow>> = [
    {
      key: 'label',
      header: sortHeader('Pick / selection', 'label', 'left'),
      cell: (row) => toned(row.kind, labelFor(row)),
      priority: 'primary',
    },
    {
      key: 'record',
      header: sortHeader('Record', 'record'),
      cell: (row) =>
        toned(row.kind, recordLabel(row.data.wins, row.data.losses, row.data.voids)),
      priority: 'secondary',
    },
    {
      key: 'hitRate',
      header: sortHeader('Hit rate', 'hitRate'),
      cell: (row) => toned(row.kind, <HitRateCell value={row.data.hitRate} />),
      priority: 'secondary',
    },
    {
      key: 'stake',
      header: sortHeader('Stake', 'stake'),
      cell: (row) => toned(row.kind, `${fmtCount(row.data.stake)}u`),
      priority: 'tertiary',
    },
    {
      key: 'returns',
      header: sortHeader('Returns', 'returns'),
      cell: (row) => toned(row.kind, `${fmtFixed(row.data.returns, 2)}u`),
      priority: 'tertiary',
    },
    {
      key: 'netPnl',
      header: sortHeader('Net P&L', 'netPnl'),
      cell: (row) =>
        toned(
          row.kind,
          <span className={pnlTone(row.data.netPnl)}>{fmtUnits(row.data.netPnl)}</span>
        ),
      priority: 'primary',
      align: 'right',
    },
    {
      key: 'roi',
      header: (
        <>
          {sortHeader('ROI', 'roi')}
          <InfoHint infoKey="roi" />
        </>
      ),
      cell: (row) =>
        toned(
          row.kind,
          <span className={pnlTone(row.data.roi)}>{fmtSignedPercent(row.data.roi)}</span>
        ),
      priority: 'primary',
      align: 'right',
    },
    {
      key: 'avgOdds',
      header: sortHeader('Avg odds', 'avgOdds'),
      cell: (row) => toned(row.kind, fmtOdds(row.data.avgOdds)),
      priority: 'tertiary',
      align: 'right',
    },
  ];

  return (
    <section id="featured" className="scroll-mt-16 space-y-2" aria-labelledby="featured-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2
            id="featured-title"
            className="text-sm font-bold uppercase tracking-wide text-slate-500"
          >
            Featured picks
          </h2>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Recommended Angle, Safer cover and Analyst note, each split into
            the selections they backed with the {strategyName} strategy.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer">
            <input
              type="checkbox"
              checked={showEmpty}
              onChange={(event) => onShowEmptyChange(event.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 accent-emerald-700"
            />
            Show lines with no picks yet
          </label>
          <button
            type="button"
            onClick={onToggleAll}
            className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 cursor-pointer"
          >
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
          <span className="text-[11px] text-slate-400">1u flat stake per pick</span>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.key}
        caption={`Featured pick performance grouped by card for the ${strategyName} strategy`}
        minWidth="min-w-[780px]"
        empty={
          <EmptyState
            title="No featured picks in the archive"
            description="Results appear after matchdays settle — refresh the archive to check for new results."
          />
        }
        renderCard={(row) => (
          <div
            className={`space-y-2 rounded-xl border border-slate-200 bg-white p-3 ${
              row.kind === 'total' ? 'border-emerald-200 bg-emerald-50/40' : ''
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm font-semibold text-slate-900">
                {labelFor(row)}
              </div>
              <div className="text-right">
                <p className={`font-mono text-sm font-bold ${pnlTone(row.data.netPnl)}`}>
                  {fmtUnits(row.data.netPnl)}
                </p>
                <p className={`font-mono text-xs ${pnlTone(row.data.roi)}`}>
                  {fmtSignedPercent(row.data.roi)} ROI
                </p>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-500">
              <div>
                <dt className="inline">Record: </dt>
                <dd className="inline font-mono text-slate-700">
                  {recordLabel(row.data.wins, row.data.losses, row.data.voids)}
                </dd>
              </div>
              <div>
                <dt className="inline">Hit rate: </dt>
                <dd className="inline font-mono text-slate-700">
                  {fmtPercent(row.data.hitRate)}
                </dd>
              </div>
              <div>
                <dt className="inline">Stake / returns: </dt>
                <dd className="inline font-mono text-slate-700">
                  {fmtCount(row.data.stake)}u / {fmtFixed(row.data.returns, 2)}u
                </dd>
              </div>
              <div>
                <dt className="inline">Avg odds: </dt>
                <dd className="inline font-mono text-slate-700">
                  {fmtOdds(row.data.avgOdds)}
                </dd>
              </div>
            </dl>
          </div>
        )}
      />

      <div className="mt-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-[11px] text-slate-400">
        Roll-up rows repeat their selections&apos; totals. Selections use the
        same Home/Draw/Away, goal-line, BTTS, Double Chance and DNB identities
        as the individual-market table. Groups are collapsed by default — click
        a heading to drill down. Click a column heading to sort.
      </div>
    </section>
  );
}
