import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, RefreshCw, Wand2 } from 'lucide-react';
import type { AccaStrategy } from '../types/fixtures.ts';
import type {
  QualifiedPicksResponse,
  RoiAccaResponse,
  RoiRegistryEntry,
} from '../types/analytics.ts';
import { apiFetch } from '../utils/api.ts';
import {
  SORT_ASC,
  SORT_DESC,
  sortRows,
  type SortState,
} from '../utils/tableSort.ts';
import { makeSortHandler } from '../utils/tableSort.ts';
import { SortableTh } from './SortableTh.tsx';
import { SettlementLabel } from './SettlementLabel.tsx';

interface PositiveRoiViewProps {
  strategy: AccaStrategy;
  selectedDate: string;
  displayDate: string;
  onGoToSlate: () => void;
}

type PickFilter = 'all' | 'qualified' | 'promoted';

const FILTER_OPTIONS: ReadonlyArray<{ id: PickFilter; label: string }> = [
  { id: 'all', label: 'All cards' },
  { id: 'qualified', label: 'Qualified only' },
  { id: 'promoted', label: 'Promoted only' },
];

const SOURCE_LABELS: Record<string, string> = {
  angle: 'Recommended Angle',
  cover: 'Safer cover',
  note: 'Analyst note',
};

const FRAMEWORK_TONE: Record<string, string> = {
  QUALIFIED: 'bg-emerald-100 text-emerald-800',
  CONDITIONAL_REVIEW: 'bg-amber-100 text-amber-800',
  SCREEN_ONLY: 'bg-slate-100 text-slate-600',
  REJECTED: 'bg-red-100 text-red-700',
  INSUFFICIENT_DATA: 'bg-slate-100 text-slate-500',
};

/** Read-only research view of the promoted-ROI whitelist and its daily table. */
export function PositiveRoiView({
  strategy,
  selectedDate,
  displayDate,
  onGoToSlate,
}: PositiveRoiViewProps) {
  const [qualified, setQualified] = useState<QualifiedPicksResponse | null>(null);
  const [registry, setRegistry] = useState<RoiRegistryEntry[]>([]);
  const [ticket, setTicket] = useState<RoiAccaResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickFilter, setPickFilter] = useState<PickFilter>('all');
  const [sort, setSort] = useState<SortState>({ key: null, direction: SORT_ASC });
  const onSort = makeSortHandler(setSort);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [picks, reg] = await Promise.all([
        apiFetch<QualifiedPicksResponse>('/api/analytics/qualified-picks', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ dateIso: selectedDate, strategy }),
        }),
        apiFetch<{ entries: RoiRegistryEntry[] }>('/api/analytics/roi-registry', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ strategy }),
        }),
      ]);
      setQualified(picks);
      setRegistry(reg.entries);
      setTicket(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load ROI research data.');
    } finally {
      setLoading(false);
    }
  }, [selectedDate, strategy]);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = async () => {
    setBuilding(true);
    setError(null);
    try {
      setTicket(
        await apiFetch<RoiAccaResponse>('/api/analytics/roi-acca', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            dateIso: selectedDate,
            strategy,
            targetOdds: 5,
            maxLegs: 3,
          }),
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build the ROI accumulator.');
    } finally {
      setBuilding(false);
    }
  };

  const promoted = registry.filter((entry) => entry.status === 'promoted');
  const filterCounts = useMemo(() => {
    const cards = qualified?.rows ?? [];
    return {
      all: cards.length,
      qualified: cards.filter((row) => row.eligibleForAcca).length,
      promoted: cards.filter((row) => row.status === 'promoted').length,
    };
  }, [qualified]);
  const rows = useMemo(() => {
    const source = (qualified?.rows ?? []).filter((row) =>
      pickFilter === 'qualified'
        ? row.eligibleForAcca
        : pickFilter === 'promoted'
          ? row.status === 'promoted'
          : true
    );
    return sortRows(source, sort, {
      fixture: (row) => `${row.homeTeam} ${row.awayTeam}`,
      kickoff: (row) => row.kickoffTimestamp,
      source: (row) => SOURCE_LABELS[row.source] ?? row.source,
      selection: (row) => row.selectionLabel,
      odds: (row) => row.odds,
      roi: (row) => row.roi,
      ci: (row) => row.roiCiLow,
      settled: (row) => row.settled,
      result: (row) => row.result ?? 'Pending',
      status: (row) => row.status,
      framework: (row) => row.frameworkStatus ?? '',
    });
  }, [qualified, pickFilter, sort]);

  return (
    <section aria-label="Positive ROI research" className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1 max-w-3xl">
          <p className="text-xs font-medium text-slate-500">
            {displayDate} · Research only · Prematch, flat stake
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Positive-ROI Qualified Picks
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            Only selections whose strategy/source/key is promoted after a
            clustered ROI check are admitted. Every other card stays in the
            table with the reason it was withheld.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void generate()}
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
        </div>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900 flex gap-2.5">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
        <p>
          <span className="font-semibold">Research, not a recommendation.</span>{' '}
          Promoted selections must also clear every framework gate, and the
          accumulator is capped at three legs. A 5.00 target may therefore be
          left short rather than padded. Bookmaker margins compound with every
          leg; no ticket here is presented as positive-EV or recommended. Flat
          staking and exposure caps still apply.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl grid grid-cols-2 lg:grid-cols-4 divide-x divide-slate-200">
        <div className="p-5">
          <p className="text-xs text-slate-500">Promoted selections</p>
          <p className="mt-1 text-2xl font-bold font-mono text-slate-900 tabular-nums">
            {promoted.length}
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs text-slate-500">Qualified on this slate</p>
          <p className="mt-1 text-2xl font-bold font-mono text-emerald-700 tabular-nums">
            {qualified?.eligibleCount ?? 0}
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs text-slate-500">Cards considered</p>
          <p className="mt-1 text-2xl font-bold font-mono text-slate-900 tabular-nums">
            {qualified?.rows.length ?? 0}
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs text-slate-500">Registry snapshot</p>
          <p className="mt-1 text-xs font-mono text-slate-600 tabular-nums">
            {registry[0]?.snapshotDateIso ?? '—'}
          </p>
        </div>
      </div>

      {ticket && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <p className="text-sm font-semibold text-slate-900">
                Research accumulator · {ticket.legs.length} legs ·{' '}
                <span className="font-mono">{ticket.totalOdds.toFixed(2)}</span> odds
              </p>
              <p className="text-[11px] text-slate-500">
                {ticket.targetReached
                  ? '5.00 target reached using promoted markets only.'
                  : `Target not reached with ${ticket.maxLegs} promoted legs; left short rather than padding.`}
                {' '}Fair chance {ticket.economics.fairChance.toFixed(1)}% vs break-even{' '}
                {ticket.economics.breakEvenChance.toFixed(1)}% · expected ROI{' '}
                {ticket.economics.expectedRoi.toFixed(1)}%.
              </p>
            </div>
            <span className="px-2 py-1 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded">
              SHADOW ONLY · NOT RECOMMENDED
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="text-xs text-slate-600 bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-4">Fixture</th>
                  <th className="py-2.5 px-4">Selection</th>
                  <th className="py-2.5 px-4 text-right">Odds</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {ticket.legs.map((leg) => (
                  <tr key={`${leg.fixtureId}:${leg.marketId}`}>
                    <td className="py-2.5 px-4">
                      {leg.homeTeam} vs {leg.awayTeam}
                    </td>
                    <td className="py-2.5 px-4 font-semibold text-emerald-800">
                      {leg.marketLabel}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                      {leg.odds.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-[11px] leading-relaxed text-amber-900 bg-amber-50 border-t border-amber-200">
            {ticket.riskWarning} This ticket is recorded in the shadow ledger at
            a flat one-unit stake ({ticket.stake}) and is never placed with a
            bookmaker.
          </p>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-slate-50 border-b border-slate-200">
          <div
            role="group"
            aria-label="Filter qualified picks"
            className="flex flex-wrap items-center gap-1"
          >
            {FILTER_OPTIONS.map((option) => {
              const isActive = pickFilter === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setPickFilter(option.id)}
                  aria-pressed={isActive}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                    isActive
                      ? option.id === 'qualified'
                        ? 'bg-emerald-700 border-emerald-700 text-white'
                        : 'bg-slate-900 border-slate-900 text-white'
                      : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <span>{option.label}</span>
                  <span
                    className={`font-mono tabular-nums ${
                      isActive ? 'text-white/70' : 'text-slate-400'
                    }`}
                  >
                    {filterCounts[option.id]}
                  </span>
                </button>
              );
            })}
          </div>
          {loading && <span className="text-[11px] text-slate-500">Loading…</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead className="text-xs font-semibold text-slate-600 bg-slate-50 border-b border-slate-200">
              <tr>
                <SortableTh label="Fixture" columnKey="fixture" sort={sort} onSort={onSort} className="py-3 px-4" />
                <SortableTh label="Kickoff" columnKey="kickoff" sort={sort} onSort={onSort} className="py-3 px-4" />
                <SortableTh label="Card" columnKey="source" sort={sort} onSort={onSort} className="py-3 px-4" />
                <SortableTh label="Selection" columnKey="selection" sort={sort} onSort={onSort} className="py-3 px-4" />
                <SortableTh label="Odds" columnKey="odds" sort={sort} onSort={onSort} defaultDirection={SORT_DESC} align="right" className="py-3 px-4" />
                <SortableTh label="ROI / CI" columnKey="ci" sort={sort} onSort={onSort} defaultDirection={SORT_DESC} align="right" className="py-3 px-4" />
                <SortableTh label="Settled" columnKey="settled" sort={sort} onSort={onSort} defaultDirection={SORT_DESC} align="right" className="py-3 px-4" />
                <SortableTh label="Result" columnKey="result" sort={sort} onSort={onSort} className="py-3 px-4" />
                <SortableTh label="Status" columnKey="status" sort={sort} onSort={onSort} className="py-3 px-4" />
                <SortableTh label="Framework" columnKey="framework" sort={sort} onSort={onSort} className="py-3 px-4" />
                <th className="py-3 px-4 text-xs font-semibold text-slate-600">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="py-10 text-center text-sm text-slate-500">
                    <p>
                      {pickFilter === 'qualified'
                        ? 'No cards on this slate qualified for the acca.'
                        : pickFilter === 'promoted'
                          ? 'No cards on this slate are promoted.'
                          : 'No cards on this slate yet.'}
                    </p>
                    {pickFilter !== 'all' && (
                      <button
                        type="button"
                        onClick={() => setPickFilter('all')}
                        className="mt-2 font-semibold text-emerald-700 underline cursor-pointer"
                      >
                        Show all cards
                      </button>
                    )}
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr
                  key={`${row.fixtureId}:${row.source}:${row.marketId}`}
                  className={row.eligibleForAcca ? 'bg-emerald-50/40' : undefined}
                >
                  <td className="py-3 px-4">
                    <p className="font-semibold text-slate-900">
                      {row.homeTeam} vs {row.awayTeam}
                    </p>
                    <p className="text-[11px] text-slate-500">{row.competition}</p>
                  </td>
                  <td className="py-3 px-4 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                    {row.kickoffCat}
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-700">
                    {SOURCE_LABELS[row.source] ?? row.source}
                  </td>
                  <td className="py-3 px-4 font-semibold text-emerald-800">
                    {row.selectionLabel}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums">
                    {row.odds.toFixed(2)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-[11px] tabular-nums text-slate-700">
                    {row.roi === null ? '—' : `${row.roi}%`}
                    <span className="block text-slate-400">
                      {row.roiCiLow === null || row.roiCiHigh === null
                        ? '—'
                        : `${row.roiCiLow}..${row.roiCiHigh}`}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                    {row.settled}
                  </td>
                  <td className="py-3 px-4">
                    <SettlementLabel status={row.result ?? 'Pending'} />
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`px-2 py-0.5 text-[11px] font-semibold rounded ${
                        row.status === 'promoted'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    {row.frameworkStatus ? (
                      <>
                        <span
                          className={`px-2 py-0.5 text-[11px] font-semibold rounded ${
                            FRAMEWORK_TONE[row.frameworkStatus] ??
                            'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {row.frameworkStatus.replace(/_/g, ' ')}
                        </span>
                        <span className="block text-[10px] text-slate-500 mt-0.5">
                          {row.frameworkConfidence ?? '—'}
                          {typeof row.frameworkEdge === 'number'
                            ? ` · ${(row.frameworkEdge * 100).toFixed(1)} pp edge`
                            : ''}
                        </span>
                      </>
                    ) : (
                      <span className="text-[11px] text-slate-400">
                        Not assessed
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-[11px] text-slate-600 max-w-xs">
                    {row.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
