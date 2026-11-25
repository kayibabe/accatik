import type { SavedTicket } from '../../types/fixtures.ts';
import { fmtCount } from '../../utils/format.ts';
import type { TicketSettlementEntry } from '../../utils/slipActivity.ts';
import { isOpenSettlement } from '../../utils/uiTone.ts';

export interface SlipDaySummaryProps {
  tickets: ReadonlyArray<SavedTicket>;
  settlements: ReadonlyMap<string, TicketSettlementEntry>;
}

/**
 * Compact counts shown beside a matchday toggle. Shared by every slip archive
 * so "open" always means the same two settlement statuses.
 */
export function SlipDaySummary({
  tickets,
  settlements,
}: SlipDaySummaryProps) {
  const statuses = tickets.map(
    (ticket) => settlements.get(ticket.id)?.settlement.status ?? 'Pending'
  );
  const won = statuses.filter((status) => status === 'Win').length;
  const lost = statuses.filter((status) => status === 'Lost').length;
  const open = statuses.filter(isOpenSettlement).length;

  return (
    <span className="flex items-center gap-3">
      <span className="font-mono text-slate-500 tabular-nums">
        {fmtCount(tickets.length)} {tickets.length === 1 ? 'slip' : 'slips'}
      </span>
      <span className="flex items-center gap-2 font-semibold">
        {won > 0 && (
          <span className="text-emerald-700">{fmtCount(won)} won</span>
        )}
        {lost > 0 && <span className="text-red-600">{fmtCount(lost)} lost</span>}
        {open > 0 && (
          <span className="text-slate-500">{fmtCount(open)} pending</span>
        )}
      </span>
    </span>
  );
}
