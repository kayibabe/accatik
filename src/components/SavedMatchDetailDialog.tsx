import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, X } from 'lucide-react';
import type { AccaLeg, Fixture, MarketOption, SavedTicket } from '../types/fixtures.ts';
import {
  evaluateMarketSettlement,
  getFixtureMatchResultSummary,
} from '../utils/accaMath.ts';
import { pickMoreAdvancedFixture } from '../utils/fixtureSnapshots.ts';
import {
  SORT_DESC,
  makeSortHandler,
  sortRows,
  type SortState,
} from '../utils/tableSort.ts';
import { FormGuide } from './fixtures/FormGuide.tsx';
import { SettlementLabel } from './SettlementLabel.tsx';
import { MarketLabelText } from './ui/MarketLabel.tsx';
import { SortableTh } from './SortableTh.tsx';

interface SavedMatchDetailDialogProps {
  ticket: SavedTicket;
  /** Every selection made on this match in the saved slip. */
  legs: AccaLeg[];
  /** Full archived fixture for the matchday, when the archive covers it. */
  fixture: Fixture | null;
  /** Result-only fixture from the merged settlement pool. */
  settlementFixture: Fixture | null;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
}

function formatCatDateTime(iso: string | undefined): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Blantyre',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parsed);
}

function hasValue(value: string | undefined): value is string {
  return Boolean(value) && value !== '—' && value !== '-';
}

export function SavedMatchDetailDialog({
  ticket,
  legs,
  fixture,
  settlementFixture,
  isLoading,
  error,
  onClose,
}: SavedMatchDetailDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [marketSort, setMarketSort] = useState<SortState>({
    key: null,
    direction: SORT_DESC,
  });
  const handleMarketSort = makeSortHandler(setMarketSort, SORT_DESC);

  // Focus is handed back to whatever opened the dialog. This runs only on
  // mount so a changing onClose callback cannot overwrite the saved opener.
  useEffect(() => {
    openerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeButtonRef.current?.focus({ preventScroll: true });
    return () => {
      const opener = openerRef.current;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const outside = !dialogRef.current?.contains(active);
      if (event.shiftKey && (active === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const leg = legs[0];
  const detailSource = fixture ?? settlementFixture;
  const statusFixture = pickMoreAdvancedFixture(settlementFixture, fixture);
  const pickedMarket: MarketOption | null =
    detailSource?.markets.find((market) => market.id === leg.marketId) ?? null;
  const pickedMarketIds = new Set(legs.map((pick) => pick.marketId));

  const homeTeam = detailSource?.homeTeam ?? leg.homeTeam;
  const awayTeam = detailSource?.awayTeam ?? leg.awayTeam;
  const competition = detailSource?.competition ?? leg.competition;
  const country = detailSource?.country;
  const matchDay = leg.matchDate || detailSource?.matchDate || ticket.date;

  const legStatus = statusFixture
    ? evaluateMarketSettlement(statusFixture, {
        id: leg.marketId,
        label: leg.marketLabel,
        marketType: leg.marketType,
      })
    : 'Pending';

  const homeScore = statusFixture?.score?.home ?? null;
  const awayScore = statusFixture?.score?.away ?? null;
  const hasScore = homeScore !== null && awayScore !== null;
  const savedAt = formatCatDateTime(ticket.createdAt);
  const pricedAt = formatCatDateTime(detailSource?.pricedAt);

  const markets = detailSource?.markets ?? [];
  const sortedMarkets = sortRows(markets, marketSort, {
    label: (market) => market.label,
    odds: (market) => market.odds,
    fair: (market) => market.fairProbability ?? market.impliedProbability ?? null,
    book: (market) => market.bookmaker ?? null,
    result: (market) =>
      statusFixture
        ? evaluateMarketSettlement(statusFixture, market)
        : 'Pending',
  });
  const formHome = detailSource?.formHome;
  const formAway = detailSource?.formAway;
  const showForm = hasValue(formHome) || hasValue(formAway);
  const model = detailSource?.modelProbabilities;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6">
      <div
        className="absolute inset-0 bg-slate-900/60"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="saved-match-detail-title"
        className="relative w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Match detail · {matchDay} · {leg.kickoffTime}
            </p>
            <h2
              id="saved-match-detail-title"
              className="mt-1 text-lg font-bold text-slate-900 break-words"
            >
              {homeTeam} vs {awayTeam}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {competition}
              {country ? ` · ${country}` : ''}
              {detailSource?.venue ? ` · ${detailSource.venue}` : ''}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close match detail"
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Final outcome
              </p>
              <div className="mt-1 flex items-baseline gap-2">
                {hasScore ? (
                  <span className="text-2xl font-bold font-mono text-slate-900 tabular-nums">
                    {homeScore} - {awayScore}
                  </span>
                ) : (
                  <span className="text-sm font-semibold text-slate-700">
                    {statusFixture?.status ?? 'Awaiting result'}
                  </span>
                )}
                {statusFixture?.statusShort && (
                  <span className="text-xs font-mono text-slate-500">
                    {statusFixture.statusShort}
                  </span>
                )}
              </div>
              {statusFixture && (
                <p className="mt-0.5 text-xs font-mono text-slate-500 tabular-nums">
                  {getFixtureMatchResultSummary(statusFixture)}
                </p>
              )}
            </div>
            {legs.length === 1 && (
              <SettlementLabel status={legStatus} prefix="Your pick" />
            )}
          </div>

          <section className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                {legs.length > 1
                  ? `Your ${legs.length} picks on the day`
                  : 'Your pick on the day'}
              </p>
              {legs.length === 1 && (
                <p className="text-xs font-mono text-emerald-900 tabular-nums">
                  @ {(pickedMarket?.odds ?? leg.odds).toFixed(2)}
                </p>
              )}
            </div>
            <div className="space-y-3">
              {legs.map((pick, index) => {
                const pickMarket: MarketOption | null =
                  detailSource?.markets.find(
                    (market) => market.id === pick.marketId
                  ) ?? null;
                const pickOdds = pickMarket?.odds ?? pick.odds;
                const pickFair =
                  pickMarket?.fairProbability ?? pick.fairProbability;
                const pickBookmaker = pickMarket?.bookmaker ?? pick.bookmaker;
                const pickRationale = pickMarket?.rationale || pick.rationale;
                const pickStatus = statusFixture
                  ? evaluateMarketSettlement(statusFixture, {
                      id: pick.marketId,
                      label: pick.marketLabel,
                      marketType: pick.marketType,
                    })
                  : 'Pending';

                return (
                  <div
                    key={pick.marketId}
                    className={index > 0 ? 'border-t border-emerald-200 pt-3' : ''}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm">
                        <MarketLabelText
                          label={pick.marketLabel}
                          marketType={pick.marketType}
                        />
                      </p>
                      <span className="flex items-center gap-2">
                        <SettlementLabel status={pickStatus} />
                        <span className="font-mono text-xs font-semibold text-emerald-900 tabular-nums">
                          @ {pickOdds.toFixed(2)}
                        </span>
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-mono text-slate-600 tabular-nums">
                      {typeof pickFair === 'number' && (
                        <span>Fair probability {pickFair.toFixed(1)}%</span>
                      )}
                      {typeof pick.impliedProbability === 'number' && (
                        <span>Implied {pick.impliedProbability.toFixed(1)}%</span>
                      )}
                      <span>Market {pick.marketType}</span>
                      {pickBookmaker && <span>Book {pickBookmaker}</span>}
                    </div>
                    {pickRationale && (
                      <p className="text-sm leading-relaxed text-slate-600">
                        {pickRationale}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-slate-500">
              Picked from the {matchDay} matchday
              {savedAt ? ` · slip saved ${savedAt} CAT` : ''}
            </p>
          </section>

          {isLoading && (
            <p className="text-sm text-slate-500">
              Loading the archived matchday…
            </p>
          )}

          {error && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {error}
            </div>
          )}

          {markets.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-900">
                Prices as quoted that day
              </h3>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-sm border-collapse">
                  <caption className="sr-only">
                    Market prices and results for {homeTeam} versus {awayTeam}
                  </caption>
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                      <SortableTh
                        label="Market"
                        columnKey="label"
                        sort={marketSort}
                        onSort={handleMarketSort}
                        className="px-3 py-2 font-medium"
                      />
                      <SortableTh
                        label="Odds"
                        columnKey="odds"
                        sort={marketSort}
                        onSort={handleMarketSort}
                        className="px-3 py-2 font-medium"
                      />
                      <SortableTh
                        label="Fair"
                        columnKey="fair"
                        sort={marketSort}
                        onSort={handleMarketSort}
                        className="px-3 py-2 font-medium"
                      />
                      <SortableTh
                        label="Book"
                        columnKey="book"
                        sort={marketSort}
                        onSort={handleMarketSort}
                        className="px-3 py-2 font-medium"
                      />
                      <SortableTh
                        label="Result"
                        columnKey="result"
                        sort={marketSort}
                        onSort={handleMarketSort}
                        className="px-3 py-2 font-medium"
                      />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/80">
                    {sortedMarkets.map((market) => {
                      const isPicked = pickedMarketIds.has(market.id);
                      return (
                        <tr
                          key={market.id}
                          className={isPicked ? 'bg-emerald-50/70' : undefined}
                        >
                          <td className="px-3 py-2">
                            <MarketLabelText
                              label={market.label}
                              marketType={market.marketType}
                            />
                            {isPicked && (
                              <span className="ml-2 rounded border border-emerald-300 bg-white px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-emerald-800">
                                Your pick
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-left font-mono font-semibold text-slate-900 tabular-nums">
                            {market.odds.toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-left font-mono text-slate-600 tabular-nums">
                            {typeof market.fairProbability === 'number'
                              ? `${market.fairProbability.toFixed(1)}%`
                              : '—'}
                          </td>
                          <td className="px-3 py-2 text-slate-600">
                            {market.bookmaker || '—'}
                          </td>
                          <td className="px-3 py-2">
                            {statusFixture ? (
                              <SettlementLabel
                                status={evaluateMarketSettlement(
                                  statusFixture,
                                  market
                                )}
                              />
                            ) : (
                              <SettlementLabel status="Pending" />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            !isLoading && (
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                The archived price list for this match isn&apos;t available yet.
                The saved pick and its result above are still authoritative.
              </p>
            )
          )}

          {(detailSource?.tacticalSummary || showForm || model) && (
            <section className="space-y-2 border-t border-slate-200 pt-4">
              <h3 className="text-sm font-semibold text-slate-900">
                What the board said that day
              </h3>
              {showForm && (
                <p className="flex flex-wrap items-center gap-1 font-mono text-xs text-slate-600">
                  Form:
                  <FormGuide value={hasValue(formHome) ? formHome : null} /> home ·{' '}
                  <FormGuide value={hasValue(formAway) ? formAway : null} /> away
                </p>
              )}
              {detailSource?.tacticalSummary && (
                <p className="text-sm leading-relaxed text-slate-600">
                  {detailSource.tacticalSummary}
                </p>
              )}
              {model && (
                <p className="text-xs text-slate-600">
                  <span className="font-semibold text-slate-900">
                    API-Football model:{' '}
                  </span>
                  {model.home ?? '—'}% home · {model.draw ?? '—'}% draw ·{' '}
                  {model.away ?? '—'}% away
                  {detailSource?.modelAdvice
                    ? ` · favours ${detailSource.modelAdvice}`
                    : ''}
                </p>
              )}
              {pricedAt && (
                <p className="text-xs text-slate-600">
                  Prices captured {pricedAt} CAT. Kicked-off prices stay frozen
                  unless this date is explicitly recaptured. The odds the slip
                  was built from remain recorded on the ticket.
                </p>
              )}
            </section>
          )}

          {!detailSource && !isLoading && (
            <p className="flex items-start gap-1.5 text-xs text-slate-600">
              <MapPin className="mt-0.5 w-3 h-3 shrink-0" aria-hidden="true" />
              <span>
                No fixture archive is stored for this matchday. Showing the
                selection and result recorded on the slip.
              </span>
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
