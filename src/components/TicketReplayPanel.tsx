import { useEffect, useMemo, useState } from 'react';
import { Info, Layers3, RefreshCw } from 'lucide-react';
import type {
  AccaStrategy,
} from '../types/fixtures.ts';
import type {
  TicketReplayResponse,
  TicketReplayRow,
} from '../types/analytics.ts';
import { apiFetch } from '../utils/api.ts';

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

const percent = (value: number | null): string =>
  value === null ? '—' : `${value.toFixed(1)}%`;

const signedPercent = (value: number | null): string => {
  if (value === null) return '—';
  if (value > 0) return `+${value.toFixed(1)}%`;
  if (value < 0) return `${value.toFixed(1)}%`;
  return '0.0%';
};

const signedUnits = (value: number): string =>
  `${value > 0 ? '+' : value < 0 ? '-' : ''}${Math.abs(value).toFixed(2)}u`;

const pnlTone = (value: number): string =>
  value > 0 ? 'text-emerald-700' : value < 0 ? 'text-red-600' : 'text-slate-700';

const statusTone = (status: string): string =>
  status === 'Win'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : status === 'Lost'
      ? 'border-red-200 bg-red-50 text-red-700'
      : 'border-slate-200 bg-slate-50 text-slate-500';

function shortDate(dateIso: string): string {
  const [year, month, day] = dateIso.split('-').map(Number);
  if (!year || !month || !day) return dateIso;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function ReplayMetric({
  label,
  value,
  detail,
  tone = 'text-slate-900',
}: {
  label: string;
  value: string;
  detail: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className={`mt-0.5 font-mono text-base font-bold tabular-nums ${tone}`}>
        {value}
      </p>
      <p className="truncate text-[10px] text-slate-400" title={detail}>
        {detail}
      </p>
    </div>
  );
}

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
      <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-xs text-slate-500">
        <p className="font-semibold text-slate-700">Accumulator ticket replay unavailable</p>
        <p className="mt-1">
          The API Function needs a redeploy to expose the inception-to-date
          ticket analysis. Pick analytics above are unaffected.
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
        {error && <p className="mt-1 text-[11px] text-slate-400">{error}</p>}
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

  return (
    <section aria-label="Accumulator ticket replay" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-slate-500">
            <Layers3 className="h-4 w-4 text-slate-400" aria-hidden="true" />
            Accumulator ticket replay
          </h2>
          <p className="mt-0.5 text-[11px] text-slate-400">
            One reconstructed ticket per matchday since data collection began ·
            pre-match prices only
          </p>
        </div>
        {loading && (
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
            <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
            Updating…
          </span>
        )}
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs leading-relaxed text-slate-600">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        <p>
          {data.firstDateIso && data.lastDateIso
            ? `${shortDate(data.firstDateIso)} – ${shortDate(data.lastDateIso)} · `
            : ''}
          {data.matchdays} matchday{data.matchdays === 1 ? '' : 's'} with{' '}
          {data.pricedFixtures} clean pre-match priced fixtures.{' '}
          {data.excludedFixtures} finished fixtures were excluded because their
          prices were captured after kickoff or were incomplete. Each ticket is
          rebuilt with the same engine the slip uses and settled at a flat{' '}
          {data.stakePerTicket}-unit stake; void legs return their stake.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <ReplayMetric
          label="Tickets"
          value={String(highlightSummary.tickets)}
          detail={highlight?.label ?? 'Current shape'}
        />
        <ReplayMetric
          label="Record"
          value={`${highlightSummary.wins}W · ${highlightSummary.losses}L`}
          detail={`${highlightSummary.voids} void`}
        />
        <ReplayMetric
          label="Hit rate"
          value={percent(highlightSummary.hitRate)}
          detail={`Break-even ${percent(highlightSummary.breakEvenHitRate)}`}
        />
        <ReplayMetric
          label="Target reached"
          value={percent(highlightSummary.targetHitRate)}
          detail={highlight ? `${highlight.targetOdds.toFixed(2)}+` : ''}
        />
        <ReplayMetric
          label="Net P&L"
          value={signedUnits(highlightSummary.netPnl)}
          detail={`Avg odds ${highlightSummary.avgOdds?.toFixed(2) ?? '—'}`}
          tone={pnlTone(highlightSummary.netPnl)}
        />
        <ReplayMetric
          label="ROI"
          value={signedPercent(highlightSummary.roi)}
          detail={`Max drawdown ${highlightSummary.maxDrawdown.toFixed(2)}u`}
          tone={pnlTone(highlightSummary.roi ?? 0)}
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-600">
              Replay by control
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-400">
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
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Configuration</th>
                <th className="px-3 py-2 text-right font-semibold">Tickets</th>
                <th className="px-3 py-2 text-right font-semibold">W-L-V</th>
                <th className="px-3 py-2 text-right font-semibold">Hit rate</th>
                <th className="px-3 py-2 text-right font-semibold">Target met</th>
                <th className="px-3 py-2 text-right font-semibold">Avg odds</th>
                <th className="px-3 py-2 text-right font-semibold">Avg legs</th>
                <th className="px-3 py-2 text-right font-semibold">Break-even</th>
                <th className="px-3 py-2 text-right font-semibold">Net P&amp;L</th>
                <th className="px-3 py-2 text-right font-semibold">ROI</th>
                <th className="px-3 py-2 text-right font-semibold">Max DD</th>
                <th className="px-4 py-2 text-right font-semibold">L streak</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => {
                const s = row.summary;
                const isSelected = selected?.id === row.id;
                return (
                  <tr
                    key={row.id}
                    className={isSelected ? 'bg-emerald-50/60' : 'hover:bg-slate-50/60'}
                  >
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        onClick={() => setSelectedId(row.id)}
                        aria-pressed={isSelected}
                        title={row.description}
                        className="text-left font-medium text-slate-800 hover:text-emerald-700 cursor-pointer"
                      >
                        {row.label}
                      </button>
                      <span className="ml-2 text-[10px] text-slate-400">
                        {row.targetOdds.toFixed(2)}+ · {row.maxLegs} legs
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{s.tickets}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600 tabular-nums">
                      {s.wins}-{s.losses}-{s.voids}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
                      {percent(s.hitRate)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600 tabular-nums">
                      {percent(s.targetHitRate)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600 tabular-nums">
                      {s.avgOdds?.toFixed(2) ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600 tabular-nums">
                      {s.avgLegs?.toFixed(1) ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600 tabular-nums">
                      {percent(s.breakEvenHitRate)}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono font-semibold tabular-nums ${pnlTone(s.netPnl)}`}>
                      {signedUnits(s.netPnl)}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono font-semibold tabular-nums ${pnlTone(s.roi ?? 0)}`}>
                      {signedPercent(s.roi)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600 tabular-nums">
                      {s.maxDrawdown.toFixed(2)}u
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-slate-600 tabular-nums">
                      {s.longestLossStreak}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-6 text-center text-xs text-slate-400">
                    No settleable tickets for these controls yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {selected && (
          <div className="border-t border-slate-100 px-4 py-3">
            <p className="text-[11px] font-semibold text-slate-600">
              Matchday tickets · {selected.label}
            </p>
            {selected.daily.length === 0 ? (
              <p className="mt-1 text-[11px] text-slate-400">
                No matchday produced a settleable ticket for this combination.
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selected.daily.map((day) => (
                  <span
                    key={day.dateIso}
                    title={`${day.dateIso}: ${day.status} at ${day.odds.toFixed(2)} with ${day.legs} legs${day.targetMet ? ' (target met)' : ''}`}
                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${statusTone(day.status)}`}
                  >
                    {shortDate(day.dateIso)} · {day.status} · {day.odds.toFixed(2)}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        <p className="border-t border-slate-100 px-4 py-2 text-[11px] leading-relaxed text-slate-400">
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
