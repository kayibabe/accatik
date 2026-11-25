import { useMemo, useState } from 'react';
import { Archive, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import type { Fixture, SavedTicket, SettlementStatus } from '../../types/fixtures.ts';
import {
  evaluateMarketSettlement,
  getFixtureMatchResultSummary,
} from '../../utils/accaMath.ts';
import type { FixtureSnapshots } from '../../utils/fixtureSnapshots.ts';
import { fmtCount, fmtMwk, fmtOdds } from '../../utils/format.ts';
import {
  groupTicketsByDate,
  shiftIsoDate,
  sortTicketsNewestFirst,
  ticketDateIso,
} from '../../utils/savedTicketGroups.ts';
import { buildSlipActivityData } from '../../utils/slipActivity.ts';
import { SettlementLabel } from '../SettlementLabel.tsx';
import { DateGroups, useDateGroupExpansion } from '../ui/DateGroups.tsx';
import { DataCard } from '../ui/DataCard.tsx';
import { EmptyState } from '../ui/States.tsx';
import { SlipDaySummary } from './SlipDaySummary.tsx';
import { usePendingResultRefresh } from './usePendingResultRefresh.ts';

type HistoryRange = 'all' | 'week' | 'yesterday';

interface TicketHistoryPanelProps {
  savedTickets: SavedTicket[];
  liveFixtures: Fixture[];
  fixtureSnapshots: FixtureSnapshots;
  /** CAT calendar date, used for "Today"/"Yesterday" labels. */
  todayDate: string;
  /** Matchday selected in the date bar, whose group opens by default. */
  selectedDate: string;
  onOpenArchive: () => void;
  onRefreshResults: (fixtureIds: string[]) => Promise<Fixture[]>;
}

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
  selectedDate,
  onOpenArchive,
  onRefreshResults,
}: TicketHistoryPanelProps) {
  const [range, setRange] = useState<HistoryRange>('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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

  const groups = useMemo(() => groupTicketsByDate(tickets), [tickets]);
  const expansion = useDateGroupExpansion(groups, selectedDate);

  const {
    pendingFixtureIds,
    isRefreshing: refreshing,
    refreshError,
    refreshPending,
    clearError,
  } = usePendingResultRefresh({
    tickets: savedTickets,
    settlements: activity.settlements,
    onRefreshResults,
    batchSize: 20,
  });

  const handleRefresh = async () => {
    if (refreshing || pendingFixtureIds.length === 0) return;
    clearError();
    await refreshPending();
  };

  const defaultOpenTicketId =
    tickets.find((ticket) => ticketDateIso(ticket) === selectedDate)?.id ??
    tickets[0]?.id;
  const isExpanded = (ticketId: string) =>
    expanded[ticketId] ?? ticketId === defaultOpenTicketId;
  const toggle = (ticketId: string) =>
    setExpanded((prev) => ({ ...prev, [ticketId]: !isExpanded(ticketId) }));

  return (
    <DataCard
      labelledBy="ticket-history-title"
      title="Past tickets & results"
      subtitle="Saved slips stay here for reference, with every leg settled from captured scores."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            Show
            <select
              aria-label="Past ticket date range"
              value={range}
              onChange={(event) => {
                setRange(event.target.value as HistoryRange);
                setExpanded({});
              }}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 cursor-pointer"
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
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
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
            className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-800 cursor-pointer"
          >
            <Archive className="h-3 w-3" aria-hidden="true" />
            Full archive
          </button>
        </div>
      }
    >
      {refreshError && (
        <p role="alert" className="mb-2 text-xs text-red-600">
          {refreshError}
        </p>
      )}

      <DateGroups
        groups={groups}
        todayDate={todayDate}
        idPrefix="ticket-history"
        expansion={expansion}
        empty={
          <EmptyState
            title="No past tickets in this range"
            description="Save a pre-match slip on the fixture board and its result will appear here alongside its leg-by-leg settlement."
          />
        }
        daySummary={(dayTickets) => (
          <SlipDaySummary
            tickets={dayTickets}
            settlements={activity.settlements}
          />
        )}
        renderDay={(dayTickets) => (
          <div className="divide-y divide-slate-200">
            {dayTickets.map((ticket) => {
              const { pool, settlement } = activity.settlements.get(ticket.id) ?? {
                pool: [] as Fixture[],
                settlement: null,
              };
              const open = isExpanded(ticket.id);
              const byId = new Map(pool.map((fixture) => [fixture.id, fixture]));

              return (
                <article key={ticket.id} className="bg-white">
                  <button
                    type="button"
                    onClick={() => toggle(ticket.id)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-50 cursor-pointer"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-900">
                        {ticket.name}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {fmtCount(ticket.legs.length)}{' '}
                        {ticket.legs.length === 1 ? 'leg' : 'legs'} ·{' '}
                        {fmtOdds(ticket.totalOdds)} odds · {fmtMwk(ticket.stake)} stake
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {settlement && <SettlementLabel status={settlement.status} />}
                      <span className="font-mono text-sm font-bold text-slate-800 tabular-nums">
                        {settlement ? fmtMwk(settlement.settledReturn) : '—'}
                      </span>
                      {open ? (
                        <ChevronDown
                          className="h-3.5 w-3.5 text-slate-600"
                          aria-hidden="true"
                        />
                      ) : (
                        <ChevronRight
                          className="h-3.5 w-3.5 text-slate-600"
                          aria-hidden="true"
                        />
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
                              className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 text-sm"
                            >
                              <span className="font-mono text-xs text-slate-600">
                                {String(legIndex + 1).padStart(2, '0')}
                              </span>
                              <span className="font-semibold text-slate-800">
                                {leg.homeTeam} vs {leg.awayTeam}
                              </span>
                              <span className="text-slate-500">
                                · {leg.marketLabel}
                              </span>
                              <span className="font-mono text-slate-700">
                                {fmtOdds(leg.odds)}
                              </span>
                              <SettlementLabel status={status} />
                              <span className="font-mono text-xs text-slate-500">
                                {result}
                              </span>
                            </li>
                          );
                        })}
                      </ol>
                      {settlement && (
                        <p className="mt-2 border-t border-slate-200 pt-2 text-xs text-slate-500">
                          {fmtCount(settlement.winCount)}W ·{' '}
                          {fmtCount(settlement.lostCount)}L ·{' '}
                          {fmtCount(settlement.voidCount)}V ·{' '}
                          {fmtCount(
                            settlement.pendingCount + settlement.liveCount
                          )}{' '}
                          open
                        </p>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      />
    </DataCard>
  );
}
