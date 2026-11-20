import { Check, Copy, FolderOpen, Trash2 } from 'lucide-react';
import type {
  AccaLeg,
  Fixture,
  SavedTicket,
  SettlementStatus,
} from '../types/fixtures.ts';
import {
  calculatePotentialReturn,
  evaluateMarketSettlement,
  formatMwk,
  getFixtureMatchResultSummary,
} from '../utils/accaMath.ts';
import type { TicketSettlementSummary } from '../utils/accaMath.ts';
import { groupLegsByFixture } from '../utils/savedTicketGroups.ts';
import { SettlementLabel } from './SettlementLabel.tsx';

interface SavedTicketCardProps {
  ticket: SavedTicket;
  /** Settlement fixtures already merged from the live slate and every snapshot. */
  pool: Fixture[];
  settlement: TicketSettlementSummary;
  copied: boolean;
  onCopy: (ticket: SavedTicket) => void;
  onLoad: (ticket: SavedTicket) => void;
  onDelete: (ticketId: string) => void;
  /** Opens the archived day-of-pick detail for every pick on one match. */
  onSelectMatch: (ticket: SavedTicket, legs: AccaLeg[]) => void;
}

const accentByStatus: Record<SettlementStatus, string> = {
  Win: 'border-l-emerald-500',
  Lost: 'border-l-red-500',
  Void: 'border-l-amber-500',
  Live: 'border-l-sky-500',
  Pending: 'border-l-slate-300',
};

function savedTimeLabel(createdAt: string): string {
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) return 'time unknown';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Blantyre',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parsed);
}

function legCounts(settlement: TicketSettlementSummary) {
  return [
    { key: 'Win', label: 'Won', count: settlement.winCount, className: 'text-emerald-700' },
    { key: 'Lost', label: 'Lost', count: settlement.lostCount, className: 'text-red-600' },
    { key: 'Void', label: 'Void', count: settlement.voidCount, className: 'text-amber-700' },
    { key: 'Live', label: 'Live', count: settlement.liveCount, className: 'text-sky-700' },
    { key: 'Pending', label: 'Pending', count: settlement.pendingCount, className: 'text-slate-500' },
  ].filter((entry) => entry.count > 0);
}

export function SavedTicketCard({
  ticket,
  pool,
  settlement,
  copied,
  onCopy,
  onLoad,
  onDelete,
  onSelectMatch,
}: SavedTicketCardProps) {
  const fixtureMap = new Map(pool.map((fixture) => [fixture.id, fixture]));
  const isSettled =
    settlement.status === 'Win' ||
    settlement.status === 'Lost' ||
    settlement.status === 'Void';
  const potentialReturn = calculatePotentialReturn(
    ticket.stake,
    ticket.totalOdds
  );

  return (
    <article
      className={`p-5 space-y-4 border-l-4 ${accentByStatus[settlement.status]}`}
      aria-label={`${ticket.name} — ${settlement.status}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500 font-mono tabular-nums">
            {ticket.legs.length} Legs · Saved {savedTimeLabel(ticket.createdAt)} CAT
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-3">
            <h3 className="text-base font-bold text-slate-900">{ticket.name}</h3>
            <SettlementLabel status={settlement.status} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onLoad(ticket)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Load into Builder</span>
          </button>

          <button
            type="button"
            onClick={() => onCopy(ticket)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Copy</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => onDelete(ticket.id)}
            aria-label={`Delete ${ticket.name}`}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Delete</span>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs font-mono tabular-nums">
        <div>
          <span className="text-slate-500">Total Odds: </span>
          <span className="font-bold text-slate-900">
            {ticket.totalOdds.toFixed(2)}
          </span>
        </div>
        <div>
          <span className="text-slate-500">Stake: </span>
          <span className="font-semibold text-slate-900">
            {formatMwk(ticket.stake)}
          </span>
        </div>
        <div>
          <span className="text-slate-500">
            {isSettled ? 'Settled Return: ' : 'Est. Return: '}
          </span>
          <span
            className={`font-bold ${
              settlement.status === 'Lost'
                ? 'text-red-600'
                : isSettled
                  ? 'text-emerald-700'
                  : 'text-slate-500'
            }`}
          >
            {isSettled
              ? formatMwk(settlement.settledReturn)
              : formatMwk(potentialReturn)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {legCounts(settlement).map((entry) => (
            <span
              key={entry.key}
              className={`text-[11px] font-semibold ${entry.className}`}
            >
              {entry.count} {entry.label}
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
          Match legs
        </p>
        <p className="text-[10px] text-slate-400">
          Multiple picks on one match are grouped · click for detail
        </p>
      </div>

      <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {groupLegsByFixture(ticket.legs).map((group) => {
          const firstLeg = group.legs[0];
          const matched = fixtureMap.get(group.fixtureId);
          const resultText =
            matched &&
            (matched.status !== 'Scheduled' || matched.awaitingResult)
              ? getFixtureMatchResultSummary(matched)
              : null;
          const hasMultiplePicks = group.legs.length > 1;

          return (
            <li key={group.fixtureId} className="min-w-0">
              <button
                type="button"
                onClick={() => onSelectMatch(ticket, group.legs)}
                aria-haspopup="dialog"
                title={`Open ${firstLeg.homeTeam} vs ${firstLeg.awayTeam} details`}
                className="group h-full w-full space-y-1 rounded-lg border border-slate-200/80 bg-slate-50 px-3 py-2.5 text-left text-xs transition-colors hover:border-emerald-300 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-700 cursor-pointer"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="block font-mono text-[11px] text-slate-400 tabular-nums">
                    {firstLeg.matchDate || ticket.date} · {firstLeg.kickoffTime}
                  </span>
                  {hasMultiplePicks && (
                    <span className="shrink-0 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                      {group.legs.length} picks
                    </span>
                  )}
                </span>
                <span className="block truncate font-semibold text-slate-900">
                  {firstLeg.homeTeam} vs {firstLeg.awayTeam}
                </span>
                <span className="block space-y-1">
                  {group.legs.map((leg) => {
                    const legStatus = matched
                      ? evaluateMarketSettlement(matched, {
                          id: leg.marketId,
                          label: leg.marketLabel,
                          marketType: leg.marketType,
                        })
                      : 'Pending';

                    return (
                      <span
                        key={leg.marketId}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="truncate font-medium text-emerald-800">
                          {leg.marketLabel}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <SettlementLabel status={legStatus} />
                          <span className="text-right leading-tight">
                            <span className="block font-mono font-bold text-slate-900 tabular-nums">
                              {leg.odds.toFixed(2)}
                            </span>
                            {typeof leg.fairProbability === 'number' && (
                              <span
                                className="block font-mono text-[10px] text-slate-400 tabular-nums"
                                title="Margin-adjusted win probability"
                              >
                                {leg.fairProbability.toFixed(1)}%
                              </span>
                            )}
                          </span>
                        </span>
                      </span>
                    );
                  })}
                </span>
                {resultText && (
                  <span className="block font-mono text-[11px] text-slate-600 tabular-nums">
                    Result: {resultText}
                  </span>
                )}
                <span className="block text-[10px] font-medium text-emerald-700 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  {hasMultiplePicks
                    ? `View all ${group.legs.length} selections →`
                    : 'View match detail →'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
