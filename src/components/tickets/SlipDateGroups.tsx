import type { AccaLeg, SavedTicket, SettlementStatus } from '../../types/fixtures.ts';
import { fmtCount } from '../../utils/format.ts';
import type { TicketSettlementEntry } from '../../utils/slipActivity.ts';
import type { TicketYearGroup } from '../../utils/savedTicketGroups.ts';
import { SavedTicketCard } from '../SavedTicketCard.tsx';
import {
  DateGroups,
  type DateGroupExpansion,
} from '../ui/DateGroups.tsx';

interface SlipDateGroupsProps {
  groups: TicketYearGroup[];
  todayDate: string;
  settlements: Map<string, TicketSettlementEntry>;
  expansion: DateGroupExpansion;
  copiedId: string | null;
  onCopy: (ticket: SavedTicket) => void;
  onLoad: (ticket: SavedTicket) => void;
  onDelete: (ticketId: string) => void;
  hasCurrentTicket: boolean;
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
  expansion,
  copiedId,
  onCopy,
  onLoad,
  onDelete,
  hasCurrentTicket,
  onSelectMatch,
}: SlipDateGroupsProps) {
  return (
    <DateGroups
      groups={groups}
      todayDate={todayDate}
      idPrefix="saved-slips"
      expansion={expansion}
      daySummary={(tickets) => {
        const statuses = tickets.map(
          (ticket) =>
            settlements.get(ticket.id)?.settlement.status ?? 'Pending'
        );
        const won = statuses.filter((status) => status === 'Win').length;
        const lost = statuses.filter((status) => status === 'Lost').length;
        const open = statuses.filter(isOpen).length;

        return (
          <span className="flex items-center gap-3">
            <span className="font-mono text-slate-500 tabular-nums">
              {fmtCount(tickets.length)} {tickets.length === 1 ? 'slip' : 'slips'}
            </span>
            <span className="flex items-center gap-2 font-semibold">
              {won > 0 && (
                <span className="text-emerald-700">{fmtCount(won)} won</span>
              )}
              {lost > 0 && (
                <span className="text-red-600">{fmtCount(lost)} lost</span>
              )}
              {open > 0 && (
                <span className="text-slate-500">
                  {fmtCount(open)} pending
                </span>
              )}
            </span>
          </span>
        );
      }}
      renderDay={(tickets) => (
        <div className="divide-y divide-slate-200">
          {tickets.map((ticket) => {
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
                hasCurrentTicket={hasCurrentTicket}
                onSelectMatch={onSelectMatch}
              />
            );
          })}
        </div>
      )}
    />
  );
}
