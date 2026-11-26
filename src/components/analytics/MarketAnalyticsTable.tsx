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
import type { MarketAnalyticsRow } from '../../types/analytics.ts';
import { InfoHint } from '../ui/DataCard.tsx';
import { DataTable, type DataTableColumn } from '../ui/DataTable.tsx';
import { FilterChip } from '../ui/Filters.tsx';
import { MarketLabelText } from '../ui/MarketLabel.tsx';
import { EmptyState } from '../ui/States.tsx';
import { SortableTh } from '../SortableTh.tsx';
import { HitRateCell } from './HitRateCell.tsx';
import {
  groupPanelId,
  MARKET_PROBABILITY_FILTERS,
  recordLabel,
  type MarketGroup,
  type MarketTableRow,
  type Summary,
} from './analyticsModel.ts';

interface MarketAnalyticsTableProps {
  groups: MarketGroup[];
  summary: Summary;
  totalPicks: number;
  insight: { best: MarketAnalyticsRow; worst: MarketAnalyticsRow } | null;
  sort: SortState;
  onSort: (key: string, defaultDirection?: SortDirection) => void;
  expandedGroups: Record<string, boolean>;
  onToggleGroup: (key: string) => void;
  onToggleAll: () => void;
  allExpanded: boolean;
  showEmpty: boolean;
  onShowEmptyChange: (value: boolean) => void;
  minProbability: number;
  onMinProbabilityChange: (value: number) => void;
  matchingSelectionCount: number;
}

type RowKind = 'total' | 'group' | 'selection';

interface FlatRow {
  kind: RowKind;
  key: string;
  data: MarketTableRow;
  lineCount?: number;
  isExpanded?: boolean;
}

const TONE: Record<RowKind, string> = {
  total: 'bg-emerald-50/70 text-emerald-950 font-semibold',
  group: 'bg-slate-50/90 text-slate-800 font-semibold',
  selection: 'text-slate-700',
};

function toned(kind: RowKind, content: ReactNode): ReactNode {
  return <div className={`-mx-4 -my-3 px-4 py-3 ${TONE[kind]}`}>{content}</div>;
}

export function MarketAnalyticsTable({
  groups,
  summary,
  totalPicks,
  insight,
  sort,
  onSort,
  expandedGroups,
  onToggleGroup,
  onToggleAll,
  allExpanded,
  showEmpty,
  onShowEmptyChange,
  minProbability,
  onMinProbabilityChange,
  matchingSelectionCount,
}: MarketAnalyticsTableProps) {
  const totalRow: MarketTableRow = {
    key: 'all-markets',
    label: 'All markets',
    marketType: '1X2',
    settled: totalPicks,
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

  const rows: FlatRow[] = [{ kind: 'total', key: 'all-markets', data: totalRow }];
  for (const group of groups) {
    const selections = showEmpty
      ? group.selections
      : group.selections.filter((row) => row.settled > 0);
    if (selections.length === 0) continue;
    const isExpanded = Boolean(expandedGroups[group.typeRow.key]);
    rows.push({
      kind: 'group',
      key: `group:${group.typeRow.key}`,
      data: group.typeRow,
      lineCount: selections.length,
      isExpanded,
    });
    if (isExpanded) {
      for (const row of selections) {
        rows.push({ kind: 'selection', key: `sel:${row.key}`, data: row });
      }
    }
  }

  const noProbabilityMatches = groups.length === 0 && minProbability > 0;

  const labelFor = (row: FlatRow): ReactNode => {
    if (row.kind === 'total') {
      return (
        <span className="flex items-center gap-2">
          All markets
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-bold uppercase tracking-wide text-emerald-700">
            overall
          </span>
        </span>
      );
    }
    if (row.kind === 'group') {
      return (
        <button
          type="button"
          id={groupPanelId('market-group', row.data.key)}
          onClick={() => onToggleGroup(row.data.key)}
          aria-expanded={row.isExpanded}
          className="flex w-full items-center gap-2 text-left cursor-pointer hover:text-slate-950"
        >
          <ChevronRight
            className={`h-3.5 w-3.5 shrink-0 transition-transform ${
              row.isExpanded ? 'rotate-90' : ''
            }`}
            aria-hidden="true"
          />
          <MarketLabelText label={row.data.label} marketType={row.data.marketType} />
          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-bold uppercase tracking-wide text-slate-500">
            {row.lineCount} lines
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
        <MarketLabelText label={row.data.label} marketType={row.data.marketType} />
      </span>
    );
  };

  const sortHeader = (label: string, columnKey: string) => (
    <SortableTh
      bare
      label={label}
      columnKey={columnKey}
      sort={sort}
      onSort={onSort}
      defaultDirection={SORT_DESC}
      align="right"
      className="font-semibold"
    />
  );

  const columns: ReadonlyArray<DataTableColumn<FlatRow>> = [
    {
      key: 'label',
      header: (
        <SortableTh
          bare
          label="Market / selection"
          columnKey="label"
          sort={sort}
          onSort={onSort}
          defaultDirection={SORT_DESC}
          align="left"
          className="font-semibold"
        />
      ),
      cell: (row) => toned(row.kind, labelFor(row)),
      priority: 'primary',
    },
    {
      key: 'settled',
      header: sortHeader('Picks', 'settled'),
      cell: (row) => toned(row.kind, fmtCount(row.data.settled)),
      priority: 'secondary',
      align: 'right',
    },
    {
      key: 'record',
      header: sortHeader('W-L-V', 'record'),
      cell: (row) =>
        toned(row.kind, recordLabel(row.data.wins, row.data.losses, row.data.voids)),
      priority: 'secondary',
      align: 'right',
    },
    {
      key: 'hitRate',
      header: sortHeader('Hit rate', 'hitRate'),
      cell: (row) => toned(row.kind, <HitRateCell value={row.data.hitRate} />),
      priority: 'secondary',
      align: 'right',
    },
    {
      key: 'avgProbability',
      header: (
        <>
          {sortHeader('Win prob', 'avgProbability')}
          <InfoHint infoKey="fairProbability" />
        </>
      ),
      cell: (row) => toned(row.kind, fmtPercent(row.data.avgProbability)),
      priority: 'tertiary',
      align: 'right',
    },
    {
      key: 'avgOdds',
      header: sortHeader('Avg odds', 'avgOdds'),
      cell: (row) => toned(row.kind, fmtOdds(row.data.avgOdds)),
      priority: 'tertiary',
      align: 'right',
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
  ];

  return (
    <section id="markets" className="scroll-mt-16 space-y-2" aria-labelledby="markets-title">
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2
              id="markets-title"
              className="text-sm font-bold uppercase tracking-wide text-slate-500"
            >
              Individual markets
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              Every priced selection, rolled up by market then broken into
              Home/Away, goal lines, BTTS sides, Double Chance and DNB.
            </p>
            {insight && (
              <p className="mt-1 text-xs text-slate-500">
                Best ROI (min 20 picks):{' '}
                <span className="font-semibold">
                  <MarketLabelText
                    label={insight.best.label}
                    marketType={insight.best.marketType}
                  />{' '}
                  <span className="text-emerald-700">
                    {fmtSignedPercent(insight.best.roi)}
                  </span>
                </span>
                <span className="mx-1.5 text-slate-300">·</span>
                Weakest:{' '}
                <span className="font-semibold">
                  <MarketLabelText
                    label={insight.worst.label}
                    marketType={insight.worst.marketType}
                  />{' '}
                  <span className="text-red-600">
                    {fmtSignedPercent(insight.worst.roi)}
                  </span>
                </span>
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
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
              className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 cursor-pointer"
            >
              {allExpanded ? 'Collapse all' : 'Expand all'}
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-xs font-semibold text-slate-500">
            Market win probability
          </span>
          <div
            role="group"
            aria-label="Filter markets by win probability"
            className="inline-flex flex-wrap gap-1"
          >
            {MARKET_PROBABILITY_FILTERS.map((threshold) => (
              <FilterChip
                key={threshold}
                label={threshold === 0 ? 'Any' : `≥${threshold}%`}
                active={minProbability === threshold}
                onClick={() => onMinProbabilityChange(threshold)}
              />
            ))}
          </div>
          {minProbability > 0 && (
            <span className="text-xs text-slate-600">
              {fmtCount(matchingSelectionCount)} matching selection
              {matchingSelectionCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>

      {noProbabilityMatches ? (
        <EmptyState
          title="No selections clear this probability floor"
          description={`No market selection has a win probability of at least ${minProbability}%. Choose a lower floor to see more lines.`}
          action={
            <button
              type="button"
              onClick={() => onMinProbabilityChange(0)}
              className="text-sm font-semibold text-emerald-700 underline cursor-pointer"
            >
              Show all probabilities
            </button>
          }
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.key}
          caption="Flat-stake performance for every priced market selection grouped by market"
          minWidth="min-w-[820px]"
          empty={
            <EmptyState
              title="No priced market picks yet"
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
                  <p className={`font-mono text-sm ${pnlTone(row.data.roi)}`}>
                    {fmtSignedPercent(row.data.roi)} ROI
                  </p>
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-500">
                <div>
                  <dt className="inline">Picks: </dt>
                  <dd className="inline font-mono text-slate-700">
                    {fmtCount(row.data.settled)}
                  </dd>
                </div>
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
                  <dt className="inline">Win prob: </dt>
                  <dd className="inline font-mono text-slate-700">
                    {fmtPercent(row.data.avgProbability)}
                  </dd>
                </div>
                <div>
                  <dt className="inline">Avg odds: </dt>
                  <dd className="inline font-mono text-slate-700">
                    {fmtOdds(row.data.avgOdds)}
                  </dd>
                </div>
                <div>
                  <dt className="inline">Stake / returns: </dt>
                  <dd className="inline font-mono text-slate-700">
                    {fmtCount(row.data.stake)}u / {fmtFixed(row.data.returns, 2)}u
                  </dd>
                </div>
              </dl>
            </div>
          )}
        />
      )}

      <p className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">
        Roll-up rows repeat their selections&apos; totals. Voids return the stake
        and stay out of hit rate and ROI. Groups are collapsed by default —
        click a heading to drill down. Click a column heading to sort. These are
        single selections, not accumulators.
      </p>
    </section>
  );
}
