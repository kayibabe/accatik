import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import type { Fixture, SavedTicket, SettlementStatus } from '../../types/fixtures.ts';
import {
  evaluateMarketSettlement,
  getFixtureMatchResultSummary,
} from '../../utils/accaMath.ts';
import type { FixtureSnapshots } from '../../utils/fixtureSnapshots.ts';
import { fmtCount, fmtMwk, fmtOdds } from '../../utils/format.ts';
import {
  formatTicketDayLabel,
  shiftIsoDate,
  sortTicketsNewestFirst,
  ticketDateIso,
} from '../../utils/savedTicketGroups.ts';
import { buildSlipActivityData } from '../../utils/slipActivity.ts';
import { SettlementLabel } from '../SettlementLabel.tsx';
import { DataCard } from '../ui/DataCard.tsx';
import { EmptyState } from '../ui/States.tsx';

type HistoryRange = 'all' | 'week' | 'yesterday';

interface TicketHistoryPanelProps {
  savedTickets: SavedTicket[];
  liveFixtures: Fixture[];
  fixtureSnapshots: FixtureSnapshots;
  todayDate: string;
  onOpenArchive: () => void;
  onRefreshResults: (fixtureIds: string[]) => Promise<Fixture[]>;
}

const PAGE_SIZE = 5;
const REFRESH_BATCH = 20;

/**
 * Read-only reference of previously saved tickets, settled from the same
 * snapshot projection used by Saved Slips and My Activity. Nothing here loads
 * a ticket into the current slip — that stays an fixture-board action.
 */
export function TicketHistoryPanel({
  savedTickets,
  liveFixtures,
  fixtureSnapshots,
  todayDate,
  onOpenArchive,
  onRefreshResults,
}: TicketHistoryPanelProps) {
  const [range, setRange] = useState<HistoryRange>('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const requestedResultsRef = useRef<Set<string>>(new Set());

  const activity = useMemo(
    () => buildSlipActivityData(savedTickets, liveFixtures, fixtureSnapshots),
    [savedTickets, liveFixtures, fixtureSnapshots]
  );

  const tickets = useMemo(() => {
    const yesterday = shiftIsoDate(todayDate, -1);
    const weekStart = shiftIsoDate(todayDate, -6);
    return sortTicketsNewestFirst(savedTickets).filter((ticket) => {
      const dateIso = ticketDateIso(ticket);
      if (range === 'yesterday') return dateIso === yesterday;
      if (range === 'week') return dateIso >= weekStart && dateIso <= todayDate;
      return true;
    });
  }, [savedTickets, todayDate, range]);

  const pendingFixtureIds = useMemo(() => {
    const nowMs = Date.now();
    const ids = new Set<string>();

    for (const ticket of savedTickets) {
      const pool = activity.settlements.get(ticket.id)?.pool ?? [];
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
        if (status !== 'Pending' && status !== 'Live') continue;
        if (
          fixture.status === 'Scheduled' &&
          typeof fixture.kickoffTimestamp === 'number' &&
          fixture.kickoffTimestamp > nowMs
        ) {
          continue;
        }
        ids.add(leg.fixtureId);
      }
    }

    return [...ids].slice(0, REFRESH_BATCH);
  }, [savedTickets, activity]);

  // Settle finished legs without making the user hunt for the old matchday.
  // IDs are remembered so a silent feed cannot trigger a refresh loop.
  useEffect(() => {
    const batch = pendingFixtureIds
      .filter((id) => !requestedResultsRef.current.has(id))
      .slice(0, REFRESH_BATCH);
    if (batch.length === 0) return;

    for (const id of batch) requestedResultsRef.current.add(id);
    void onRefreshResults(batch).catch(() => {
      // Manual refresh stays available if this automatic fetch fails.
    });
  }, [pendingFixtureIds, onRefreshResults]);

  const handleRefresh = async () => {
    if (refreshing || pendingFixtureIds.length === 0) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      await onRefreshResults(pendingFixtureIds);
    } catch (error) {
      setRefreshError(
        error instanceof Error ? error.message : 'Could not refresh results.'
      );
    } finally {
      setRefreshing(false);
    }
  };

  const visible = tickets.slice(0, visibleCount);
  const isExpanded = (ticketId: string, index: number) =>
    expanded[ticketId] ?? index === 0;
  const toggle = (ticketId: string, index: number) =>
    setExpanded((prev) => ({
      ...prev,
      [ticketId]: !isExpanded(ticketId, index),
    }));

  return (
    <DataCard
      labelledBy="ticket-history-title"
      title="Past tickets & results"
      subtitle="Saved slips stay here for reference, with every leg settled from captured scores."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
            Show
            <select
              aria-label="Past ticket date range"
              value={range}
              onChange={(event) => {
                setRange(event.target.value as HistoryRange);
                setVisibleCount(PAGE_SIZE);
              }}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 cursor-pointer"
            >
              <option value="all">All saved</option>
              <option value="week">Last 7 days</option>
              <option value="yesterday">Yesterday</option>
            </select>
          </label>
          {pendingFixtureIds.length > 0 && (
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw
                className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              {refreshing ? 'Refreshing…' : 'Refresh results'}
            </button>
          )}
          <button
            type="button"
            onClick={onOpenArchive}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 cursor-pointer"
          >
            <Archive className="h-3 w-3" aria-hidden="true" />
            Full archive
          </button>
        </div>
      }
    >
      {refreshError && (
        <p role="alert" className="mb-2 text-[11px] text-red-600">
          {refreshError}
        </p>
      )}

      {tickets.length === 0 ? (
        <EmptyState
          title="No past tickets in this range"
          description="Save a pre-match slip on the fixture board and its result will appear here alongside its leg-by-leg settlement."
        />
      ) : (
        <div className="space-y-2">
          {visible.map((ticket, index) => {
            const { pool, settlement } = activity.settlements.get(ticket.id) ?? {
              pool: [] as Fixture[],
              settlement: null,
            };
            const open = isExpanded(ticket.id, index);
            const byId = new Map(pool.map((fixture) => [fixture.id, fixture]));

            return (
              <article
                key={ticket.id}
                className="overflow-hidden rounded-lg border border-slate-200"
              >
                <button
                  type="button"
                  onClick={() => toggle(ticket.id, index)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-50 cursor-pointer"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] text-slate-500">
                      {formatTicketDayLabel(
                        ticketDateIso(ticket),
                        todayDate
                      )}
                    </span>
                    <span className="block truncate text-xs font-semibold text-slate-900">
                      {ticket.name}
                    </span>
                    <span className="block text-[11px] text-slate-500">
                      {fmtCount(ticket.legs.length)}{' '}
                      {ticket.legs.length === 1 ? 'leg' : 'legs'} ·{' '}
                      {fmtOdds(ticket.totalOdds)} odds · {fmtMwk(ticket.stake)} stake
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {settlement && <SettlementLabel status={settlement.status} />}
                    <span className="font-mono text-xs font-bold text-slate-800 tabular-nums">
                      {settlement ? fmtMwk(settlement.settledReturn) : '—'}
                    </span>
                    {open ? (
                      <ChevronDown className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                    )}
                  </span>
                </button>

                {open && (
                  <div className="border-t border-slate-200 bg-slate-50/60 px-3 py-2">
                    <ol className="divide-y divide-slate-200">
                      {ticket.legs.map((leg, legIndex) => {
                        const fixture = byId.get(leg.fixtureId);
                        const status: SettlementStatus = fixture
                          ? evaluateMarketSettlement(fixture, {
                              id: leg.marketId,
                              label: leg.marketLabel,
                              marketType: leg.marketType,
                            })
                          : 'Pending';
                        const result = fixture
                          ? getFixtureMatchResultSummary(fixture)
                          : 'No score captured';

                        return (
                          <li
                            key={`${leg.fixtureId}-${leg.marketId}-${legIndex}`}
                            className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 text-xs"
                          >
                            <span className="font-mono text-[11px] text-slate-400">
                              {String(legIndex + 1).padStart(2, '0')}
                            </span>
                            <span className="font-semibold text-slate-800">
                              {leg.homeTeam} vs {leg.awayTeam}
                            </span>
                            <span className="text-slate-500">· {leg.marketLabel}</span>
                            <span className="font-mono text-slate-700">
                              {fmtOdds(leg.odds)}
                            </span>
                            <SettlementLabel status={status} />
                            <span className="font-mono text-[11px] text-slate-500">
                              {result}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                    {settlement && (
                      <p className="mt-2 border-t border-slate-200 pt-2 text-[11px] text-slate-500">
                        {fmtCount(settlement.winCount)}W · {fmtCount(settlement.lostCount)}L
                        {' · '}
                        {fmtCount(settlement.voidCount)}V ·{' '}
                        {fmtCount(settlement.pendingCount + settlement.liveCount)} open
                      </p>
                    )}
                  </div>
                )}
              </article>
            );
          })}

          {tickets.length > visibleCount && (
            <button
              type="button"
              onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
              className="w-full rounded-lg border border-slate-200 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              Show {Math.min(PAGE_SIZE, tickets.length - visibleCount)} more of{' '}
              {fmtCount(tickets.length)} saved tickets
            </button>
          )}
        </div>
      )}
    </DataCard>
  );
}
