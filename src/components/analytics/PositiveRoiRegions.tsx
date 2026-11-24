import type { ReactNode } from 'react';
import { AlertTriangle, ArrowRight, RefreshCw, Wand2 } from 'lucide-react';
import {
  fmtCount,
  fmtOdds,
  fmtPercent,
  fmtShortDate,
  fmtSignedPercent,
} from '../../utils/format.ts';
import { frameworkTone } from '../../utils/uiTone.ts';
import {
  SORT_ASC,
  SORT_DESC,
  type SortDirection,
  type SortState,
} from '../../utils/tableSort.ts';
import type {
  QualifiedPickRow,
  QualifiedPicksResponse,
  RoiAccaResponse,
} from '../../types/analytics.ts';
import { DataStatus } from '../ui/DataStatus.tsx';
import { TabNav } from '../ui/TabNav.tsx';
import { InfoHint, MetricCard, MetricGrid } from '../ui/DataCard.tsx';
import { PageHeader } from '../ui/PageHeader.tsx';
import { DataTable, type DataTableColumn } from '../ui/DataTable.tsx';
import { FilterChip } from '../ui/Filters.tsx';
import { EmptyState, InlineLoading } from '../ui/States.tsx';
import { SettlementLabel } from '../SettlementLabel.tsx';
import { SortableTh } from '../SortableTh.tsx';

export type PickFilter = 'all' | 'qualified' | 'promoted';

export const PICK_FILTER_OPTIONS: ReadonlyArray<{
  id: PickFilter;
  label: string;
}> = [
  { id: 'all', label: 'All cards' },
  { id: 'qualified', label: 'Qualified only' },
  { id: 'promoted', label: 'Promoted only' },
];

export const SOURCE_LABELS: Record<string, string> = {
  angle: 'Model angle',
  cover: 'Alternative cover',
  note: 'Research note',
};

export const POSITIVE_ROI_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'cards', label: 'Cards' },
  { id: 'table', label: 'Table' },
] as const;

export type PositiveRoiSectionId =
  (typeof POSITIVE_ROI_SECTIONS)[number]['id'];

/** Unknown or stale deep links land on the overview page. */
export function resolvePositiveRoiSection(
  value: string | undefined
): PositiveRoiSectionId {
  return POSITIVE_ROI_SECTIONS.some((section) => section.id === value)
    ? (value as PositiveRoiSectionId)
    : 'overview';
}

interface PositiveRoiSectionNavProps {
  activeId: PositiveRoiSectionId;
  onSelect: (id: PositiveRoiSectionId) => void;
}

export function PositiveRoiSectionNav({
  activeId,
  onSelect,
}: PositiveRoiSectionNavProps) {
  return (
    <TabNav
      items={POSITIVE_ROI_SECTIONS}
      activeId={activeId}
      onSelect={onSelect}
      label="Research pages"
    />
  );
}

interface PositiveRoiOverviewProps {
  displayDate: string;
  qualified: QualifiedPicksResponse | null;
  promotedCount: number;
  registrySnapshot: string | null;
  loading: boolean;
  building: boolean;
  onRefresh: () => void;
  onGenerate: () => void;
  onGoToSlate: () => void;
}

/** Research scope framing, provenance and the four headline counts. */
export function PositiveRoiOverview({
  displayDate,
  qualified,
  promotedCount,
  registrySnapshot,
  loading,
  building,
  onRefresh,
  onGenerate,
  onGoToSlate,
}: PositiveRoiOverviewProps) {
  return (
    <section id="overview" className="scroll-mt-16 space-y-4" aria-labelledby="roi-overview-title">
      <PageHeader
        eyebrow={`${displayDate} · Prematch, flat stake`}
        title={<span id="roi-overview-title">Promoted ROI Picks</span>}
        scope="research"
        description={
          <>
            Only selections whose strategy/source/key is promoted after a
            clustered ROI check are admitted. Every other card stays in the
            table with the reason it was withheld. This is a read-only study —
            nothing here is a live betting recommendation and no ticket is ever
            staked with a bookmaker.
          </>
        }
        actions={
          <>
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading || building}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              Refresh
            </button>
            <button
              type="button"
              onClick={onGenerate}
              disabled={building || loading || (qualified?.eligibleCount ?? 0) === 0}
              title="Build a 5.00+ odds research accumulator from framework-qualified promoted markets only"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
            >
              <Wand2 className="w-3.5 h-3.5" aria-hidden="true" />
              {building ? 'Building…' : 'Generate 5.00+ ROI Acca'}
            </button>
            <button
              type="button"
              onClick={onGoToSlate}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-slate-700 hover:text-slate-900 transition-colors cursor-pointer"
            >
              Edit on Fixture Board
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </>
        }
      />

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900 flex gap-2.5">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
        <p>
          <span className="font-semibold">Research, not a recommendation.</span>{' '}
          Promoted selections must also clear every framework gate, and the
          accumulator is capped at five legs. A 5.00 target may therefore be
          left short rather than padded. Bookmaker margins compound with every
          leg; no ticket here is presented as positive-EV or recommended. Flat
          staking and exposure caps still apply. Closing line value is tracked
          in the shadow ledger, not on this screen.
          <InfoHint infoKey="clv" />
          These tickets are never live-staked.
        </p>
      </div>

      <DataStatus
        source="ROI promotion registry · daily snapshot"
        mode="Research · shadow only"
        capturedAt={registrySnapshot}
        note="Read-only; generated tickets stay in the shadow ledger"
      />

      <MetricGrid>
        <MetricCard label="Promoted selections" value={fmtCount(promotedCount)} />
        <MetricCard
          label="Qualified on this slate"
          value={fmtCount(qualified?.eligibleCount ?? 0)}
          tone="text-emerald-700"
          infoKey="roi"
        />
        <MetricCard
          label="Cards considered"
          value={fmtCount(qualified?.rows.length ?? 0)}
        />
        <MetricCard
          label="Registry snapshot"
          value={fmtShortDate(registrySnapshot)}
          detail={registrySnapshot ?? 'No snapshot yet'}
        />
      </MetricGrid>
    </section>
  );
}

interface ResearchTicketCardProps {
  ticket: RoiAccaResponse | null;
  canGenerate: boolean;
  onGenerate: () => void;
}

/** Generated shadow accumulator, with a card-first table on phones. */
export function ResearchTicketCard({
  ticket,
  canGenerate,
  onGenerate,
}: ResearchTicketCardProps) {
  if (!ticket) {
    return (
      <section id="cards" className="scroll-mt-16" aria-label="Research accumulator">
        <EmptyState
          title="No research accumulator generated"
          description="Build a shadow accumulator from promoted, framework-qualified markets. It is capped at five legs and is never placed with a bookmaker."
          action={
            <button
              type="button"
              onClick={onGenerate}
              disabled={!canGenerate}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 cursor-pointer"
            >
              <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
              Generate 5.00+ ROI Acca
            </button>
          }
        />
      </section>
    );
  }

  // Sorting is view-only: the source leg order stays intact for the shadow ticket.
  const legColumns: ReadonlyArray<DataTableColumn<(typeof ticket.legs)[number]>> = [
    {
      key: 'fixture',
      header: 'Fixture',
      cell: (leg) => (
        <span className="font-semibold text-slate-900">
          {leg.homeTeam} vs {leg.awayTeam}
        </span>
      ),
      sortValue: (leg) => `${leg.homeTeam} vs ${leg.awayTeam}`,
      priority: 'primary',
    },
    {
      key: 'selection',
      header: 'Selection',
      cell: (leg) => (
        <span className="font-semibold text-emerald-800">{leg.marketLabel}</span>
      ),
      sortValue: (leg) => leg.marketLabel,
      priority: 'primary',
    },
    {
      key: 'odds',
      header: 'Odds',
      cell: (leg) => fmtOdds(leg.odds),
      align: 'right',
      sortValue: (leg) => leg.odds,
      defaultSortDirection: SORT_DESC,
      priority: 'secondary',
    },
  ];

  return (
    <section
      id="cards"
      className="scroll-mt-16 space-y-2"
      aria-label="Research accumulator"
    >
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-slate-900">
              Research accumulator · {ticket.legs.length} legs ·{' '}
              <span className="font-mono">{fmtOdds(ticket.totalOdds)}</span> odds
            </p>
            <p className="text-[11px] text-slate-500">
              {ticket.targetReached
                ? '5.00 target reached using promoted markets only.'
                : `Target not reached with ${ticket.maxLegs} promoted legs; left short rather than padding.`}{' '}
              Fair chance {fmtPercent(ticket.economics.fairChance)} vs break-even{' '}
              {fmtPercent(ticket.economics.breakEvenChance)} · expected ROI{' '}
              {fmtSignedPercent(ticket.economics.expectedRoi)}.
            </p>
          </div>
          <span className="px-2 py-1 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded">
            SHADOW ONLY · NOT RECOMMENDED
          </span>
        </div>
        <DataTable
          columns={legColumns}
          rows={ticket.legs}
          rowKey={(leg) => `${leg.fixtureId}:${leg.marketId}`}
          caption="Legs of the generated research accumulator"
          compact
          minWidth="min-w-[520px]"
          renderCard={(leg) => (
            <div className="rounded-xl border border-slate-200 bg-white p-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {leg.homeTeam} vs {leg.awayTeam}
                </p>
                <p className="text-xs font-semibold text-emerald-800">
                  {leg.marketLabel}
                </p>
              </div>
              <p className="font-mono text-sm tabular-nums text-slate-700">
                {fmtOdds(leg.odds)}
              </p>
            </div>
          )}
        />
        <p className="px-4 py-3 text-[11px] leading-relaxed text-amber-900 bg-amber-50 border-t border-amber-200">
          {ticket.riskWarning} This ticket is recorded in the shadow ledger at
          a flat one-unit stake ({ticket.stake}) and is never placed with a
          bookmaker.
        </p>
      </div>
    </section>
  );
}

interface QualifiedPicksTableProps {
  rows: QualifiedPickRow[];
  pickFilter: PickFilter;
  onPickFilterChange: (filter: PickFilter) => void;
  filterCounts: Record<PickFilter, number>;
  sort: SortState;
  onSort: (key: string, defaultDirection?: SortDirection) => void;
  loading: boolean;
}

/** Sortable promotion table with priority columns and mobile cards. */
export function QualifiedPicksTable({
  rows,
  pickFilter,
  onPickFilterChange,
  filterCounts,
  sort,
  onSort,
  loading,
}: QualifiedPicksTableProps) {
  const sortHeader = (
    label: string,
    columnKey: string,
    align: 'left' | 'right' = 'left',
    defaultDirection: SortDirection = SORT_ASC
  ) => (
    <SortableTh
      bare
      label={label}
      columnKey={columnKey}
      sort={sort}
      onSort={onSort}
      defaultDirection={defaultDirection}
      align={align}
      className="font-semibold"
    />
  );

  const columns: ReadonlyArray<DataTableColumn<QualifiedPickRow>> = [
    {
      key: 'fixture',
      header: sortHeader('Fixture', 'fixture'),
      cell: (row) => (
        <div>
          <p className="font-semibold text-slate-900">
            {row.homeTeam} vs {row.awayTeam}
          </p>
          <p className="text-[11px] text-slate-500">{row.competition}</p>
        </div>
      ),
      priority: 'primary',
    },
    {
      key: 'kickoff',
      header: sortHeader('Kickoff', 'kickoff'),
      cell: (row) => (
        <span className="font-mono text-[11px] text-slate-600 whitespace-nowrap">
          {row.kickoffCat}
        </span>
      ),
      priority: 'tertiary',
    },
    {
      key: 'source',
      header: sortHeader('Card', 'source'),
      cell: (row) => (
        <span className="text-xs text-slate-700">
          {SOURCE_LABELS[row.source] ?? row.source}
        </span>
      ),
      priority: 'secondary',
    },
    {
      key: 'selection',
      header: sortHeader('Selection', 'selection'),
      cell: (row) => (
        <span className="font-semibold text-emerald-800">
          {row.selectionLabel}
        </span>
      ),
      priority: 'primary',
    },
    {
      key: 'odds',
      header: sortHeader('Odds', 'odds', 'right', SORT_DESC),
      cell: (row) => fmtOdds(row.odds),
      align: 'right',
      priority: 'secondary',
    },
    {
      key: 'ci',
      header: sortHeader('ROI / CI', 'ci', 'right', SORT_DESC),
      cell: (row) => (
        <span className="font-mono text-[11px] tabular-nums text-slate-700">
          {fmtSignedPercent(row.roi)}
          <span className="block text-slate-400">
            {row.roiCiLow === null || row.roiCiHigh === null
              ? '—'
              : `${fmtPercent(row.roiCiLow)}..${fmtPercent(row.roiCiHigh)}`}
          </span>
        </span>
      ),
      align: 'right',
      priority: 'primary',
    },
    {
      key: 'settled',
      header: sortHeader('Settled', 'settled', 'right', SORT_DESC),
      cell: (row) => fmtCount(row.settled),
      align: 'right',
      priority: 'secondary',
    },
    {
      key: 'result',
      header: sortHeader('Result', 'result', 'left', SORT_DESC),
      cell: (row) => <SettlementLabel status={row.result ?? 'Pending'} />,
      priority: 'secondary',
    },
    {
      key: 'status',
      header: sortHeader('Status', 'status', 'left', SORT_DESC),
      cell: (row) => (
        <span
          className={`px-2 py-0.5 text-[11px] font-semibold rounded ${
            row.status === 'promoted'
              ? 'bg-emerald-100 text-emerald-800'
              : 'bg-slate-100 text-slate-600'
          }`}
        >
          {row.status}
        </span>
      ),
      priority: 'secondary',
    },
    {
      key: 'framework',
      header: (
        <>
          {sortHeader('Framework', 'framework')}
          <InfoHint infoKey="modelEdge" />
        </>
      ),
      cell: (row) => <FrameworkCell row={row} />,
      priority: 'tertiary',
    },
    {
      key: 'reason',
      header: sortHeader('Reason', 'reason'),
      cell: (row) => (
        <span className="text-[11px] text-slate-600 max-w-xs block">
          {row.reason}
        </span>
      ),
      priority: 'tertiary',
    },
  ];

  return (
    <section id="table" className="scroll-mt-16 space-y-2" aria-labelledby="qualified-table-title">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2">
        <div role="group" aria-label="Filter qualified picks" className="flex flex-wrap items-center gap-1">
          {PICK_FILTER_OPTIONS.map((option) => (
            <FilterChip
              key={option.id}
              label={option.label}
              count={filterCounts[option.id]}
              active={pickFilter === option.id}
              onClick={() => onPickFilterChange(option.id)}
              tone={option.id === 'qualified' ? 'angle' : 'neutral'}
              ariaLabel={`Filter: ${option.label}`}
            />
          ))}
        </div>
        {loading && <InlineLoading label="Loading research cards…" />}
      </div>

      <h2 id="qualified-table-title" className="sr-only">
        Qualified pick research table
      </h2>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => `${row.fixtureId}:${row.source}:${row.marketId}`}
        caption="Promotion status and research economics for every considered card"
        minWidth="min-w-[1120px]"
        compact
        empty={
          <EmptyState
            title={
              pickFilter === 'qualified'
                ? 'No cards on this slate qualified for the acca'
                : pickFilter === 'promoted'
                  ? 'No cards on this slate are promoted'
                  : 'No cards on this slate yet'
            }
            description="Results appear after matchdays settle — refresh the research data or show all cards to review the full slate."
            action={
              pickFilter !== 'all' ? (
                <button
                  type="button"
                  onClick={() => onPickFilterChange('all')}
                  className="text-xs font-semibold text-emerald-700 underline cursor-pointer"
                >
                  Show all cards
                </button>
              ) : undefined
            }
          />
        }
        renderCard={(row) => (
          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {row.homeTeam} vs {row.awayTeam}
                </p>
                <p className="text-[11px] text-slate-500">
                  {SOURCE_LABELS[row.source] ?? row.source} · {row.kickoffCat}
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-sm font-bold text-slate-800">
                  {fmtOdds(row.odds)}
                </p>
                <p className="font-mono text-xs text-slate-600">
                  {fmtSignedPercent(row.roi)}
                </p>
              </div>
            </div>
            <p className="text-xs font-semibold text-emerald-800">
              {row.selectionLabel}
            </p>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-500">
              <div>
                <dt className="inline">CI: </dt>
                <dd className="inline font-mono text-slate-700">
                  {row.roiCiLow === null || row.roiCiHigh === null
                    ? '—'
                    : `${fmtPercent(row.roiCiLow)}..${fmtPercent(row.roiCiHigh)}`}
                </dd>
              </div>
              <div>
                <dt className="inline">Settled: </dt>
                <dd className="inline font-mono text-slate-700">
                  {fmtCount(row.settled)}
                </dd>
              </div>
              <div>
                <dt className="inline">Result: </dt>
                <dd className="inline">
                  <SettlementLabel status={row.result ?? 'Pending'} />
                </dd>
              </div>
              <div>
                <dt className="inline">Status: </dt>
                <dd className="inline font-semibold text-slate-700">
                  {row.status}
                </dd>
              </div>
            </dl>
            <FrameworkCell row={row} />
            <p className="text-[11px] text-slate-600">{row.reason}</p>
          </div>
        )}
      />
    </section>
  );
}

function FrameworkCell({ row }: { row: QualifiedPickRow }): ReactNode {
  if (!row.frameworkStatus) {
    return <span className="text-[11px] text-slate-400">Not assessed</span>;
  }
  return (
    <>
      <span
        className={`inline-block border rounded px-2 py-0.5 text-[11px] font-semibold ${frameworkTone(
          row.frameworkStatus
        )}`}
      >
        {row.frameworkStatus.replace(/_/g, ' ')}
      </span>
      <span className="block text-[10px] text-slate-500 mt-0.5">
        {row.frameworkConfidence ?? '—'}
        {typeof row.frameworkEdge === 'number'
          ? ` · ${fmtPercent(row.frameworkEdge * 100)} edge`
          : ''}
      </span>
    </>
  );
}
