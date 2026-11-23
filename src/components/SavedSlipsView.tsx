import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
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
import { fmtCount } from '../utils/format.ts';
import { groupTicketsByDate, ticketDateIso } from '../utils/savedTicketGroups.ts';
import { buildSlipActivityData } from '../utils/slipActivity.ts';
import { SavedMatchDetailDialog } from './SavedMatchDetailDialog.tsx';
import { ShadowLedgerPanel } from './ShadowLedgerPanel.tsx';
import { CompactSlipKpis } from './tickets/CompactSlipKpis.tsx';
import { SlipDateGroups } from './tickets/SlipDateGroups.tsx';
import { DataStatus } from './ui/DataStatus.tsx';
import { PageHeader } from './ui/PageHeader.tsx';
import { EmptyState, ErrorState, InlineLoading } from './ui/States.tsx';

interface SavedSlipsViewProps {
  savedTickets: SavedTicket[];
  fixtures: Fixture[];
  fixtureSnapshots: FixtureSnapshots;
  /** CAT calendar date, used to expand only the current matchday. */
  todayDate: string;
  /** Whether loading a saved ticket would replace picks already in the builder. */
  hasCurrentTicket: boolean;
  onLoadTicket: (ticket: SavedTicket) => void;
  onDeleteTicket: (ticketId: string) => void;
  onGoToSlate: () => void;
  /**
   * Opens the authoritative analytics screen. Optional so existing callers
   * keep working; the slate is used as a safe fallback.
   */
  onGoToActivity?: () => void;
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
  hasCurrentTicket,
  onLoadTicket,
  onDeleteTicket,
  onGoToSlate,
  onGoToActivity,
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
    legs: AccaLeg[];
  } | null>(null);
  const [matchDetails, setMatchDetails] = useState<Record<string, Fixture>>({});
  const [isLoadingMatchDetail, setIsLoadingMatchDetail] = useState(false);
  const [matchDetailError, setMatchDetailError] = useState<string | null>(null);
  const matchDetailRequestRef = useRef(0);

  const goToActivity = onGoToActivity ?? onGoToSlate;

  // Personal activity projection, shared with the My Activity view so both
  // screens report identical settlement and performance numbers. The detailed
  // panels are rendered only on that authoritative screen.
  const activity = useMemo(
    () => buildSlipActivityData(savedTickets, fixtures, fixtureSnapshots),
    [savedTickets, fixtures, fixtureSnapshots]
  );
  const { settlements, analytics } = activity;

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

  const handleSelectMatch = async (ticket: SavedTicket, legs: AccaLeg[]) => {
    const fixtureId = legs[0].fixtureId;
    setSelectedMatch({ ticket, legs });
    setMatchDetailError(null);

    if (matchDetails[fixtureId]) {
      setIsLoadingMatchDetail(false);
      return;
    }

    const pool = settlements.get(ticket.id)?.pool ?? [];
    const fixture = pool.find((entry) => entry.id === fixtureId);
    const dateIso =
      fixture?.matchDateIso || ticket.dateIso || ticketDateIso(ticket);
    const requestId = ++matchDetailRequestRef.current;
    setIsLoadingMatchDetail(true);

    try {
      const fixtures = await onLoadMatchDetails(dateIso, [fixtureId]);
      if (requestId !== matchDetailRequestRef.current) return;

      const detail = fixtures.find((entry) => entry.id === fixtureId);
      if (detail) {
        setMatchDetails((prev) => ({ ...prev, [detail.id]: detail }));
      } else {
        setMatchDetailError(
          'No archived board is stored for this matchday — showing the saved picks and result only.'
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
          (fixture) => fixture.id === selectedMatch.legs[0].fixtureId
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
      <PageHeader
        eyebrow="Ticket Archive"
        title="Saved Accumulator Slips"
        description="Your personal archive of saved slips. Settlements come from captured price snapshots and the live slate; full performance analytics live in My Activity."
        scope="personal"
        onBack={onGoToSlate}
      />

      <DataStatus
        source="Saved slip archive"
        mode="Archived price snapshots"
        note={
          <span className="font-mono tabular-nums">
            Matchday {todayDate} ·{' '}
            {fmtCount(Object.keys(fixtureSnapshots).length)} snapshot days
          </span>
        }
      />

      <ShadowLedgerPanel />

      {savedTickets.length === 0 ? (
        <EmptyState
          title="No saved accumulator slips yet"
          description="Saving a pre-match accumulator stores its legs, odds, stake and captured price snapshot here. Settlements and personal performance are tracked automatically as results arrive."
          action={
            <button
              type="button"
              onClick={onGoToSlate}
              className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors cursor-pointer"
            >
              Build First Slip
            </button>
          }
        />
      ) : (
        <>
          <CompactSlipKpis
            analytics={analytics}
            onViewActivity={goToActivity}
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              {pendingFixtureIds.length > 0
                ? `${fmtCount(pendingFixtureIds.length)} fixture${
                    pendingFixtureIds.length === 1 ? '' : 's'
                  } not yet final`
                : analytics.live > 0
                  ? `${fmtCount(analytics.live)} slip${
                      analytics.live === 1 ? '' : 's'
                    } in play — all finished matches are settled`
                  : analytics.pending > 0
                    ? 'All finished matches are settled; open slips are waiting on kickoff.'
                    : 'Every match on these slips is settled.'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {isRefreshing && <InlineLoading label="Refreshing results…" />}
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
            <ErrorState
              title="Could not refresh results"
              description={refreshError}
              onRetry={handleManualRefresh}
            />
          )}

          <SlipDateGroups
            groups={groups}
            todayDate={todayDate}
            settlements={settlements}
            expandedDays={expandedDays}
            copiedId={copiedId}
            onToggleDay={toggleDay}
            onCopy={handleCopy}
            onLoad={onLoadTicket}
            onDelete={onDeleteTicket}
            hasCurrentTicket={hasCurrentTicket}
            onSelectMatch={handleSelectMatch}
          />
        </>
      )}

      {selectedMatch && (
        <SavedMatchDetailDialog
          ticket={selectedMatch.ticket}
          legs={selectedMatch.legs}
          fixture={matchDetails[selectedMatch.legs[0].fixtureId] ?? null}
          settlementFixture={selectedSettlementFixture}
          isLoading={isLoadingMatchDetail}
          error={matchDetailError}
          onClose={closeMatchDetail}
        />
      )}
    </section>
  );
}
