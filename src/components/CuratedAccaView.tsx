import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bookmark,
  Check,
  Copy,
  RefreshCw,
  Wand2,
} from 'lucide-react';
import type { AccaLeg, Fixture } from '../types/fixtures.ts';
import {
  calculatePotentialReturn,
  calculateTotalOdds,
  evaluateTicketSettlement,
  formatTicketForCopy,
} from '../utils/accaMath.ts';
import { fmtCount, fmtMwk, fmtOdds, fmtPercent } from '../utils/format.ts';
import { isPreMatchFixture } from '../utils/priceQuality.ts';
import { MAX_RECOMMENDED_LEGS, guardTicket } from '../utils/ticketGuard.ts';
import type { SortDirection, SortState } from '../utils/tableSort.ts';
import { SORT_ASC, toggleSort } from '../utils/tableSort.ts';
import { SettlementLabel } from './SettlementLabel.tsx';
import { RationalePanel } from './tickets/RationalePanel.tsx';
import { TicketReviewLegTable } from './tickets/TicketReviewLegTable.tsx';
import { InfoHint } from './ui/DataCard.tsx';
import { PageHeader } from './ui/PageHeader.tsx';
import { EmptyState, LoadingState } from './ui/States.tsx';

interface CuratedAccaViewProps {
  strategyName: string;
  strategySummary: string;
  selectedDate: string;
  displayDate: string;
  isFetchingDate: boolean;
  legs: AccaLeg[];
  fixtures: Fixture[];
  minOdds: number;
  stake: number;
  onGoToSlate: () => void;
  /** Resolves only once the slip has actually been persisted. */
  onSaveTicket: (stake: number) => Promise<boolean>;
  onAutoComplete: () => void;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

/**
 * Read-only review of the currently selected ticket. It never builds a second
 * accumulator: the only ways to change the ticket are the slate and the
 * existing auto-complete action.
 */
export function CuratedAccaView({
  strategyName,
  strategySummary,
  selectedDate,
  displayDate,
  isFetchingDate,
  legs,
  fixtures,
  minOdds,
  stake,
  onGoToSlate,
  onSaveTicket,
  onAutoComplete,
}: CuratedAccaViewProps) {
  const [copied, setCopied] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  // Ticket order is meaningful, so sorting starts switched off.
  const [legSort, setLegSort] = useState<SortState>({
    key: null,
    direction: SORT_ASC,
  });

  const totalOdds = calculateTotalOdds(legs);
  const potentialReturn = calculatePotentialReturn(stake, totalOdds);
  const fixtureMap = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const ticketSettlement = evaluateTicketSettlement(legs, fixtures, stake);
  const startedLeg =
    legs.find((leg) => {
      const fixture = fixtureMap.get(leg.fixtureId);
      return fixture ? !isPreMatchFixture(fixture) : false;
    }) ?? null;
  const canSave = legs.length > 0 && startedLeg === null;
  const isWideSlip = legs.length > MAX_RECOMMENDED_LEGS;
  const guard = guardTicket(legs, { wideResearchSlip: isWideSlip });

  const handleCopy = async () => {
    if (legs.length === 0) return;
    try {
      await navigator.clipboard.writeText(
        formatTicketForCopy(legs, stake, displayDate, fixtures)
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard restriction
    }
  };

  useEffect(() => {
    setSaveState('idle');
  }, [legs, stake]);

  useEffect(() => {
    if (saveState !== 'saved' && saveState !== 'failed') return;
    const timer = window.setTimeout(() => setSaveState('idle'), 2500);
    return () => window.clearTimeout(timer);
  }, [saveState]);

  const handleSave = async () => {
    if (!canSave || saveState === 'saving') return;
    setSaveState('saving');
    try {
      const saved = await onSaveTicket(stake);
      setSaveState(saved ? 'saved' : 'failed');
    } catch {
      setSaveState('failed');
    }
  };

  const handleSort = (
    key: string,
    defaultDirection: SortDirection = SORT_ASC
  ) => {
    setLegSort((prev) => toggleSort(prev, key, defaultDirection));
  };

  return (
    <section aria-label="Ticket Review" className="space-y-6">
      <PageHeader
        eyebrow={`Read-only ticket review · ${displayDate}`}
        title="Ticket Review"
        description={`A read-only review of the selected ${strategyName} ticket — odds, settlement and rationale only, not a second builder. Change the selection on the fixture board. ${strategySummary}`}
        scope="personal"
        meta={`${fmtCount(legs.length)} ${legs.length === 1 ? 'leg' : 'legs'} · minimum ${fmtOdds(minOdds)} odds qualification`}
      />

      {isFetchingDate && (
        <LoadingState
          label={`Loading matches and building accumulator ticket for ${selectedDate}…`}
          count={2}
        />
      )}

      {startedLeg && (
        <div
          role="status"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800"
        >
          Save disabled — {startedLeg.homeTeam} vs {startedLeg.awayTeam} has
          already kicked off. Remove the started selection to save a pre-match
          slip.
        </div>
      )}

      {isWideSlip && (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs leading-relaxed text-emerald-900"
        >
          <span className="font-semibold">
            Wide research slip — shown in full.
          </span>{' '}
          All {fmtCount(legs.length)} research picks were kept. Positive Reads and
          AI Desk additions are shown for research, not as a recommended
          accumulator; bookmaker margin compounds with each added leg.
        </div>
      )}

      {/* Quantitative Summary Strip */}
      <div className="bg-white border border-slate-200 rounded-xl grid grid-cols-2 lg:grid-cols-5 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
        <div className="p-5">
          <p className="text-xs text-slate-500">Total Acca Odds</p>
          <p className="mt-1 text-2xl font-bold font-mono text-slate-900 tabular-nums">
            {fmtOdds(totalOdds)}
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs text-slate-500">Ticket Legs</p>
          <p className="mt-1 text-2xl font-bold font-mono text-slate-900 tabular-nums">
            {fmtCount(legs.length)} Matches
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs text-slate-500">Ticket Status</p>
          <div className="mt-2">
            <SettlementLabel status={ticketSettlement.status} />
          </div>
          <p className="mt-1 text-[11px] font-mono text-slate-500 tabular-nums">
            {fmtCount(ticketSettlement.winCount)}W ·{' '}
            {fmtCount(ticketSettlement.lostCount)}L ·{' '}
            {fmtCount(ticketSettlement.voidCount)}V
          </p>
        </div>
        <div
          className="p-5"
          title={
            guard.economics.basis === 'fair'
              ? 'Chance every leg lands, with the bookmaker margin removed from each price.'
              : 'Chance every leg lands at the quoted prices (includes bookmaker margin).'
          }
        >
          <p className="flex items-center text-xs text-slate-500">
            {guard.economics.basis === 'fair'
              ? 'Combined Win Chance'
              : 'Combined Implied Prob'}
            <InfoHint infoKey="fairProbability" />
          </p>
          <p className="mt-1 text-2xl font-bold font-mono text-slate-900 tabular-nums">
            {fmtPercent(guard.economics.fairChance)}
          </p>
        </div>
        <div className="p-5 col-span-2 lg:col-span-1">
          <p className="text-xs text-slate-500">
            Est. Return ({fmtMwk(stake)} Stake)
          </p>
          <p className="mt-1 text-2xl font-bold font-mono text-emerald-700 tabular-nums">
            {fmtMwk(potentialReturn)}
          </p>
        </div>
      </div>

      <RationalePanel
        guard={guard}
        legs={legs}
        strategyName={strategyName}
        minOdds={minOdds}
      />

      {/* Leg-by-Leg Ledger */}
      {legs.length === 0 ? (
        <EmptyState
          title="No selections currently on the ticket"
          description="Generate a qualifying accumulator or build one on the fixture board. This review updates whenever the selected ticket changes."
          action={
            <button
              type="button"
              onClick={onAutoComplete}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors cursor-pointer"
            >
              <Wand2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Generate {fmtOdds(minOdds)}+ Acca</span>
            </button>
          }
        />
      ) : (
        <TicketReviewLegTable
          legs={legs}
          fixtures={fixtures}
          displayDate={displayDate}
          legSort={legSort}
          onSort={handleSort}
          onRestoreOrder={() => setLegSort({ key: null, direction: SORT_ASC })}
        />
      )}

      {/* Single primary action; copy/save stay available but demoted. */}
      <footer className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] text-slate-500">
          Review only — edits happen on the fixture board.
        </p>
        <div
          role="group"
          aria-label="Ticket review actions"
          className="flex flex-wrap items-center gap-2"
        >
          <button
            type="button"
            onClick={handleCopy}
            disabled={legs.length === 0 || isFetchingDate}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                <span>Copied Ticket</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Copy Formatted Ticket</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave || isFetchingDate || saveState === 'saving'}
            title={
              startedLeg
                ? 'This slip contains a match that has already started.'
                : 'Save this slip to your archive'
            }
            aria-live="polite"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            {saveState === 'saving' ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                <span>Saving…</span>
              </>
            ) : saveState === 'saved' ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                <span>Saved to Slips</span>
              </>
            ) : saveState === 'failed' ? (
              <>
                <AlertTriangle className="w-3.5 h-3.5 text-red-600" aria-hidden="true" />
                <span>Save failed — retry</span>
              </>
            ) : (
              <>
                <Bookmark className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Save Slip</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onGoToSlate}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            <span>Edit on Fixture Board</span>
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </footer>
    </section>
  );
}
