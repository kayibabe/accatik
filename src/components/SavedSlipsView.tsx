import { useState } from 'react';
import { Check, Copy, FolderOpen, Trash2 } from 'lucide-react';
import type { Fixture, SavedTicket } from '../types/fixtures.ts';
import {
  calculatePotentialReturn,
  evaluateMarketSettlement,
  evaluateTicketSettlement,
  formatMwk,
  formatTicketForCopy,
  getFixtureMatchResultSummary,
} from '../utils/accaMath.ts';
import {
  resolveFixturePool,
  type FixtureSnapshots,
} from '../utils/fixtureSnapshots.ts';
import { SettlementLabel } from './SettlementLabel.tsx';

interface SavedSlipsViewProps {
  savedTickets: SavedTicket[];
  fixtures: Fixture[];
  fixtureSnapshots: FixtureSnapshots;
  onLoadTicket: (ticket: SavedTicket) => void;
  onDeleteTicket: (ticketId: string) => void;
  onGoToSlate: () => void;
}

export function SavedSlipsView({
  savedTickets,
  fixtures,
  fixtureSnapshots,
  onLoadTicket,
  onDeleteTicket,
  onGoToSlate,
}: SavedSlipsViewProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (ticket: SavedTicket) => {
    try {
      const pool = resolveFixturePool(ticket, fixtureSnapshots, fixtures);
      await navigator.clipboard.writeText(
        formatTicketForCopy(ticket.legs, ticket.stake, ticket.date, pool)
      );
      setCopiedId(ticket.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Ignore clipboard error
    }
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

      {savedTickets.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-3">
          <p className="text-base font-semibold text-slate-900">
            No saved accumulator slips yet
          </p>
          <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
            Build or customize a 5.00+ odds ticket on today&apos;s fixture board and click &ldquo;Save Slip&rdquo; to store variations for comparison.
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
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-200">
          {savedTickets.map((ticket) => {
            const pool = resolveFixturePool(ticket, fixtureSnapshots, fixtures);
            const fixtureMap = new Map(pool.map((f) => [f.id, f]));
            const estReturn = calculatePotentialReturn(
              ticket.stake,
              ticket.totalOdds
            );
            const settlement = evaluateTicketSettlement(
              ticket.legs,
              pool,
              ticket.stake
            );
            return (
              <div key={ticket.id} className="p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p className="text-xs text-slate-500 font-mono tabular-nums">
                      {ticket.date} · {ticket.legs.length} Legs · Saved{' '}
                      {new Date(ticket.createdAt).toLocaleTimeString('en-GB', {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                        timeZone: 'Africa/Blantyre',
                      })}{' '}
                      CAT
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-3">
                      <h2 className="text-base font-bold text-slate-900">
                        {ticket.name}
                      </h2>
                      <SettlementLabel status={settlement.status} />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onLoadTicket(ticket)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors cursor-pointer"
                    >
                      <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Load into Builder</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleCopy(ticket)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
                    >
                      {copiedId === ticket.id ? (
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
                      onClick={() => onDeleteTicket(ticket.id)}
                      aria-label={`Delete ${ticket.name}`}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-6 text-xs font-mono tabular-nums pt-1">
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
                    <span className="text-slate-500">Est. Return: </span>
                    <span className="font-bold text-emerald-700">
                      {formatMwk(estReturn)}
                    </span>
                  </div>
                </div>

                <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-1">
                  {ticket.legs.map((leg) => {
                    const matched = fixtureMap.get(leg.fixtureId);
                    const legStatus = matched
                      ? evaluateMarketSettlement(matched, {
                          id: leg.marketId,
                          label: leg.marketLabel,
                          marketType: leg.marketType,
                        })
                      : 'Pending';
                    const resultText =
                      matched &&
                      (matched.status !== 'Scheduled' || matched.awaitingResult)
                        ? getFixtureMatchResultSummary(matched)
                        : null;

                    return (
                      <li
                        key={leg.fixtureId}
                        className="px-3 py-2.5 bg-slate-50 border border-slate-200/80 rounded-lg text-xs space-y-1"
                      >
                        <p className="text-[11px] font-mono text-slate-400 tabular-nums">
                          {leg.matchDate || ticket.date} · {leg.kickoffTime}
                        </p>
                        <p className="font-semibold text-slate-900 truncate">
                          {leg.homeTeam} vs {leg.awayTeam}
                        </p>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-emerald-800 font-medium truncate">
                            {leg.marketLabel}
                          </span>
                          <div className="flex items-center gap-2 shrink-0">
                            {matched && <SettlementLabel status={legStatus} />}
                            <span className="text-right leading-tight">
                              <span className="block font-mono font-bold text-slate-900 tabular-nums">
                                {leg.odds.toFixed(2)}
                              </span>
                              {typeof leg.fairProbability === 'number' && (
                                <span
                                  className="block text-[10px] font-mono text-slate-400 tabular-nums"
                                  title="Margin-adjusted win probability"
                                >
                                  {leg.fairProbability.toFixed(1)}%
                                </span>
                              )}
                            </span>
                          </div>
                        </div>
                        {resultText && (
                          <p className="text-[11px] font-mono text-slate-600 tabular-nums">
                            Result: {resultText}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
