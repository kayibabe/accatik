import { useMemo } from 'react';
import { History } from 'lucide-react';
import type { SavedTicket, SettlementStatus } from '../../types/fixtures.ts';
import { groupRowsByDate } from '../../utils/dateGroups.ts';
import { fmtCount, fmtFixed, fmtOdds, fmtShortDate } from '../../utils/format.ts';
import { ticketDateIso } from '../../utils/savedTicketGroups.ts';
import { settlementTone } from '../../utils/uiTone.ts';
import { DateGroups } from '../ui/DateGroups.tsx';
import { DataCard } from '../ui/DataCard.tsx';

export interface RecentActivityRow {
  ticket: SavedTicket;
  status: SettlementStatus;
}

interface RecentActivityListProps {
  rows: RecentActivityRow[];
  total: number;
  todayDate: string;
  selectedDate: string;
}

/** Compact personal ledger: the newest saved slips and their settlement. */
export function RecentActivityList({
  rows,
  total,
  todayDate,
  selectedDate,
}: RecentActivityListProps) {
  const groups = useMemo(
    () => groupRowsByDate(rows, (row) => ticketDateIso(row.ticket)),
    [rows]
  );

  return (
    <DataCard
      labelledBy="recent-activity-title"
      title={
        <span className="inline-flex items-center gap-2">
          <History className="h-4 w-4 text-slate-600" aria-hidden="true" />
          <span>Recent Activity</span>
        </span>
      }
      subtitle={`Latest ${fmtCount(rows.length)} of ${fmtCount(total)} slips`}
      bodyClassName="p-4 sm:p-5"
    >
      <DateGroups
        groups={groups}
        todayDate={todayDate}
        focusDate={selectedDate}
        idPrefix="recent-activity"
        empty={
          <p className="py-4 text-center text-sm text-slate-500">
            No saved slips in this range.
          </p>
        }
        renderDay={(dayRows) => (
          <div className="divide-y divide-slate-100">
            {dayRows.map(({ ticket, status }) => (
              <div
                key={ticket.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3"
              >
                <div className="min-w-0">
                  <p
                    className="truncate text-sm font-semibold text-slate-800"
                    title={ticket.name}
                  >
                    {ticket.name}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {ticket.date || fmtShortDate(ticket.dateIso)} ·{' '}
                    {ticket.legs.length}{' '}
                    {ticket.legs.length === 1 ? 'leg' : 'legs'} ·{' '}
                    {fmtOdds(ticket.totalOdds)} odds · stake{' '}
                    {fmtFixed(ticket.stake, 2)}
                  </p>
                </div>
                <span
                  className={`inline-flex w-fit shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${settlementTone(status)}`}
                >
                  {status}
                </span>
              </div>
            ))}
          </div>
        )}
      />
    </DataCard>
  );
}
