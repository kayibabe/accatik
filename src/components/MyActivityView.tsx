import { useMemo } from 'react';
import { Info } from 'lucide-react';
import type { Fixture, SavedTicket } from '../types/fixtures.ts';
import type { FixtureSnapshots } from '../utils/fixtureSnapshots.ts';
import { buildSlipActivityData } from '../utils/slipActivity.ts';
import { SlipPerformancePanel } from './SlipPerformancePanel.tsx';
import { RecentActivityList } from './tickets/RecentActivityList.tsx';
import { PageHeader } from './ui/PageHeader.tsx';
import { EmptyState } from './ui/States.tsx';

interface MyActivityViewProps {
  savedTickets: SavedTicket[];
  fixtures: Fixture[];
  fixtureSnapshots: FixtureSnapshots;
  /** Account slips sync to the server; guest slips stay in this browser. */
  signedIn: boolean;
  todayDate: string;
  onGoToSlate: () => void;
}

const RECENT_LIMIT = 12;

/**
 * Personal activity projection.
 *
 * Everything here comes from the slips this user saved. It is intentionally
 * separate from the global Shadow Ticket Ledger (the engine's append-only
 * proof), and shares its settlement math with the Saved Slips screen through
 * buildSlipActivityData so the two views never disagree. This is the only
 * screen that renders the full performance panels.
 */
export function MyActivityView({
  savedTickets,
  fixtures,
  fixtureSnapshots,
  signedIn,
  todayDate,
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
      <PageHeader
        eyebrow={signedIn ? 'Your Account Record' : 'This Browser’s Record'}
        title="My Activity"
        description="Your personal settlement record and performance from the slips you saved. The engine’s global Shadow Ticket Ledger is a separate, append-only record."
        scope="personal"
        onBack={onGoToSlate}
      />

      <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
        <Info
          className="mt-0.5 h-4 w-4 shrink-0 text-slate-400"
          aria-hidden="true"
        />
        <p className="leading-relaxed">
          {signedIn
            ? 'Your activity is stored on your account and syncs across devices.'
            : 'Sign in to keep this activity on your account and sync it across devices.'}{' '}
          The full breakdown below is the authoritative version of the compact
          snapshot shown under Saved Slips.
        </p>
      </div>

      {savedTickets.length === 0 ? (
        <EmptyState
          title="No activity to show yet"
          description="Save an accumulator slip on today’s fixture board and your settlement record, ROI and recent activity will appear here."
          action={
            <button
              type="button"
              onClick={onGoToSlate}
              className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors cursor-pointer"
            >
              Build First Slip
            </button>
          }
        />
      ) : (
        <>
          <SlipPerformancePanel
            analytics={analytics}
            daily={daily}
            oddsBands={oddsBands}
            marketTypes={marketTypes}
            todayDate={todayDate}
          />

          <RecentActivityList
            rows={recent}
            total={savedTickets.length}
            todayDate={todayDate}
          />
        </>
      )}
    </section>
  );
}
