import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, X } from 'lucide-react';
import type { AccaLeg, Fixture, MarketOption, SavedTicket } from '../types/fixtures.ts';
import {
  evaluateMarketSettlement,
  getFixtureMatchResultSummary,
} from '../utils/accaMath.ts';
import { pickMoreAdvancedFixture } from '../utils/fixtureSnapshots.ts';
import { SettlementLabel } from './SettlementLabel.tsx';

interface SavedMatchDetailDialogProps {
  ticket: SavedTicket;
  leg: AccaLeg;
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
  leg,
  fixture,
  settlementFixture,
  isLoading,
  error,
  onClose,
}: SavedMatchDetailDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Keeping the button focus without letting the browser scroll the panel
    // means the dialog always opens on its outcome header.
    closeButtonRef.current?.focus({ preventScroll: true });

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const detailSource = fixture ?? settlementFixture;
  const statusFixture = pickMoreAdvancedFixture(settlementFixture, fixture);
  const pickedMarket: MarketOption | null =
    detailSource?.markets.find((market) => market.id === leg.marketId) ?? null;

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

  const odds = pickedMarket?.odds ?? leg.odds;
  const fairProbability = pickedMarket?.fairProbability ?? leg.fairProbability;
  const bookmaker = pickedMarket?.bookmaker ?? leg.bookmaker;
  const rationale = pickedMarket?.rationale || leg.rationale;

  const homeScore = statusFixture?.score?.home ?? null;
  const awayScore = statusFixture?.score?.away ?? null;
  const hasScore = homeScore !== null && awayScore !== null;
  const savedAt = formatCatDateTime(ticket.createdAt);
  const pricedAt = formatCatDateTime(detailSource?.pricedAt);

  const markets = detailSource?.markets ?? [];
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="saved-match-detail-title"
        className="relative w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Match detail · {matchDay} · {leg.kickoffTime}
            </p>
            <h2
              id="saved-match-detail-title"
              className="mt-1 text-lg font-bold text-slate-900 break-words"
            >
              {homeTeam} vs {awayTeam}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
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
            className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
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
                  <span className="text-[11px] font-mono text-slate-500">
                    {statusFixture.statusShort}
                  </span>
                )}
              </div>
              {statusFixture && (
                <p className="mt-0.5 text-[11px] font-mono text-slate-500 tabular-nums">
                  {getFixtureMatchResultSummary(statusFixture)}
                </p>
              )}
            </div>
            <SettlementLabel status={legStatus} prefix="Your pick" />
          </div>

          <section className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                Your pick on the day
              </p>
              <p className="text-[11px] font-mono text-emerald-900 tabular-nums">
                @ {odds.toFixed(2)}
              </p>
            </div>
            <p className="text-sm font-bold text-slate-900">{leg.marketLabel}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono text-slate-600 tabular-nums">
              {typeof fairProbability === 'number' && (
                <span>Fair probability {fairProbability.toFixed(1)}%</span>
              )}
              {typeof leg.impliedProbability === 'number' && (
                <span>Implied {leg.impliedProbability.toFixed(1)}%</span>
              )}
              <span>Market {leg.marketType}</span>
              {bookmaker && <span>Book {bookmaker}</span>}
            </div>
            {rationale && (
              <p className="text-xs leading-relaxed text-slate-600">{rationale}</p>
            )}
            <p className="text-[11px] text-slate-500">
              Picked from the {matchDay} matchday
              {savedAt ? ` · slip saved ${savedAt} CAT` : ''}
            </p>
          </section>

          {isLoading && (
            <p className="text-xs text-slate-500">
              Loading the archived matchday…
            </p>
          )}

          {error && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {error}
            </div>
          )}

          {markets.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-900">
                Prices as quoted that day
              </h3>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                      <th scope="col" className="px-3 py-2 font-medium">Market</th>
                      <th scope="col" className="px-3 py-2 font-medium text-right">Odds</th>
                      <th scope="col" className="px-3 py-2 font-medium text-right">Fair</th>
                      <th scope="col" className="px-3 py-2 font-medium">Book</th>
                      <th scope="col" className="px-3 py-2 font-medium">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/80">
                    {markets.map((market) => {
                      const isPicked = market.id === leg.marketId;
                      return (
                        <tr
                          key={market.id}
                          className={isPicked ? 'bg-emerald-50/70' : undefined}
                        >
                          <td className="px-3 py-2">
                            <span className="font-medium text-slate-900">
                              {market.label}
                            </span>
                            {isPicked && (
                              <span className="ml-2 rounded border border-emerald-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                                Your pick
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900 tabular-nums">
                            {market.odds.toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-slate-600 tabular-nums">
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
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                The archived price list for this match isn&apos;t available yet.
                The saved pick and its result above are still authoritative.
              </p>
            )
          )}

          {(detailSource?.tacticalSummary || showForm || model) && (
            <section className="space-y-2 border-t border-slate-200 pt-4">
              <h3 className="text-xs font-semibold text-slate-900">
                What the board said that day
              </h3>
              {showForm && (
                <p className="font-mono text-[11px] text-slate-600">
                  Form: {hasValue(formHome) ? formHome : '—'} home ·{' '}
                  {hasValue(formAway) ? formAway : '—'} away
                </p>
              )}
              {detailSource?.tacticalSummary && (
                <p className="text-xs leading-relaxed text-slate-600">
                  {detailSource.tacticalSummary}
                </p>
              )}
              {model && (
                <p className="text-[11px] text-slate-600">
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
                <p className="text-[10px] text-slate-400">
                  Prices captured {pricedAt} CAT. Kicked-off prices are frozen
                  permanently, so this is the exact board the slip was built
                  from.
                </p>
              )}
            </section>
          )}

          {!detailSource && !isLoading && (
            <p className="flex items-start gap-1.5 text-[11px] text-slate-400">
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
