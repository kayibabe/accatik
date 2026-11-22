import { ChevronRight } from 'lucide-react';
import type { AccaLeg, SavedTicket, SettlementStatus } from '../../types/fixtures.ts';
import { fmtCount } from '../../utils/format.ts';
import type { TicketSettlementEntry } from '../../utils/slipActivity.ts';
import type { TicketYearGroup } from '../../utils/savedTicketGroups.ts';
import {
  formatTicketDayLabel,
  formatTicketMonthLabel,
} from '../../utils/savedTicketGroups.ts';
import { SavedTicketCard } from '../SavedTicketCard.tsx';

interface SlipDateGroupsProps {
  groups: TicketYearGroup[];
  todayDate: string;
  settlements: Map<string, TicketSettlementEntry>;
  expandedDays: Record<string, boolean>;
  copiedId: string | null;
  onToggleDay: (dateIso: string) => void;
  onCopy: (ticket: SavedTicket) => void;
  onLoad: (ticket: SavedTicket) => void;
  onDelete: (ticketId: string) => void;
  onSelectMatch: (ticket: SavedTicket, legs: AccaLeg[]) => void;
}

function isOpen(status: SettlementStatus): boolean {
  return status === 'Pending' || status === 'Live';
}

/** Year → month → matchday accordion for the personal slip archive. */
export function SlipDateGroups({
  groups,
  todayDate,
  settlements,
  expandedDays,
  copiedId,
  onToggleDay,
  onCopy,
  onLoad,
  onDelete,
  onSelectMatch,
}: SlipDateGroupsProps) {
  return (
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
                    const expanded = expandedDays[day.dateIso] ?? day.dateIso === todayDate;
                    const panelId = `saved-slips-${day.dateIso}`;
                    const daySettlements = day.tickets.map(
                      (ticket) =>
                        settlements.get(ticket.id)?.settlement.status ?? 'Pending'
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
                          onClick={() => onToggleDay(day.dateIso)}
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
                              {fmtCount(day.tickets.length)}{' '}
                              {day.tickets.length === 1 ? 'slip' : 'slips'}
                            </span>
                            <span className="flex items-center gap-2 font-semibold">
                              {dayWon > 0 && (
                                <span className="text-emerald-700">
                                  {fmtCount(dayWon)} won
                                </span>
                              )}
                              {dayLost > 0 && (
                                <span className="text-red-600">
                                  {fmtCount(dayLost)} lost
                                </span>
                              )}
                              {dayOpen > 0 && (
                                <span className="text-slate-500">
                                  {fmtCount(dayOpen)} pending
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
                                  onCopy={onCopy}
                                  onLoad={onLoad}
                                  onDelete={onDelete}
                                  onSelectMatch={onSelectMatch}
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
  );
}
