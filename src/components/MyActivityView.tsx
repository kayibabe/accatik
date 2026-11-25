import { useMemo } from 'react';
import type { Fixture, SavedTicket } from '../types/fixtures.ts';
import type { FixtureSnapshots } from '../utils/fixtureSnapshots.ts';
import { buildSlipActivityData } from '../utils/slipActivity.ts';
import { researchCopy } from '../utils/researchCopy.ts';
import { SlipPerformancePanel } from './SlipPerformancePanel.tsx';
import { RecentActivityList } from './tickets/RecentActivityList.tsx';
import { PageHeader } from './ui/PageHeader.tsx';
import { EmptyState } from './ui/States.tsx';

interface MyActivityViewProps {
  savedTickets: SavedTicket[];
  fixtures: Fixture[];
  fixtureSnapshots: FixtureSnapshots;
  /** CAT calendar date, used for "Today"/"Yesterday" labels. */
  todayDate: string;
  /** Matchday selected in the date bar, whose group opens by default. */
  selectedDate: string;
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
 * screen that renders the full performance breakdown.
 */
export function MyActivityView({
  savedTickets,
  fixtures,
  fixtureSnapshots,
  todayDate,
  selectedDate,
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
    <section aria-label="My Performance" className="space-y-6">
      <PageHeader
        eyebrow="This Browser’s Record"
        title="My Performance"
        description={`Settlement, equity, daily, market and odds-band analysis for your saved slips. ${researchCopy.ledgerBoundary}`}
        scope="personal"
        onBack={onGoToSlate}
      />

      {savedTickets.length === 0 ? (
        <EmptyState
          title="No activity to show yet"
          description="Save an accumulator slip on today’s fixture board and your settlement record, ROI and recent activity will appear here."
          action={
            <button
              type="button"
              onClick={onGoToSlate}
              className="px-4 py-2 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors cursor-pointer"
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
            selectedDate={selectedDate}
          />

          <RecentActivityList
            rows={recent}
            total={savedTickets.length}
            todayDate={todayDate}
            selectedDate={selectedDate}
          />
        </>
      )}
    </section>
  );
}
