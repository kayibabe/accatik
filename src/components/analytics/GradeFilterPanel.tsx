import { useEffect, useMemo, useState } from 'react';
import { Filter, Layers3, RefreshCw } from 'lucide-react';
import type { SettlementStatus } from '../../types/fixtures.ts';
import type {
  GradeFilterGrade,
  GradeFilterResponse,
} from '../../types/analytics.ts';
import { apiFetch } from '../../utils/api.ts';
import {
  fmtCount,
  fmtOdds,
  fmtPercent,
  fmtShortDate,
  fmtSignedPercent,
  fmtUnits,
} from '../../utils/format.ts';
import { pnlTone } from '../../utils/uiTone.ts';
import { SettlementLabel } from '../SettlementLabel.tsx';
import { DataCard, InfoHint, MetricCard } from '../ui/DataCard.tsx';
import { DataTable, type DataTableColumn } from '../ui/DataTable.tsx';
import { EmptyState, InlineLoading } from '../ui/States.tsx';
import { recordLabel } from '../performance/format.ts';

interface GradeFilterPanelProps {
  strategy: string;
  refreshKey: number;
}

const LEG_OPTIONS = [2, 3, 4, 5] as const;
const STATUS_FILTERS = ['All', 'Win', 'Lost', 'Void'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

function gradeTone(grade: GradeFilterGrade): string {
  return grade === 'High'
    ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
    : 'border-sky-300 bg-sky-50 text-sky-700';
}

function statusTone(status: StatusFilter): string {
  if (status === 'All') return 'border-slate-300 bg-white text-slate-700';
  if (status === 'Win') return 'border-emerald-300 bg-emerald-50 text-emerald-700';
  if (status === 'Lost') return 'border-red-300 bg-red-50 text-red-600';
  return 'border-amber-300 bg-amber-50 text-amber-700';
}

function isSettlementStatus(value: StatusFilter): value is Exclude<StatusFilter, 'All'> {
  return value !== 'All';
}

/**
 * Archive version of the Pick Guide's High + Solid shortlist rule.
 *
 * It shows the filtered Recommended Angle cards with the app's own settlement
 * label, then replays one accumulator per matchday from exactly those cards.
 * The view is deliberately research-only: the grade comes from the book's
 * de-vigged probability, so it is a quality filter, not proof of edge.
 */
export function GradeFilterPanel({ strategy, refreshKey }: GradeFilterPanelProps) {
  const [legs, setLegs] = useState<number>(2);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [data, setData] = useState<GradeFilterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const result = await apiFetch<GradeFilterResponse>(
          '/api/analytics/grade-filter',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              strategy,
              legs,
              force: refreshKey > 0 || retryKey > 0,
            }),
          }
        );
        if (cancelled) return;
        if (!result || !Array.isArray(result.matches) || !Array.isArray(result.tickets)) {
          setUnavailable(true);
          setData(null);
          return;
        }
        setUnavailable(false);
        setData(result);
      } catch (err) {
        if (!cancelled) {
          setUnavailable(true);
          setError(
            err instanceof Error ? err.message : 'Could not load the grade filter.'
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [strategy, legs, refreshKey, retryKey]);

  const visibleMatches = useMemo(() => {
    if (!data) return [];
    if (!isSettlementStatus(statusFilter)) return data.matches;
    return data.matches.filter((match) => match.status === statusFilter);
  }, [data, statusFilter]);

  if (unavailable) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-xs text-slate-500">
        <p className="font-semibold text-slate-700">Grade filter unavailable</p>
        <p className="mt-1">
          The API Function needs a redeploy to expose the archived High + Solid
          filter. The rest of the analytics tab is unaffected.
        </p>
        <button
          type="button"
          onClick={() => setRetryKey((key) => key + 1)}
          disabled={loading}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
        >
          <RefreshCw
            className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          Retry
        </button>
        {error && <p className="mt-1 text-[11px] text-slate-400">{error}</p>}
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="h-4 w-56 rounded bg-slate-200 animate-pulse" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[1, 2, 3, 4, 5].map((item) => (
            <div key={item} className="h-16 rounded-lg bg-slate-100 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const pick = data.pickSummary;
  const ticket = data.ticketSummary;
  const matchColumns: DataTableColumn<(typeof data.matches)[number]>[] = [
    {
      key: 'date',
      header: 'Date',
      cell: (row) => fmtShortDate(row.dateIso),
      priority: 'primary',
    },
    {
      key: 'fixture',
      header: 'Match',
      cell: (row) => (
        <div className="min-w-0">
          <span className="font-medium text-slate-800">
            {row.homeTeam} vs {row.awayTeam}
          </span>
          <span className="block truncate text-[10px] text-slate-400">
            {row.competition}
          </span>
        </div>
      ),
      priority: 'primary',
    },
    {
      key: 'grade',
      header: 'Grade',
      cell: (row) => (
        <span
          className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold ${gradeTone(row.grade)}`}
        >
          {row.grade}
        </span>
      ),
      priority: 'primary',
    },
    {
      key: 'angle',
      header: 'Recommended Angle',
      cell: (row) => row.marketLabel,
      priority: 'secondary',
    },
    {
      key: 'odds',
      header: 'Odds',
      cell: (row) => fmtOdds(row.odds),
      align: 'right',
      priority: 'secondary',
    },
    {
      key: 'status',
      header: 'Result',
      cell: (row) => <SettlementLabel status={row.status} />,
      priority: 'primary',
    },
  ];

  const ticketColumns: DataTableColumn<(typeof data.tickets)[number]>[] = [
    {
      key: 'date',
      header: 'Matchday',
      cell: (row) => fmtShortDate(row.dateIso),
      priority: 'primary',
    },
    {
      key: 'legs',
      header: 'Filtered legs',
      cell: (row) => (
        <div className="max-w-[320px] space-y-0.5">
          {row.picks.map((leg) => (
            <div key={leg.fixtureId} className="truncate text-[11px] text-slate-600">
              <span className={`font-semibold ${leg.grade === 'High' ? 'text-emerald-700' : 'text-sky-700'}`}>
                {leg.grade}
              </span>
              {' · '}
              {leg.homeTeam} vs {leg.awayTeam} · {leg.marketLabel} @{' '}
              {fmtOdds(leg.odds)}
            </div>
          ))}
        </div>
      ),
      priority: 'primary',
    },
    {
      key: 'count',
      header: 'Legs',
      cell: (row) => row.legs,
      align: 'right',
      priority: 'secondary',
    },
    {
      key: 'odds',
      header: 'Odds',
      cell: (row) => fmtOdds(row.odds),
      align: 'right',
      priority: 'primary',
    },
    {
      key: 'status',
      header: 'Result',
      cell: (row) => <SettlementLabel status={row.status} />,
      priority: 'primary',
    },
    {
      key: 'pnl',
      header: 'P&L',
      cell: (row) => (
        <span className={`font-semibold ${pnlTone(row.pnl)}`}>
          {fmtUnits(row.pnl)}
        </span>
      ),
      align: 'right',
      priority: 'primary',
    },
  ];

  return (
    <section aria-label="High and Solid grade filter" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-slate-500">
            <Filter className="h-4 w-4 text-slate-400" aria-hidden="true" />
            High + Solid archive filter
          </h2>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {data.firstDateIso ?? '—'} → {data.lastDateIso ?? '—'} · prematch prices
            only · {data.matchdays} matchdays · one-unit stakes
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-slate-500">
            ACCA legs
          </span>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {LEG_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={legs === option}
                onClick={() => setLegs(option)}
                className={`rounded-md px-2 py-1 text-[11px] font-semibold cursor-pointer ${
                  legs === option
                    ? 'bg-emerald-700 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-white'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          {loading && <InlineLoading label="Updating…" />}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          label="Filtered matches"
          value={fmtCount(pick.matches)}
          detail={`${pick.wins}W · ${pick.losses}L · ${pick.voids}V`}
        />
        <MetricCard
          label="Pick hit rate"
          value={fmtPercent(pick.hitRate)}
          detail={`${pick.staked} staked`}
        />
        <MetricCard
          label="Pick ROI"
          value={fmtSignedPercent(pick.roi)}
          detail={`${fmtUnits(pick.netPnl)} flat P&L`}
          tone={pnlTone(pick.netPnl)}
        />
        <MetricCard
          label="Simulated tickets"
          value={fmtCount(ticket.tickets)}
          detail={recordLabel(ticket.wins, ticket.losses, ticket.voids, '-')}
        />
        <MetricCard
          label="Ticket ROI"
          value={fmtSignedPercent(ticket.roi)}
          detail={`${fmtUnits(ticket.netPnl)} · ${ticket.positiveDays} winning days`}
          tone={pnlTone(ticket.netPnl)}
          infoKey="roi"
        />
      </div>

      <DataCard
        title="Filtered matches and results"
        subtitle="Recommended Angle cards whose fair probability was High or Solid at capture"
        actions={
          <div className="inline-flex flex-wrap gap-1">
            {STATUS_FILTERS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={statusFilter === option}
                onClick={() => setStatusFilter(option)}
                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold cursor-pointer ${statusTone(option)} ${
                  statusFilter === option ? 'ring-1 ring-slate-400' : ''
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        }
      >
        <DataTable
          columns={matchColumns}
          rows={visibleMatches}
          rowKey={(row) => row.fixtureId}
          caption="Archived matches graded High or Solid with their settlement result"
          minWidth="min-w-[720px]"
          compact
          empty={
            <p className="py-6 text-center text-xs text-slate-500">
              No High + Solid matches with this result in the archive.
            </p>
          }
        />
      </DataCard>

      <DataCard
        title="Simulated accumulator tickets"
        subtitle={`One ${data.targetLegs}-leg ticket per matchday built from the filtered pool, by the app's accumulator engine`}
        actions={
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
            <Layers3 className="h-3.5 w-3.5" aria-hidden="true" />
            {fmtCount(ticket.tickets)} reconstruct
            {ticket.tickets === 1 ? '' : 'ed'} tickets
          </span>
        }
      >
        <DataTable
          columns={ticketColumns}
          rows={data.tickets}
          rowKey={(row) => row.id}
          caption="Simulated accumulator tickets from High and Solid picks"
          minWidth="min-w-[760px]"
          compact
          details={(row) => (
            <ul className="space-y-1 text-[11px] text-slate-600">
              {row.picks.map((leg) => (
                <li key={leg.fixtureId} className="flex flex-wrap items-center gap-2">
                  <span className={`font-semibold ${leg.grade === 'High' ? 'text-emerald-700' : 'text-sky-700'}`}>
                    {leg.grade}
                  </span>
                  <span>
                    {leg.homeTeam} vs {leg.awayTeam} · {leg.marketLabel} @{' '}
                    {fmtOdds(leg.odds)}
                  </span>
                  <SettlementLabel status={leg.status} />
                </li>
              ))}
            </ul>
          )}
          empty={
            <EmptyState
              title="No tickets to simulate"
              description="No matchday had at least two prematch High or Solid angle cards."
            />
          }
        />
        <p className="mt-3 flex items-start gap-1 text-[11px] leading-relaxed text-slate-400">
          <InfoHint
            label="Research-only simulation"
            definition="These are hypothetical tickets rebuilt from archived prematch prices, not saved slips. Grade is derived from the book's de-vigged probability, so a positive hit rate is not evidence of betting edge."
            source="High + Solid archive filter"
          />
          <span>
            Grade screens quality, not value. Filter on result above to inspect
            individual winners, losers and voids; use the leg selector to compare
            ticket sizes.
          </span>
        </p>
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-amber-700">
          {data.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      </DataCard>
    </section>
  );
}
