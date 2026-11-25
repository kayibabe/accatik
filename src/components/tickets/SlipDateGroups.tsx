import type { AccaLeg, SavedTicket } from '../../types/fixtures.ts';
import type { TicketSettlementEntry } from '../../utils/slipActivity.ts';
import type { TicketYearGroup } from '../../utils/savedTicketGroups.ts';
import { SavedTicketCard } from '../SavedTicketCard.tsx';
import {
  DateGroups,
  type DateGroupExpansion,
} from '../ui/DateGroups.tsx';
import { SlipDaySummary } from './SlipDaySummary.tsx';

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
      daySummary={(tickets) => (
        <SlipDaySummary tickets={tickets} settlements={settlements} />
      )}
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
