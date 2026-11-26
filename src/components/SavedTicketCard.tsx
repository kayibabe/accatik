import { useState } from 'react';
import { Check, Copy, FolderOpen, Trash2 } from 'lucide-react';
import type {
  AccaLeg,
  Fixture,
  SavedTicket,
} from '../types/fixtures.ts';
import {
  calculatePotentialReturn,
  evaluateMarketSettlement,
  getFixtureMatchResultSummary,
} from '../utils/accaMath.ts';
import type { TicketSettlementSummary } from '../utils/accaMath.ts';
import {
  fmtCount,
  fmtMwk,
  fmtOdds,
  fmtPercent,
} from '../utils/format.ts';
import { groupLegsByFixture } from '../utils/savedTicketGroups.ts';
import { settlementTone } from '../utils/uiTone.ts';
import { SettlementLabel } from './SettlementLabel.tsx';
import { MarketLabelText } from './ui/MarketLabel.tsx';

interface SavedTicketCardProps {
  ticket: SavedTicket;
  /** Settlement fixtures already merged from the live slate and every snapshot. */
  pool: Fixture[];
  settlement: TicketSettlementSummary;
  copied: boolean;
  onCopy: (ticket: SavedTicket) => void;
  onLoad: (ticket: SavedTicket) => void;
  onDelete: (ticketId: string) => void;
  /** Whether loading this slip would replace picks already in the builder. */
  hasCurrentTicket: boolean;
  /** Opens the archived day-of-pick detail for every pick on one match. */
  onSelectMatch: (ticket: SavedTicket, legs: AccaLeg[]) => void;
}

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
  hasCurrentTicket,
  onSelectMatch,
}: SavedTicketCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLoad, setConfirmLoad] = useState(false);
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
      className="p-5 space-y-4 border border-slate-200 rounded-xl"
      aria-label={`${ticket.name} — ${settlement.status}`}
    >
      {/* Ticket identity and actions are grouped; status is the only colour accent here. */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-slate-500 font-mono tabular-nums">
            {fmtCount(ticket.legs.length)} Legs · Saved{' '}
            {savedTimeLabel(ticket.createdAt)} CAT
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-3">
            <h3 className="text-base font-bold text-slate-900" title={ticket.name}>
              {ticket.name}
            </h3>
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 ${settlementTone(settlement.status)}`}
            >
              <SettlementLabel status={settlement.status} />
            </span>
          </div>
        </div>

        <div
          role="group"
          aria-label={`Actions for ${ticket.name}`}
          className="flex flex-wrap items-center gap-2"
        >
          <button
            type="button"
            onClick={() => {
              setConfirmDelete(false);
              if (hasCurrentTicket) setConfirmLoad(true);
              else onLoad(ticket);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Load into Builder</span>
          </button>

          <button
            type="button"
            onClick={() => onCopy(ticket)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
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
            onClick={() => {
              setConfirmLoad(false);
              setConfirmDelete(true);
            }}
            aria-label={`Delete ${ticket.name}`}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-sm font-medium text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Delete</span>
          </button>
        </div>
      </div>

      {(confirmDelete || confirmLoad) && (
        <div
          role="alertdialog"
          aria-label={confirmDelete ? 'Confirm deletion' : 'Confirm replacement'}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          <span>
            {confirmDelete
              ? 'Delete this saved slip permanently? This cannot be undone.'
              : 'Replace the ticket currently in the builder with this saved slip?'}
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirmDelete(false);
                setConfirmLoad(false);
              }}
              className="rounded-md px-2.5 py-1 font-semibold hover:bg-amber-100 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => {
                if (confirmDelete) onDelete(ticket.id);
                else onLoad(ticket);
                setConfirmDelete(false);
                setConfirmLoad(false);
              }}
              className={`rounded-md px-2.5 py-1 font-semibold text-white cursor-pointer ${
                confirmDelete
                  ? 'bg-red-700 hover:bg-red-800'
                  : 'bg-emerald-700 hover:bg-emerald-800'
              }`}
            >
              {confirmDelete ? 'Delete slip' : 'Replace ticket'}
            </button>
          </span>
        </div>
      )}

      {/* Figures and result counts stay in one neutral band. */}
      <div
        aria-label="Ticket figures"
        className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-mono tabular-nums sm:grid-cols-4"
      >
        <div>
          <span className="text-slate-500">Total odds: </span>
          <span className="font-bold text-slate-900">
            {fmtOdds(ticket.totalOdds)}
          </span>
        </div>
        <div>
          <span className="text-slate-500">Stake: </span>
          <span className="font-semibold text-slate-900">
            {fmtMwk(ticket.stake)}
          </span>
        </div>
        <div>
          <span className="text-slate-500">
            {isSettled ? 'Settled return: ' : 'Est. return: '}
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
            {settlement.status === 'Lost'
              ? `Loss · ${fmtMwk(settlement.settledReturn)} returned`
              : isSettled
                ? `+${fmtMwk(settlement.settledReturn)}`
                : fmtMwk(potentialReturn)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {legCounts(settlement).map((entry) => (
            <span
              key={entry.key}
              className={`text-xs font-semibold ${entry.className}`}
            >
              {fmtCount(entry.count)} {entry.label}
            </span>
          ))}
        </div>
      </div>

      {/* Selections and their results are grouped by match, one card per match. */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 pt-1">
          <h4 className="text-xs font-medium uppercase tracking-wide text-slate-600">
            Match legs &amp; results
          </h4>
          <p className="text-xs text-slate-600">
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
            const fixtureLabel = `${firstLeg.homeTeam} vs ${firstLeg.awayTeam}`;

            return (
              <li key={group.fixtureId} className="min-w-0">
                <button
                  type="button"
                  onClick={() => onSelectMatch(ticket, group.legs)}
                  aria-haspopup="dialog"
                  title={`Open ${fixtureLabel} details`}
                  className="group h-full w-full space-y-1 rounded-lg border border-slate-200/80 bg-slate-50 px-3 py-2.5 text-left text-sm transition-colors hover:border-slate-300 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-700 cursor-pointer"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="block font-mono text-xs text-slate-600 tabular-nums">
                      {firstLeg.matchDate || ticket.date} · {firstLeg.kickoffTime}
                    </span>
                    {hasMultiplePicks && (
                      <span className="shrink-0 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs font-semibold text-slate-600">
                        {fmtCount(group.legs.length)} picks
                      </span>
                    )}
                  </span>
                  <span
                    className="block truncate font-semibold text-slate-900"
                    title={fixtureLabel}
                  >
                    {fixtureLabel}
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
                          <span className="truncate" title={leg.marketLabel}>
                            <MarketLabelText
                              label={leg.marketLabel}
                              marketType={leg.marketType}
                            />
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            <SettlementLabel status={legStatus} />
                            <span className="text-right leading-tight">
                              <span className="block font-mono font-bold text-slate-900 tabular-nums">
                                {fmtOdds(leg.odds)}
                              </span>
                              {typeof leg.fairProbability === 'number' && (
                                <span
                                  className="block font-mono text-xs text-slate-600 tabular-nums"
                                  title="Margin-adjusted win probability"
                                >
                                  {fmtPercent(leg.fairProbability)}
                                </span>
                              )}
                            </span>
                          </span>
                        </span>
                      );
                    })}
                  </span>
                  {resultText && (
                    <span className="block font-mono text-xs text-slate-600 tabular-nums">
                      Result: {resultText}
                    </span>
                  )}
                  <span className="block text-xs font-medium text-slate-500 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    {hasMultiplePicks
                      ? `View all ${fmtCount(group.legs.length)} selections →`
                      : 'View match detail →'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </article>
  );
}
