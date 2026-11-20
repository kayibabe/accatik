import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Filter, RefreshCw } from 'lucide-react';
import type { LedgerBreakdownRow, LedgerSummary } from '../types/ledger.ts';
import { apiFetch } from '../utils/api.ts';
import {
  SORT_DESC,
  makeSortHandler,
  sortRows,
  type SortAccessors,
  type SortState,
} from '../utils/tableSort.ts';
import {
  selectShadowRoiShortlist,
  SHADOW_ROI_SHORTLIST,
} from '../utils/shadowRoiFilter.ts';
import { SortableTh } from './SortableTh.tsx';

const percent = (value: number | null): string =>
  value === null ? '—' : `${value.toFixed(1)}%`;

const signedPercent = (value: number | null): string => {
  if (value === null) return '—';
  if (value > 0) return `+${value.toFixed(1)}%`;
  if (value < 0) return `${value.toFixed(1)}%`;
  return '0.0%';
};

const pnlTone = (value: number): string =>
  value > 0 ? 'text-emerald-700' : value < 0 ? 'text-red-600' : 'text-slate-700';

const recordLabel = (row: LedgerBreakdownRow): string =>
  `${row.won}W · ${row.lost}L · ${row.voided}V`;

const SHORTLIST_RULE =
  `ROI ≥ ${SHADOW_ROI_SHORTLIST.minRoiPct}% · ` +
  `Hit ≥ ${SHADOW_ROI_SHORTLIST.minHitPct}% · ` +
  `CLV ≥ ${SHADOW_ROI_SHORTLIST.minAvgClvPct}%`;

const VARIANT_ACCESSORS: SortAccessors<LedgerBreakdownRow> = {
  label: (row) => row.label,
  tickets: (row) => row.tickets,
  record: (row) => recordLabel(row),
  hitRate: (row) => row.hitRate,
  breakEven: (row) => row.breakEvenHitRate,
  roi: (row) => row.roi,
  avgClv: (row) => row.avgClv,
  avgOdds: (row) => row.avgOdds,
};

/**
 * Server-side record of the engine's own tickets.
 *
 * This is deliberately separate from the user's saved slips: it includes every
 * strategy and leg budget, whether the user saved it or not, so the numbers
 * cannot be cherry-picked after the fact.
 */
export function ShadowLedgerPanel() {
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shortlistOnly, setShortlistOnly] = useState(true);
  const [variantSort, setVariantSort] = useState<SortState>({
    key: 'roi',
    direction: SORT_DESC,
  });
  const handleVariantSort = makeSortHandler(setVariantSort, SORT_DESC);
  const shortlistedVariants = useMemo(
    () => (summary ? selectShadowRoiShortlist(summary.byVariant) : []),
    [summary]
  );
  const sortedVariants = sortRows(
    shortlistOnly
      ? shortlistedVariants
      : (summary?.byVariant ?? []),
    variantSort,
    VARIANT_ACCESSORS
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setSummary(await apiFetch<LedgerSummary>('/api/ledger/summary'));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not load the shadow ledger.'
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section
      aria-label="Shadow ticket ledger"
      className="rounded-xl border border-slate-200 bg-white overflow-hidden"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-slate-500">
            <BarChart3 className="h-4 w-4" aria-hidden="true" />
            Shadow Ticket Ledger
          </h2>
          <p className="mt-0.5 max-w-2xl text-xs text-slate-500">
            Every ticket the engine would have built, recorded automatically at
            one-unit stakes. Only prices captured before kickoff enter ROI; the
            ledger is never edited by hand. Tickets the EV gate would not
            recommend are still recorded, so the gate itself can be graded. The
            positive-ROI shortlist below is applied automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          <span>{isLoading ? 'Loading…' : 'Refresh'}</span>
        </button>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="font-semibold underline whitespace-nowrap cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {!summary ? (
        <div className="px-4 py-8 text-center text-xs text-slate-400">
          {isLoading ? 'Reading the ledger…' : 'No ledger data yet.'}
        </div>
      ) : summary.tickets === 0 ? (
        <div className="px-4 py-8 text-center space-y-1">
          <p className="text-sm font-semibold text-slate-800">
            No shadow tickets recorded yet
          </p>
          <p className="mx-auto max-w-md text-xs leading-relaxed text-slate-500">
            Open a matchday with scheduled fixtures. The server will start
            recording every strategy and leg budget automatically.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-100 bg-emerald-50/40 px-4 py-2.5">
            <label
              className="flex flex-wrap items-center gap-2 text-xs text-slate-700 cursor-pointer"
              title="Monitoring aid only — small samples mean this is not a betting signal."
            >
              <input
                type="checkbox"
                checked={shortlistOnly}
                onChange={(event) => setShortlistOnly(event.target.checked)}
                className="accent-emerald-700"
              />
              <Filter className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
              <span className="font-semibold">Positive-ROI shortlist</span>
              <span className="font-mono text-[11px] text-slate-500">
                {SHORTLIST_RULE}
              </span>
            </label>
            <span className="text-[11px] text-slate-500 font-mono tabular-nums">
              {shortlistOnly
                ? `${shortlistedVariants.length} of ${summary.byVariant.length} variants`
                : `Showing all ${summary.byVariant.length} variants`}
            </span>
          </div>

          <div className="grid grid-cols-2 divide-x divide-y divide-slate-200 sm:grid-cols-5 sm:divide-y-0">
            <div className="px-4 py-3">
              <p className="text-[11px] font-medium text-slate-500">Record</p>
              <p className="mt-1 font-mono text-lg font-bold tabular-nums">
                <span className="text-emerald-700">{summary.won}</span>
                <span className="text-slate-300"> / </span>
                <span className="text-red-600">{summary.lost}</span>
                <span className="text-slate-300"> / </span>
                <span className="text-amber-700">{summary.voided}</span>
              </p>
              <p className="text-[10px] text-slate-400">
                {summary.tickets} tickets · {summary.live + summary.pending} open
              </p>
            </div>
            <div className="px-4 py-3">
              <p className="text-[11px] font-medium text-slate-500">Hit rate</p>
              <p className="mt-1 font-mono text-lg font-bold tabular-nums text-slate-900">
                {percent(summary.hitRate)}
              </p>
              <p className="text-[10px] text-slate-400">
                {summary.decided} decided tickets
              </p>
            </div>
            <div className="px-4 py-3">
              <p className="text-[11px] font-medium text-slate-500">
                Break-even
              </p>
              <p className="mt-1 font-mono text-lg font-bold tabular-nums text-slate-900">
                {percent(summary.breakEvenHitRate)}
              </p>
              <p className="text-[10px] text-slate-400">
                Needed at {summary.avgOdds.toFixed(2)} avg odds
              </p>
            </div>
            <div className="px-4 py-3">
              <p className="text-[11px] font-medium text-slate-500">ROI</p>
              <p
                className={`mt-1 font-mono text-lg font-bold tabular-nums ${
                  summary.roi === null
                    ? 'text-slate-400'
                    : pnlTone(summary.roi)
                }`}
              >
                {signedPercent(summary.roi)}
              </p>
              <p className="text-[10px] text-slate-400">
                Flat stake · void excluded
              </p>
            </div>
            <div className="px-4 py-3">
              <p className="text-[11px] font-medium text-slate-500">Avg CLV</p>
              <p
                className={`mt-1 font-mono text-lg font-bold tabular-nums ${
                  summary.avgClv === null
                    ? 'text-slate-400'
                    : pnlTone(summary.avgClv)
                }`}
              >
                {signedPercent(summary.avgClv)}
              </p>
              <p className="text-[10px] text-slate-400">
                Placed price vs closing
              </p>
            </div>
          </div>

          <div className="overflow-x-auto border-t border-slate-200">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <SortableTh
                    label="Variant"
                    columnKey="label"
                    sort={variantSort}
                    onSort={handleVariantSort}
                    className="px-4 py-2 font-semibold"
                  />
                  <SortableTh
                    label="Tickets"
                    columnKey="tickets"
                    sort={variantSort}
                    onSort={handleVariantSort}
                    align="right"
                    className="px-3 py-2 font-semibold"
                  />
                  <SortableTh
                    label="W-L-V"
                    columnKey="record"
                    sort={variantSort}
                    onSort={handleVariantSort}
                    align="right"
                    className="px-3 py-2 font-semibold"
                  />
                  <SortableTh
                    label="Hit"
                    columnKey="hitRate"
                    sort={variantSort}
                    onSort={handleVariantSort}
                    align="right"
                    className="px-3 py-2 font-semibold"
                  />
                  <SortableTh
                    label="Break-even"
                    columnKey="breakEven"
                    sort={variantSort}
                    onSort={handleVariantSort}
                    align="right"
                    className="px-3 py-2 font-semibold"
                  />
                  <SortableTh
                    label="ROI"
                    columnKey="roi"
                    sort={variantSort}
                    onSort={handleVariantSort}
                    align="right"
                    className="px-3 py-2 font-semibold"
                  />
                  <SortableTh
                    label="Avg CLV"
                    columnKey="avgClv"
                    sort={variantSort}
                    onSort={handleVariantSort}
                    align="right"
                    className="px-3 py-2 font-semibold"
                  />
                  <SortableTh
                    label="Avg odds"
                    columnKey="avgOdds"
                    sort={variantSort}
                    onSort={handleVariantSort}
                    align="right"
                    className="px-4 py-2 font-semibold"
                  />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedVariants.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-xs text-slate-500">
                      No variant currently meets {SHORTLIST_RULE}.
                      {shortlistOnly && (
                        <button
                          type="button"
                          onClick={() => setShortlistOnly(false)}
                          className="ml-1 font-semibold text-emerald-700 underline cursor-pointer"
                        >
                          Show all variants
                        </button>
                      )}
                    </td>
                  </tr>
                )}
                {sortedVariants.map((row) => (
                  <tr key={row.key}>
                    <td className="px-4 py-2 font-medium text-slate-800">
                      {row.label}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600 tabular-nums">
                      {row.tickets}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600 tabular-nums">
                      {recordLabel(row)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-slate-800 tabular-nums">
                      {percent(row.hitRate)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-500 tabular-nums">
                      {percent(row.breakEvenHitRate)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono font-semibold tabular-nums ${pnlTone(
                        row.roi ?? 0
                      )}`}
                    >
                      {signedPercent(row.roi)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono tabular-nums ${
                        row.avgClv === null
                          ? 'text-slate-400'
                          : pnlTone(row.avgClv)
                      }`}
                    >
                      {signedPercent(row.avgClv)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-slate-600 tabular-nums">
                      {row.avgOdds > 0 ? row.avgOdds.toFixed(2) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t border-amber-100 bg-amber-50/60 px-4 py-2 text-[11px] leading-relaxed text-amber-800">
            Research/shadow only.{' '}
            {shortlistOnly
              ? 'The shortlist is a monitoring aid, not a betting signal — small samples make these rankings noisy. '
              : ''}
            Tickets are recorded at flat one-unit stakes and are never placed
            with a bookmaker.
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50/70 px-4 py-2.5 text-[11px] text-slate-500">
            <span>
              {summary.byPriceQuality
                .map((row) => `${row.label}: ${row.tickets}`)
                .join(' · ')}
            </span>
            <span className="font-mono tabular-nums">
              Updated {new Date(summary.updatedAt).toLocaleString('en-GB')}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
