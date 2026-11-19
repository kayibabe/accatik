import { useMemo } from 'react';
import { History, Info } from 'lucide-react';
import type { Fixture, SavedTicket, SettlementStatus } from '../types/fixtures.ts';
import type { FixtureSnapshots } from '../utils/fixtureSnapshots.ts';
import { buildSlipActivityData } from '../utils/slipActivity.ts';
import { SlipPerformancePanel } from './SlipPerformancePanel.tsx';

interface MyActivityViewProps {
  savedTickets: SavedTicket[];
  fixtures: Fixture[];
  fixtureSnapshots: FixtureSnapshots;
  /** Account slips sync to the server; guest slips stay in this browser. */
  signedIn: boolean;
  onGoToSlate: () => void;
}

const STATUS_STYLES: Record<SettlementStatus, string> = {
  Win: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Lost: 'bg-red-50 text-red-700 border-red-200',
  Void: 'bg-amber-50 text-amber-700 border-amber-200',
  Live: 'bg-sky-50 text-sky-700 border-sky-200',
  Pending: 'bg-slate-50 text-slate-600 border-slate-200',
};

const RECENT_LIMIT = 12;

/**
 * Personal activity projection.
 *
 * Everything here comes from the slips this user saved. It is intentionally
 * separate from the global Shadow Ticket Ledger (the engine's append-only
 * proof), and shares its settlement math with the Saved Slips screen through
 * buildSlipActivityData so the two views never disagree.
 */
export function MyActivityView({
  savedTickets,
  fixtures,
  fixtureSnapshots,
  signedIn,
  onGoToSlate,
}: MyActivityViewProps) {
  const activity = useMemo(
    () => buildSlipActivityData(savedTickets, fixtures, fixtureSnapshots),
    [savedTickets, fixtures, fixtureSnapshots]
  );
  const { settlements, analytics, daily, oddsBands, marketTypes } = activity;

  const recent = useMemo(
    () =>
      [...savedTickets]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, RECENT_LIMIT)
        .map((ticket) => ({
          ticket,
          status: settlements.get(ticket.id)?.settlement.status ?? 'Pending',
        })),
    [savedTickets, settlements]
  );

  return (
    <section aria-label="My Activity" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500">
            {signedIn ? 'Your Account Record' : 'This Browser’s Record'}
          </p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            My Activity
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

      <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        <p className="leading-relaxed">
          This is your personal performance from the slips you saved. The
          engine&apos;s global Shadow Ticket Ledger is a separate, append-only
          record shown under Saved Slips.{' '}
          {signedIn
            ? 'Your activity is stored on your account and syncs across devices.'
            : 'Sign in to keep this activity on your account and sync it across devices.'}
        </p>
      </div>

      {savedTickets.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-3">
          <p className="text-base font-semibold text-slate-900">
            No activity to show yet
          </p>
          <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
            Save an accumulator slip on today&apos;s fixture board and your
            settlement record, ROI and recent activity will appear here.
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
        <>
          <SlipPerformancePanel
            analytics={analytics}
            daily={daily}
            oddsBands={oddsBands}
            marketTypes={marketTypes}
          />

          <section
            aria-label="Recent saved slips"
            className="rounded-xl border border-slate-200 bg-white overflow-hidden"
          >
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
              <History className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
                Recent Activity
              </h2>
              <span className="ml-auto text-[11px] text-slate-400">
                Latest {recent.length} of {savedTickets.length} slips
              </span>
            </div>
            <div className="divide-y divide-slate-100">
              {recent.map(({ ticket, status }) => (
                <div
                  key={ticket.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">
                      {ticket.name}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {ticket.date || ticket.dateIso || '—'} ·{' '}
                      {ticket.legs.length}{' '}
                      {ticket.legs.length === 1 ? 'leg' : 'legs'} ·{' '}
                      {ticket.totalOdds.toFixed(2)} odds · stake{' '}
                      {ticket.stake.toFixed(2)}
                    </p>
                  </div>
                  <span
                    className={`inline-flex w-fit shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLES[status]}`}
                  >
                    {status}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
