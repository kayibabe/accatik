import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, RefreshCw } from 'lucide-react';
import type {
  AccaLeg,
  Fixture,
  SavedTicket,
  SettlementStatus,
} from '../types/fixtures.ts';
import {
  evaluateMarketSettlement,
  formatTicketForCopy,
} from '../utils/accaMath.ts';
import {
  resolveSettlementPool,
  type FixtureSnapshots,
} from '../utils/fixtureSnapshots.ts';
import {
  formatTicketDayLabel,
  formatTicketMonthLabel,
  groupTicketsByDate,
  ticketDateIso,
} from '../utils/savedTicketGroups.ts';
import { buildSlipActivityData } from '../utils/slipActivity.ts';
import { SavedMatchDetailDialog } from './SavedMatchDetailDialog.tsx';
import { SavedTicketCard } from './SavedTicketCard.tsx';
import { ShadowLedgerPanel } from './ShadowLedgerPanel.tsx';
import { SlipPerformancePanel } from './SlipPerformancePanel.tsx';

interface SavedSlipsViewProps {
  savedTickets: SavedTicket[];
  fixtures: Fixture[];
  fixtureSnapshots: FixtureSnapshots;
  /** CAT calendar date, used to expand only the current matchday. */
  todayDate: string;
  onLoadTicket: (ticket: SavedTicket) => void;
  onDeleteTicket: (ticketId: string) => void;
  onGoToSlate: () => void;
  onRefreshResults: (
    fixtureIds: string[],
    forceRefresh?: boolean
  ) => Promise<Fixture[]>;
  /** Reads the archived matchday board for one or more fixtures. */
  onLoadMatchDetails: (
    dateIso: string,
    fixtureIds: string[]
  ) => Promise<Fixture[]>;
}

const RESULT_REQUEST_BATCH = 20;
const RESULT_REFRESH_CONCURRENCY = 3;

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const item = items[next++];
        await worker(item);
      }
    }
  );
  await Promise.all(runners);
}

function isOpen(status: SettlementStatus): boolean {
  return status === 'Pending' || status === 'Live';
}

export function SavedSlipsView({
  savedTickets,
  fixtures,
  fixtureSnapshots,
  todayDate,
  onLoadTicket,
  onDeleteTicket,
  onGoToSlate,
  onRefreshResults,
  onLoadMatchDetails,
}: SavedSlipsViewProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const requestedResultsRef = useRef<Set<string>>(new Set());
  const refreshInFlightRef = useRef(0);

  const [selectedMatch, setSelectedMatch] = useState<{
    ticket: SavedTicket;
    leg: AccaLeg;
  } | null>(null);
  const [matchDetails, setMatchDetails] = useState<Record<string, Fixture>>({});
  const [isLoadingMatchDetail, setIsLoadingMatchDetail] = useState(false);
  const [matchDetailError, setMatchDetailError] = useState<string | null>(null);
  const matchDetailRequestRef = useRef(0);

  // Personal activity projection, shared with the My Activity view so both
  // screens report identical settlement and performance numbers.
  const activity = useMemo(
    () => buildSlipActivityData(savedTickets, fixtures, fixtureSnapshots),
    [savedTickets, fixtures, fixtureSnapshots]
  );
  const {
    settlements,
    analytics,
    daily: dailyPerformance,
    oddsBands: oddsBandPerformance,
    marketTypes: marketTypePerformance,
  } = activity;

  const groups = useMemo(() => groupTicketsByDate(savedTickets), [savedTickets]);

  /**
   * Legs that still need a scoreline. Only fixtures whose kickoff has passed
   * are requested, so a slip saved for next weekend is left alone.
   */
  const pendingFixtureIds = useMemo(() => {
    const nowMs = Date.now();
    const ids = new Set<string>();

    for (const ticket of savedTickets) {
      const pool = settlements.get(ticket.id)?.pool;
      if (!pool) continue;
      const byId = new Map(pool.map((fixture) => [fixture.id, fixture]));

      for (const leg of ticket.legs) {
        const fixture = byId.get(leg.fixtureId);
        if (!fixture) {
          ids.add(leg.fixtureId);
          continue;
        }

        const status = evaluateMarketSettlement(fixture, {
          id: leg.marketId,
          label: leg.marketLabel,
          marketType: leg.marketType,
        });
        if (!isOpen(status)) continue;

        const kickoffInFuture =
          fixture.status === 'Scheduled' &&
          typeof fixture.kickoffTimestamp === 'number' &&
          fixture.kickoffTimestamp > nowMs;
        if (kickoffInFuture) continue;

        ids.add(leg.fixtureId);
      }
    }

    return [...ids].sort();
  }, [savedTickets, settlements]);

  const requestResults = useCallback(
    async (fixtureIds: string[], forceRefresh = false) => {
      if (fixtureIds.length === 0) return;
      refreshInFlightRef.current += 1;
      setIsRefreshing(true);
      setRefreshError(null);
      try {
        await onRefreshResults(fixtureIds, forceRefresh);
      } catch (error) {
        setRefreshError(
          error instanceof Error
            ? error.message
            : 'Could not refresh match results.'
        );
      } finally {
        refreshInFlightRef.current -= 1;
        if (refreshInFlightRef.current === 0) setIsRefreshing(false);
      }
    },
    [onRefreshResults]
  );

  // Settle finished legs without the user hunting for their old matchday.
  // Requested IDs are remembered so a feed that stays silent can't loop.
  useEffect(() => {
    const batch = pendingFixtureIds
      .filter((id) => !requestedResultsRef.current.has(id))
      .slice(0, RESULT_REQUEST_BATCH);
    if (batch.length === 0) return;

    for (const id of batch) requestedResultsRef.current.add(id);
    void requestResults(batch);
  }, [pendingFixtureIds, requestResults]);

  const isDayExpanded = (dateIso: string): boolean =>
    expandedDays[dateIso] ?? dateIso === todayDate;

  const toggleDay = (dateIso: string) => {
    setExpandedDays((prev) => ({
      ...prev,
      [dateIso]: !isDayExpanded(dateIso),
    }));
  };

  const dayDates = groups.flatMap((year) =>
    year.months.flatMap((month) => month.days.map((day) => day.dateIso))
  );
  const allExpanded =
    dayDates.length > 0 && dayDates.every((dateIso) => isDayExpanded(dateIso));

  const toggleAllDays = () => {
    const next = !allExpanded;
    setExpandedDays(
      Object.fromEntries(dayDates.map((dateIso) => [dateIso, next]))
    );
  };

  const handleCopy = async (ticket: SavedTicket) => {
    try {
      const pool = resolveSettlementPool(ticket, fixtureSnapshots, fixtures);
      await navigator.clipboard.writeText(
        formatTicketForCopy(ticket.legs, ticket.stake, ticket.date, pool)
      );
      setCopiedId(ticket.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Ignore clipboard error
    }
  };

  const handleSelectLeg = async (ticket: SavedTicket, leg: AccaLeg) => {
    setSelectedMatch({ ticket, leg });
    setMatchDetailError(null);

    if (matchDetails[leg.fixtureId]) {
      setIsLoadingMatchDetail(false);
      return;
    }

    const pool = settlements.get(ticket.id)?.pool ?? [];
    const fixture = pool.find((entry) => entry.id === leg.fixtureId);
    const dateIso =
      fixture?.matchDateIso || ticket.dateIso || ticketDateIso(ticket);
    const requestId = ++matchDetailRequestRef.current;
    setIsLoadingMatchDetail(true);

    try {
      const fixtures = await onLoadMatchDetails(dateIso, [leg.fixtureId]);
      if (requestId !== matchDetailRequestRef.current) return;

      const detail = fixtures.find((entry) => entry.id === leg.fixtureId);
      if (detail) {
        setMatchDetails((prev) => ({ ...prev, [detail.id]: detail }));
      } else {
        setMatchDetailError(
          'No archived board is stored for this matchday — showing the saved pick and result only.'
        );
      }
    } catch (error) {
      if (requestId !== matchDetailRequestRef.current) return;
      setMatchDetailError(
        error instanceof Error
          ? error.message
          : 'Could not load the archived matchday.'
      );
    } finally {
      if (requestId === matchDetailRequestRef.current) {
        setIsLoadingMatchDetail(false);
      }
    }
  };

  const closeMatchDetail = useCallback(() => {
    matchDetailRequestRef.current += 1;
    setSelectedMatch(null);
    setMatchDetailError(null);
    setIsLoadingMatchDetail(false);
  }, []);

  const selectedSettlementFixture = selectedMatch
    ? (settlements
        .get(selectedMatch.ticket.id)
        ?.pool.find(
          (fixture) => fixture.id === selectedMatch.leg.fixtureId
        ) ?? null)
    : null;

  const handleManualRefresh = async () => {
    requestedResultsRef.current = new Set(pendingFixtureIds);
    const batches: string[][] = [];
    for (let i = 0; i < pendingFixtureIds.length; i += RESULT_REQUEST_BATCH) {
      batches.push(pendingFixtureIds.slice(i, i + RESULT_REQUEST_BATCH));
    }
    await runWithConcurrency(batches, RESULT_REFRESH_CONCURRENCY, (batch) =>
      requestResults(batch, true)
    );
  };

  return (
    <section aria-label="Saved Accumulator Slips" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500">
            Local Ticket Archive
          </p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Saved Accumulator Slips
          </h1>
        </div>
        <button
          type="button"
          onClick={onGoToSlate}
          className="self-start sm:self-auto px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors cursor-pointer"
        >
          Back to Today&apos;s Slate
        </button>
      </div>

      <ShadowLedgerPanel />

      {savedTickets.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-3">
          <p className="text-base font-semibold text-slate-900">
            No saved accumulator slips yet
          </p>
          <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
            Build or customize a pre-match accumulator on today&apos;s fixture
            board and click &ldquo;Save Slip&rdquo; to store variations for
            comparison.
          </p>
          <button
            type="button"
            onClick={onGoToSlate}
            className="mt-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors cursor-pointer"
          >
            Build First Slip
          </button>
        </div>
      ) : (
        <>
          <SlipPerformancePanel
            analytics={analytics}
            daily={dailyPerformance}
            oddsBands={oddsBandPerformance}
            marketTypes={marketTypePerformance}
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              {pendingFixtureIds.length > 0
                ? `${pendingFixtureIds.length} fixture${
                    pendingFixtureIds.length === 1 ? '' : 's'
                  } not yet final`
                : analytics.live > 0
                  ? `${analytics.live} slip${
                      analytics.live === 1 ? '' : 's'
                    } in play — all finished matches are settled`
                  : analytics.pending > 0
                    ? 'All finished matches are settled; open slips are waiting on kickoff.'
                    : 'Every match on these slips is settled.'}
            </p>
            <div className="flex items-center gap-2">
              {pendingFixtureIds.length > 0 && (
                <button
                  type="button"
                  onClick={handleManualRefresh}
                  disabled={isRefreshing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors disabled:opacity-60 cursor-pointer"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  <span>{isRefreshing ? 'Refreshing…' : 'Refresh Results'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={toggleAllDays}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                {allExpanded ? 'Collapse all days' : 'Expand all days'}
              </button>
            </div>
          </div>

          {refreshError && (
            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
              <span>Could not refresh results: {refreshError}</span>
              <button
                type="button"
                onClick={handleManualRefresh}
                className="font-semibold underline whitespace-nowrap cursor-pointer"
              >
                Retry
              </button>
            </div>
          )}

          <div className="space-y-8">
            {groups.map((yearGroup) => (
              <section
                key={yearGroup.year}
                aria-label={`${yearGroup.year} slips`}
                className="space-y-3"
              >
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
                  {yearGroup.year}
                </h2>

                <div className="space-y-4">
                  {yearGroup.months.map((monthGroup) => (
                    <div key={monthGroup.month} className="space-y-2">
                      <h3 className="pl-1 text-xs font-semibold text-slate-500">
                        {formatTicketMonthLabel(monthGroup.month)}
                      </h3>

                      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-200">
                        {monthGroup.days.map((day) => {
                          const expanded = isDayExpanded(day.dateIso);
                          const panelId = `saved-slips-${day.dateIso}`;
                          const daySettlements = day.tickets.map(
                            (ticket) =>
                              settlements.get(ticket.id)?.settlement.status ??
                              'Pending'
                          );
                          const dayWon = daySettlements.filter(
                            (status) => status === 'Win'
                          ).length;
                          const dayLost = daySettlements.filter(
                            (status) => status === 'Lost'
                          ).length;
                          const dayOpen = daySettlements.filter(isOpen).length;

                          return (
                            <div key={day.dateIso}>
                              <button
                                type="button"
                                onClick={() => toggleDay(day.dateIso)}
                                aria-expanded={expanded}
                                aria-controls={panelId}
                                className="flex w-full items-center justify-between gap-3 px-4 sm:px-5 py-3 text-left hover:bg-slate-50 transition-colors cursor-pointer"
                              >
                                <span className="flex min-w-0 items-center gap-2">
                                  <ChevronRight
                                    className={`w-4 h-4 shrink-0 text-slate-400 transition-transform ${
                                      expanded ? 'rotate-90' : ''
                                    }`}
                                    aria-hidden="true"
                                  />
                                  <span
                                    className={`truncate text-sm font-semibold ${
                                      day.dateIso === todayDate
                                        ? 'text-emerald-800'
                                        : 'text-slate-800'
                                    }`}
                                  >
                                    {formatTicketDayLabel(day.dateIso, todayDate)}
                                  </span>
                                </span>
                                <span className="flex shrink-0 items-center gap-3 text-[11px]">
                                  <span className="font-mono text-slate-500 tabular-nums">
                                    {day.tickets.length}{' '}
                                    {day.tickets.length === 1 ? 'slip' : 'slips'}
                                  </span>
                                  <span className="flex items-center gap-2 font-semibold">
                                    {dayWon > 0 && (
                                      <span className="text-emerald-700">
                                        {dayWon} won
                                      </span>
                                    )}
                                    {dayLost > 0 && (
                                      <span className="text-red-600">
                                        {dayLost} lost
                                      </span>
                                    )}
                                    {dayOpen > 0 && (
                                      <span className="text-slate-500">
                                        {dayOpen} pending
                                      </span>
                                    )}
                                  </span>
                                </span>
                              </button>

                              {expanded && (
                                <div
                                  id={panelId}
                                  className="divide-y divide-slate-200 border-t border-slate-200 bg-slate-50/50"
                                >
                                  {day.tickets.map((ticket) => {
                                    const entry = settlements.get(ticket.id);
                                    if (!entry) return null;
                                    return (
                                      <SavedTicketCard
                                        key={ticket.id}
                                        ticket={ticket}
                                        pool={entry.pool}
                                        settlement={entry.settlement}
                                        copied={copiedId === ticket.id}
                                        onCopy={handleCopy}
                                        onLoad={onLoadTicket}
                                        onDelete={onDeleteTicket}
                                        onSelectLeg={handleSelectLeg}
                                      />
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      {selectedMatch && (
        <SavedMatchDetailDialog
          ticket={selectedMatch.ticket}
          leg={selectedMatch.leg}
          fixture={matchDetails[selectedMatch.leg.fixtureId] ?? null}
          settlementFixture={selectedSettlementFixture}
          isLoading={isLoadingMatchDetail}
          error={matchDetailError}
          onClose={closeMatchDetail}
        />
      )}
    </section>
  );
}
