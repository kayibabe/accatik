import { useEffect, useMemo, useState } from 'react';
import { Info, Layers3, RefreshCw } from 'lucide-react';
import type { AccaStrategy } from '../types/fixtures.ts';
import type {
  TicketReplayResponse,
  TicketReplayRow,
} from '../types/analytics.ts';
import { apiFetch } from '../utils/api.ts';
import { SORT_ASC, SORT_DESC } from '../utils/tableSort.ts';
import {
  fmtCount,
  fmtFixed,
  fmtOdds,
  fmtPercent,
  fmtShortDate,
  fmtSignedPercent,
  fmtUnits,
} from '../utils/format.ts';
import { pnlTone, settlementTone } from '../utils/uiTone.ts';
import { DataTable, type DataTableColumn } from './ui/DataTable.tsx';
import { DataStatus } from './ui/DataStatus.tsx';
import { InfoHint, MetricCard } from './ui/DataCard.tsx';
import { EmptyState, InlineLoading } from './ui/States.tsx';
import { recordLabel } from './performance/format.ts';

interface TicketReplayPanelProps {
  strategy: AccaStrategy;
  minOdds: number;
  maxLegs: number;
  /** Bumped by the Analytics page's Refresh button. */
  refreshKey: number;
}

type ReplayTab = 'shape' | 'strategy' | 'odds' | 'legs';

const TABS: Array<{ id: ReplayTab; label: string; hint: string }> = [
  { id: 'shape', label: 'Ticket shapes', hint: 'The four presets on the slip' },
  { id: 'strategy', label: 'Strategy', hint: 'Current target and leg cap held fixed' },
  { id: 'odds', label: 'Min odds', hint: 'Current strategy and leg cap held fixed' },
  { id: 'legs', label: 'Max legs', hint: 'Current strategy and target held fixed' },
];

function rowsForTab(data: TicketReplayResponse, tab: ReplayTab): TicketReplayRow[] {
  switch (tab) {
    case 'shape':
      return data.shapes;
    case 'strategy':
      return data.strategies;
    case 'odds':
      return data.odds;
    case 'legs':
      return data.legs;
  }
}

/**
 * Inception-to-date replay of the accumulator slip controls. Kept separate from
 * the pick tables because it answers a different question: not "which picks
 * won?" but "what would each way of building a ticket have returned?"
 */
export function TicketReplayPanel({
  strategy,
  minOdds,
  maxLegs,
  refreshKey,
}: TicketReplayPanelProps) {
  const [data, setData] = useState<TicketReplayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [tab, setTab] = useState<ReplayTab>('shape');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const result = await apiFetch<TicketReplayResponse>(
          '/api/analytics/tickets',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              strategy,
              minOdds,
              maxLegs,
              force: refreshKey > 0 || retryKey > 0,
            }),
          }
        );
        if (cancelled) return;
        if (!result || !Array.isArray(result.shapes) || !Array.isArray(result.odds)) {
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
            err instanceof Error ? err.message : 'Could not load ticket replay.'
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [strategy, minOdds, maxLegs, refreshKey, retryKey]);

  const rows = useMemo(() => (data ? rowsForTab(data, tab) : []), [data, tab]);

  useEffect(() => {
    if (rows.length === 0) return;
    if (!rows.some((row) => row.id === selectedId)) setSelectedId(rows[0].id);
  }, [rows, selectedId]);

  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;
  const highlight = data?.current ?? data?.shapes[1] ?? data?.shapes[0] ?? null;
  const highlightSummary = highlight?.summary;

  if (unavailable) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-500">
        <p className="font-semibold text-slate-700">Accumulator ticket replay unavailable</p>
        <p className="mt-1">
          Inception-to-date ticket replay is not available on the connected API
          yet. Pick analytics above are unaffected.
        </p>
        <button
          type="button"
          onClick={() => setRetryKey((key) => key + 1)}
          disabled={loading}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Retry
        </button>
        {error && <p className="mt-1 text-xs text-slate-600">{error}</p>}
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="h-4 w-48 rounded bg-slate-200 animate-pulse" />
        <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[1, 2, 3, 4, 5, 6].map((item) => (
            <div key={item} className="h-16 rounded-lg bg-slate-100 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!data || !highlightSummary) return null;

  const columns: DataTableColumn<TicketReplayRow>[] = [
    {
      key: 'configuration',
      header: 'Configuration',
      cell: (row) => {
        const isSelected = selected?.id === row.id;
        return (
          <>
            <button
              type="button"
              onClick={() => setSelectedId(row.id)}
              aria-pressed={isSelected}
              title={row.description}
              className={`text-left font-medium cursor-pointer hover:text-emerald-700 ${
                isSelected
                  ? 'rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700'
                  : 'text-slate-800'
              }`}
            >
              {row.label}
            </button>
            <span className="ml-2 text-xs text-slate-600">
              {fmtOdds(row.targetOdds)}+ · {row.maxLegs} legs
            </span>
          </>
        );
      },
      sortValue: (row) => row.label,
      priority: 'primary',
    },
    {
      key: 'tickets',
      header: 'Tickets',
      cell: (row) => fmtCount(row.summary.tickets),
      align: 'right',
      sortValue: (row) => row.summary.tickets,
      defaultSortDirection: SORT_DESC,
      priority: 'primary',
    },
    {
      key: 'record',
      header: 'W-L-V',
      cell: (row) =>
        recordLabel(row.summary.wins, row.summary.losses, row.summary.voids, '-'),
      align: 'right',
      sortValue: (row) => row.summary.wins,
      defaultSortDirection: SORT_DESC,
      priority: 'secondary',
    },
    {
      key: 'hitRate',
      header: 'Hit rate',
      cell: (row) => fmtPercent(row.summary.hitRate),
      align: 'right',
      sortValue: (row) => row.summary.hitRate,
      defaultSortDirection: SORT_DESC,
      priority: 'primary',
    },
    {
      key: 'targetHitRate',
      header: 'Target met',
      cell: (row) => fmtPercent(row.summary.targetHitRate),
      align: 'right',
      sortValue: (row) => row.summary.targetHitRate,
      defaultSortDirection: SORT_DESC,
      priority: 'primary',
    },
    {
      key: 'avgOdds',
      header: 'Avg odds',
      cell: (row) => fmtOdds(row.summary.avgOdds),
      align: 'right',
      sortValue: (row) => row.summary.avgOdds,
      defaultSortDirection: SORT_DESC,
      priority: 'tertiary',
    },
    {
      key: 'avgLegs',
      header: 'Avg legs',
      cell: (row) => fmtFixed(row.summary.avgLegs, 1),
      align: 'right',
      sortValue: (row) => row.summary.avgLegs,
      defaultSortDirection: SORT_DESC,
      priority: 'tertiary',
    },
    {
      key: 'breakEven',
      header: 'Break-even',
      cell: (row) => fmtPercent(row.summary.breakEvenHitRate),
      align: 'right',
      sortValue: (row) => row.summary.breakEvenHitRate,
      defaultSortDirection: SORT_DESC,
      priority: 'tertiary',
    },
    {
      key: 'netPnl',
      header: 'Net P&L',
      cell: (row) => (
        <span className={`font-semibold ${pnlTone(row.summary.netPnl)}`}>
          {fmtUnits(row.summary.netPnl)}
        </span>
      ),
      align: 'right',
      sortValue: (row) => row.summary.netPnl,
      defaultSortDirection: SORT_DESC,
      priority: 'primary',
    },
    {
      key: 'roi',
      header: 'ROI',
      cell: (row) => (
        <span
          className={`font-semibold ${
            row.summary.roi === null ? 'text-slate-600' : pnlTone(row.summary.roi)
          }`}
        >
          {fmtSignedPercent(row.summary.roi)}
        </span>
      ),
      align: 'right',
      sortValue: (row) => row.summary.roi,
      defaultSortDirection: SORT_DESC,
      priority: 'primary',
    },
    {
      key: 'maxDrawdown',
      header: 'Max DD',
      cell: (row) => fmtFixed(row.summary.maxDrawdown, 2, { suffix: 'u' }),
      align: 'right',
      sortValue: (row) => row.summary.maxDrawdown,
      defaultSortDirection: SORT_ASC,
      priority: 'tertiary',
    },
    {
      key: 'longestLossStreak',
      header: 'L streak',
      cell: (row) => fmtCount(row.summary.longestLossStreak),
      align: 'right',
      sortValue: (row) => row.summary.longestLossStreak,
      defaultSortDirection: SORT_ASC,
      priority: 'tertiary',
    },
  ];

  return (
    <section aria-label="Accumulator ticket replay" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-slate-500">
            <Layers3 className="h-4 w-4 text-slate-600" aria-hidden="true" />
            Accumulator ticket replay
          </h2>
          <p className="mt-0.5 text-xs text-slate-600">
            One reconstructed ticket per matchday since data collection began ·
            pre-match prices only
          </p>
        </div>
        {loading && <InlineLoading label="Updating…" />}
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed text-slate-600">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-600" aria-hidden="true" />
        <p>
          {data.firstDateIso && data.lastDateIso
            ? `${fmtShortDate(data.firstDateIso)} – ${fmtShortDate(data.lastDateIso)} · `
            : ''}
          {fmtCount(data.matchdays)} matchday{data.matchdays === 1 ? '' : 's'} with{' '}
          {fmtCount(data.pricedFixtures)} clean pre-match priced fixtures.{' '}
          {fmtCount(data.excludedFixtures)} finished fixtures were excluded because
          their prices were captured after kickoff or were incomplete. Each ticket is
          rebuilt with the same engine the slip uses and settled at a flat{' '}
          {data.stakePerTicket}-unit stake; void legs return their stake.
        </p>
      </div>

      <DataStatus
        source="Pre-match archive"
        mode="Research reconstruction"
        note={
          <span className="text-slate-500">
            Generated {fmtShortDate(data.generatedAt)}
          </span>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard
          label="Tickets"
          value={fmtCount(highlightSummary.tickets)}
          detail={highlight?.label ?? 'Current shape'}
        />
        <MetricCard
          label="Record"
          value={recordLabel(
            highlightSummary.wins,
            highlightSummary.losses,
            highlightSummary.voids
          )}
          detail={`${highlightSummary.voids} void`}
        />
        <MetricCard
          label="Hit rate"
          value={fmtPercent(highlightSummary.hitRate)}
          detail={
            <>
              Break-even {fmtPercent(highlightSummary.breakEvenHitRate)}
              <InfoHint
                label="Replay hit rate"
                definition="Winning rebuilt tickets as a share of settled tickets. Voids are returned and are not counted as wins."
                source="Flat-stake ticket replay"
              />
            </>
          }
        />
        <MetricCard
          label="Target reached"
          value={fmtPercent(highlightSummary.targetHitRate)}
          detail={highlight ? `${fmtOdds(highlight.targetOdds)}+` : ''}
        />
        <MetricCard
          label="Net P&L"
          value={fmtUnits(highlightSummary.netPnl)}
          detail={`Avg odds ${fmtOdds(highlightSummary.avgOdds)}`}
          tone={pnlTone(highlightSummary.netPnl)}
          infoKey="pnl"
        />
        <MetricCard
          label="ROI"
          value={fmtSignedPercent(highlightSummary.roi)}
          detail={`Max drawdown ${fmtFixed(highlightSummary.maxDrawdown, 2, { suffix: 'u' })}`}
          tone={
            highlightSummary.roi === null
              ? 'text-slate-600'
              : pnlTone(highlightSummary.roi)
          }
          infoKey="roi"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600">
              Replay by control
            </h3>
            <p className="mt-0.5 text-xs text-slate-600">
              {TABS.find((item) => item.id === tab)?.hint}
            </p>
          </div>
          <div className="inline-flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setTab(item.id);
                  setSelectedId(null);
                }}
                aria-pressed={tab === item.id}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                  tab === item.id
                    ? 'bg-white text-emerald-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          caption="Ticket replay results by control combination"
          minWidth="min-w-[1080px]"
          compact
          details={(row) => (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
              {[
                ['Tickets', fmtCount(row.summary.tickets)],
                ['W-L-V', recordLabel(row.summary.wins, row.summary.losses, row.summary.voids, '-')],
                ['Hit rate', fmtPercent(row.summary.hitRate)],
                ['Target met', fmtPercent(row.summary.targetHitRate)],
                ['Avg odds', fmtOdds(row.summary.avgOdds)],
                ['Avg legs', fmtFixed(row.summary.avgLegs, 1)],
                ['Break-even', fmtPercent(row.summary.breakEvenHitRate)],
                ['Net P&L', fmtUnits(row.summary.netPnl)],
                ['ROI', fmtSignedPercent(row.summary.roi)],
                ['Max DD', fmtFixed(row.summary.maxDrawdown, 2, { suffix: 'u' })],
                ['L streak', fmtCount(row.summary.longestLossStreak)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-slate-600">{label}</dt>
                  <dd className="font-mono text-slate-700">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          renderCard={(row) => {
            const isSelected = selected?.id === row.id;
            return (
              <button
                type="button"
                onClick={() => setSelectedId(row.id)}
                aria-pressed={isSelected}
                title={row.description}
                className={`w-full rounded-lg border bg-white px-3 py-2 text-left ${
                  isSelected ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-200'
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-800">{row.label}</span>
                  <span
                    className={`font-mono text-sm font-bold ${
                      row.summary.roi === null
                        ? 'text-slate-600'
                        : pnlTone(row.summary.roi)
                    }`}
                  >
                    {fmtSignedPercent(row.summary.roi)}
                  </span>
                </span>
                <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs text-slate-500">
                  <span>{fmtOdds(row.targetOdds)}+ · {row.maxLegs} legs</span>
                  <span>{fmtCount(row.summary.tickets)} tickets</span>
                  <span>
                    {recordLabel(
                      row.summary.wins,
                      row.summary.losses,
                      row.summary.voids,
                      '-'
                    )}
                  </span>
                  <span>Hit {fmtPercent(row.summary.hitRate)}</span>
                  <span className={pnlTone(row.summary.netPnl)}>
                    {fmtUnits(row.summary.netPnl)}
                  </span>
                  <span>
                    DD {fmtFixed(row.summary.maxDrawdown, 2, { suffix: 'u' })}
                  </span>
                </span>
              </button>
            );
          }}
          empty={
            <EmptyState
              title="No settleable tickets for these controls yet"
              description="Try another control tab after more matchdays have been archived."
            />
          }
        />
        {selected && (
          <div className="border-t border-slate-100 px-4 py-3">
            <p className="text-xs font-semibold text-slate-600">
              Matchday tickets · {selected.label}
            </p>
            {selected.daily.length === 0 ? (
              <p className="mt-1 text-xs text-slate-600">
                No matchday produced a settleable ticket for this combination.
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selected.daily.map((day) => (
                  <span
                    key={day.dateIso}
                    title={`${day.dateIso}: ${day.status} at ${fmtOdds(day.odds)} with ${day.legs} legs${day.targetMet ? ' (target met)' : ''}`}
                    className={`rounded border px-1.5 py-0.5 font-mono text-xs tabular-nums ${settlementTone(day.status)}`}
                  >
                    {fmtShortDate(day.dateIso)} · {day.status} · {fmtOdds(day.odds)}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        <p className="border-t border-slate-100 px-4 py-2 text-xs leading-relaxed text-slate-600">
          Replay uses the frozen pre-match prices and the same builder as the
          slip. Manual Reset Pick / Clear edits and saved ledger slips are not
          included. Short tickets are kept in the record and counted against
          "Target met" rather than padded with lottery legs. Research figures,
          not real money.
        </p>
      </div>
    </section>
  );
}
