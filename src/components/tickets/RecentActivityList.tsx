import { History } from 'lucide-react';
import type { SavedTicket, SettlementStatus } from '../../types/fixtures.ts';
import { fmtCount, fmtFixed, fmtOdds, fmtShortDate } from '../../utils/format.ts';
import { settlementTone } from '../../utils/uiTone.ts';
import { DataCard } from '../ui/DataCard.tsx';

export interface RecentActivityRow {
  ticket: SavedTicket;
  status: SettlementStatus;
}

interface RecentActivityListProps {
  rows: RecentActivityRow[];
  total: number;
}

/** Compact personal ledger: the newest saved slips and their settlement. */
export function RecentActivityList({ rows, total }: RecentActivityListProps) {
  return (
    <DataCard
      labelledBy="recent-activity-title"
      title={
        <span className="inline-flex items-center gap-2">
          <History className="h-4 w-4 text-slate-400" aria-hidden="true" />
          <span>Recent Activity</span>
        </span>
      }
      subtitle={`Latest ${fmtCount(rows.length)} of ${fmtCount(total)} slips`}
      bodyClassName="divide-y divide-slate-100"
    >
      {rows.map(({ ticket, status }) => (
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
            <p className="mt-0.5 text-[11px] text-slate-500">
              {ticket.date || fmtShortDate(ticket.dateIso)} · {ticket.legs.length}{' '}
              {ticket.legs.length === 1 ? 'leg' : 'legs'} · {fmtOdds(ticket.totalOdds)}{' '}
              odds · stake {fmtFixed(ticket.stake, 2)}
            </p>
          </div>
          <span
            className={`inline-flex w-fit shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${settlementTone(status)}`}
          >
            {status}
          </span>
        </div>
      ))}
    </DataCard>
  );
}
