import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Calendar, Filter, RefreshCw } from 'lucide-react';
import type { LedgerBreakdownRow, LedgerSummary } from '../types/ledger.ts';
import { apiFetch } from '../utils/api.ts';
import {
  fmtCount,
  fmtOdds,
  fmtPercent,
  fmtSignedPercent,
} from '../utils/format.ts';
import {
  SORT_DESC,
  makeSortHandler,
  sortRows,
  type SortAccessors,
  type SortState,
} from '../utils/tableSort.ts';
import { pnlTone } from '../utils/uiTone.ts';
import {
  selectShadowRoiShortlist,
  SHADOW_ROI_SHORTLIST,
} from '../utils/shadowRoiFilter.ts';
import { DataTable, type DataTableColumn } from './ui/DataTable.tsx';
import { DataStatus } from './ui/DataStatus.tsx';
import { InfoHint } from './ui/DataCard.tsx';
import { EmptyState } from './ui/States.tsx';
import { recordLabel } from './performance/format.ts';
import { SortHeaderButton, SortStatus } from './performance/SortHeaderButton.tsx';

const SHORTLIST_RULE =
  `ROI ≥ ${SHADOW_ROI_SHORTLIST.minRoiPct}% · ` +
  `Hit ≥ ${SHADOW_ROI_SHORTLIST.minHitPct}% · ` +
  `CLV ≥ ${SHADOW_ROI_SHORTLIST.minAvgClvPct}%`;

function SummaryItem({
  label,
  value,
  detail,
  tone = 'text-slate-900',
  infoKey,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: string;
  infoKey?: string;
}) {
  return (
    <div className="flex items-baseline gap-1.5" title={detail}>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
        {infoKey && <InfoHint infoKey={infoKey} />}
      </dt>
      <dd className={`font-mono text-xs font-bold tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}

const VARIANT_ACCESSORS: SortAccessors<LedgerBreakdownRow> = {
  label: (row) => row.label,
  tickets: (row) => row.tickets,
  record: (row) => recordLabel(row.won, row.lost, row.voided),
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
  const [selectedDateIso, setSelectedDateIso] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shortlistOnly, setShortlistOnly] = useState(true);
  const requestIdRef = useRef(0);
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

  const columns: DataTableColumn<LedgerBreakdownRow>[] = [
    {
      key: 'label',
      header: (
        <SortHeaderButton
          label="Variant"
          columnKey="label"
          sort={variantSort}
          onSort={handleVariantSort}
        />
      ),
      cell: (row) => <span className="font-medium text-slate-800">{row.label}</span>,
      priority: 'primary',
    },
    {
      key: 'tickets',
      header: (
        <SortHeaderButton
          label="Tickets"
          columnKey="tickets"
          sort={variantSort}
          onSort={handleVariantSort}
          align="right"
        />
      ),
      cell: (row) => fmtCount(row.tickets),
      align: 'right',
      priority: 'secondary',
    },
    {
      key: 'record',
      header: (
        <SortHeaderButton
          label="W-L-V"
          columnKey="record"
          sort={variantSort}
          onSort={handleVariantSort}
          align="right"
        />
      ),
      cell: (row) => recordLabel(row.won, row.lost, row.voided),
      align: 'right',
      priority: 'tertiary',
    },
    {
      key: 'hitRate',
      header: (
        <SortHeaderButton
          label="Hit"
          columnKey="hitRate"
          sort={variantSort}
          onSort={handleVariantSort}
          align="right"
        />
      ),
      cell: (row) => (
        <span className="font-semibold text-slate-800">{fmtPercent(row.hitRate)}</span>
      ),
      align: 'right',
      priority: 'primary',
    },
    {
      key: 'breakEven',
      header: (
        <SortHeaderButton
          label="Break-even"
          columnKey="breakEven"
          sort={variantSort}
          onSort={handleVariantSort}
          align="right"
        />
      ),
      cell: (row) => fmtPercent(row.breakEvenHitRate),
      align: 'right',
      priority: 'tertiary',
    },
    {
      key: 'roi',
      header: (
        <SortHeaderButton
          label="ROI"
          columnKey="roi"
          sort={variantSort}
          onSort={handleVariantSort}
          align="right"
        />
      ),
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
      key: 'avgClv',
      header: (
        <SortHeaderButton
          label="Avg CLV"
          columnKey="avgClv"
          sort={variantSort}
          onSort={handleVariantSort}
          align="right"
        />
      ),
      cell: (row) => (
        <span className={row.avgClv === null ? 'text-slate-400' : pnlTone(row.avgClv)}>
          {fmtSignedPercent(row.avgClv)}
        </span>
      ),
      align: 'right',
      priority: 'secondary',
    },
    {
      key: 'avgOdds',
      header: (
        <SortHeaderButton
          label="Avg odds"
          columnKey="avgOdds"
          sort={variantSort}
          onSort={handleVariantSort}
          align="right"
        />
      ),
      cell: (row) => fmtOdds(row.avgOdds > 0 ? row.avgOdds : null),
      align: 'right',
      priority: 'tertiary',
    },
  ];

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const query = selectedDateIso
        ? `?dateIso=${encodeURIComponent(selectedDateIso)}`
        : '';
      const next = await apiFetch<LedgerSummary>(`/api/ledger/summary${query}`);
      if (requestId !== requestIdRef.current) return;
      setSummary(next);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(
        err instanceof Error ? err.message : 'Could not load the shadow ledger.'
      );
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [selectedDateIso]);

  useEffect(() => {
    // A new day invalidates the old scorecard; keep the loading state honest.
    setSummary(null);
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

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/60 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative inline-flex items-center">
            <Calendar
              className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="date"
              value={selectedDateIso}
              onChange={(event) => setSelectedDateIso(event.target.value)}
              aria-label="Filter ledger by matchday"
              className="h-8 pl-8 pr-2.5 text-xs font-mono font-medium text-slate-800 bg-white border border-slate-200 rounded-lg tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700 cursor-pointer"
            />
          </label>
          <button
            type="button"
            onClick={() => setSelectedDateIso('')}
            disabled={!selectedDateIso}
            className="h-8 px-2.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg transition-colors hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
          >
            All days
          </button>
          <span className="text-[11px] text-slate-500 font-mono tabular-nums">
            {selectedDateIso
              ? `Scoped to ${selectedDateIso}`
              : `Inception to date${summary ? ` · ${fmtCount(summary.availableDates.length)} days recorded` : ''}`}
          </span>
        </div>
        {summary && summary.availableDates.length > 0 && (
          <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
            Recorded days
            <select
              value={selectedDateIso}
              onChange={(event) => setSelectedDateIso(event.target.value)}
              aria-label="Days with ledger tickets"
              className="h-8 max-w-[11rem] px-2 text-xs font-mono text-slate-800 bg-white border border-slate-200 rounded-lg tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700 cursor-pointer"
            >
              <option value="">All days</option>
              {selectedDateIso &&
                !summary.availableDates.includes(selectedDateIso) && (
                  <option value={selectedDateIso}>
                    {selectedDateIso} (no tickets)
                  </option>
                )}
              {summary.availableDates.map((dateIso) => (
                <option key={dateIso} value={dateIso}>
                  {dateIso}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {!summary ? (
        <div className="px-4 py-8 text-center text-xs text-slate-400">
          {isLoading ? 'Reading the ledger…' : 'No ledger data yet.'}
        </div>
      ) : selectedDateIso && summary.tickets === 0 ? (
        <EmptyState
          className="!border-0"
          title={`No shadow tickets for ${selectedDateIso}`}
          description="Pick another matchday or return to the inception-to-date scorecard."
          action={
            <button
              type="button"
              onClick={() => setSelectedDateIso('')}
              className="font-semibold text-emerald-700 underline cursor-pointer"
            >
              Show all days
            </button>
          }
        />
      ) : summary.tickets === 0 ? (
        <EmptyState
          className="!border-0"
          title="No shadow tickets recorded yet"
          description="Open a matchday with scheduled fixtures. The server will start recording every strategy and leg budget automatically."
        />
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
                ? `${fmtCount(shortlistedVariants.length)} of ${fmtCount(summary.byVariant.length)} variants`
                : `Showing all ${fmtCount(summary.byVariant.length)} variants`}
            </span>
          </div>

          <div className="px-4 py-3">
            <DataStatus
              source="Settled archive"
              note={
                <span className="text-slate-500">
                  Flat one-unit shadow stakes · never placed with a bookmaker
                </span>
              }
            />
          </div>

          <div className="px-3 pb-3">
            <dl className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-emerald-100 bg-emerald-50/40 px-3 py-2.5">
              <SummaryItem
                label="Record"
                value={recordLabel(summary.won, summary.lost, summary.voided)}
                detail={`${fmtCount(summary.tickets)} tickets · ${fmtCount(summary.live + summary.pending)} open`}
              />
              <SummaryItem
                label="Hit rate"
                value={fmtPercent(summary.hitRate)}
                detail={`${fmtCount(summary.decided)} decided tickets`}
              />
              <SummaryItem
                label="Break-even"
                value={fmtPercent(summary.breakEvenHitRate)}
                detail={`Needed at ${fmtOdds(summary.avgOdds)} avg odds`}
              />
              <SummaryItem
                label="ROI"
                value={fmtSignedPercent(summary.roi)}
                detail="Flat stake · void excluded"
                tone={summary.roi === null ? 'text-slate-400' : pnlTone(summary.roi)}
                infoKey="roi"
              />
              <SummaryItem
                label="Avg CLV"
                value={fmtSignedPercent(summary.avgClv)}
                detail="Placed price vs closing"
                tone={summary.avgClv === null ? 'text-slate-400' : pnlTone(summary.avgClv)}
                infoKey="clv"
              />
            </dl>
          </div>

          <div className="space-y-2 border-t border-slate-200 px-3 py-3">
            <SortStatus sort={variantSort} label="variant table" />
            <DataTable
              columns={columns}
              rows={sortedVariants}
              rowKey={(row) => row.key}
              caption="Shadow ledger performance by variant"
              minWidth="min-w-[720px]"
              compact
              details={(row) => (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  <div>
                    <dt className="text-slate-400">Tickets</dt>
                    <dd className="font-mono text-slate-700">{fmtCount(row.tickets)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Record (W-L-V)</dt>
                    <dd className="font-mono text-slate-700">
                      {recordLabel(row.won, row.lost, row.voided)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Hit rate</dt>
                    <dd className="font-mono text-slate-700">{fmtPercent(row.hitRate)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Break-even</dt>
                    <dd className="font-mono text-slate-700">
                      {fmtPercent(row.breakEvenHitRate)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Avg odds</dt>
                    <dd className="font-mono text-slate-700">
                      {fmtOdds(row.avgOdds > 0 ? row.avgOdds : null)}
                    </dd>
                  </div>
                </dl>
              )}
              empty={
                <div className="px-4 py-8 text-center text-xs text-slate-500">
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
                </div>
              }
            />
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
              {summary.dateIso ? `${summary.dateIso} · ` : 'All days · '}
              Updated {new Date(summary.updatedAt).toLocaleString('en-GB')}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
