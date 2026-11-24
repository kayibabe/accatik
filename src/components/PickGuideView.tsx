import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, X } from 'lucide-react';
import type {
  AccaLeg,
  AccaStrategy,
  Fixture,
  SettlementStatus,
  TicketGuardSummary,
} from '../types/fixtures.ts';
import { evaluateMarketSettlement } from '../utils/accaMath.ts';
import {
  buildPickSelection,
  GRADE_PLAN,
  guardEconomics,
  type PickCandidate,
} from '../utils/pickSelection.ts';
import { fmtFixed, fmtOdds, fmtPercent, fmtSignedPercent } from '../utils/format.ts';
import {
  makeSortHandler,
  sortRows,
  SORT_ASC,
  SORT_DESC,
  type SortAccessors,
  type SortState,
} from '../utils/tableSort.ts';
import { angleTone, frameworkTone } from '../utils/uiTone.ts';
import { SettlementLabel } from './SettlementLabel.tsx';
import { SortableTh } from './SortableTh.tsx';
import { DataCard, InfoHint } from './ui/DataCard.tsx';
import { DataTable, type DataTableColumn } from './ui/DataTable.tsx';
import { PageHeader } from './ui/PageHeader.tsx';
import { EmptyState } from './ui/States.tsx';

interface PickGuideViewProps {
  fixtures: Fixture[];
  strategy: AccaStrategy;
  displayDate: string;
  cachedAt: string;
  slateGuard?: TicketGuardSummary;
  onGoToSlate: () => void;
  onApplyLegs: (legs: AccaLeg[]) => void;
}

function FilterMark({ passed }: { passed: boolean }) {
  return passed ? (
    <Check className="h-3.5 w-3.5 text-emerald-700" aria-label="Passed" />
  ) : (
    <X className="h-3.5 w-3.5 text-red-600" aria-label="Failed" />
  );
}

const GRADE_SORT_RANK: Record<PickCandidate['grade'], number> = {
  High: 4,
  Solid: 3,
  Moderate: 2,
  Speculative: 1,
};

const FRAMEWORK_SORT_RANK: Record<string, number> = {
  QUALIFIED: 6,
  CONDITIONAL_REVIEW: 5,
  SCREEN_ONLY: 4,
  INSUFFICIENT_DATA: 3,
  REJECTED: 2,
  NO_DECISION: 1,
};

const SETTLEMENT_SORT_RANK: Record<SettlementStatus, number> = {
  Win: 5,
  Live: 4,
  Pending: 3,
  Void: 2,
  Lost: 1,
};

type DecisionKind = 'use' | 'hold' | 'idle' | 'reject';

const DECISION_CLASS: Record<DecisionKind, string> = {
  use: 'font-semibold text-emerald-800',
  hold: 'text-amber-800',
  idle: 'text-slate-600',
  reject: 'text-red-700',
};

function decisionFor(
  candidate: PickCandidate,
  selectedIds: Set<string>,
  heldReason: Map<string, string>
): { kind: DecisionKind; rank: number; label: string; detail?: string } {
  if (selectedIds.has(candidate.fixtureId)) {
    return {
      kind: 'use',
      rank: 4,
      label: `Use · leg ${candidate.selectedSlot ?? ''} (${candidate.role.toLowerCase()})`,
    };
  }
  const held = heldReason.get(candidate.fixtureId);
  if (held) return { kind: 'hold', rank: 3, label: `Hold · ${held}` };
  if (!candidate.eligible) {
    return {
      kind: 'reject',
      rank: 1,
      label: `Reject · ${candidate.rejectionReasons[0]}`,
      detail: candidate.rejectionReasons.join('; '),
    };
  }
  return { kind: 'idle', rank: 2, label: 'Not in this shape' };
}

function EconomicsPanel({
  title,
  subtitle,
  guard,
}: {
  title: string;
  subtitle: string;
  guard: TicketGuardSummary;
}) {
  const economics = guardEconomics(guard);
  const cells = [
    {
      label: 'Fair chance',
      value: fmtPercent(economics.fairChance),
      infoKey: 'fairProbability',
    },
    {
      label: 'Break-even chance',
      value: fmtPercent(economics.breakEvenChance),
      infoKey: undefined,
    },
    {
      label: 'edgePts',
      value: fmtFixed(economics.edgePts, 1, { sign: true }),
      infoKey: undefined,
    },
    {
      label: 'Expected ROI',
      value: fmtSignedPercent(economics.expectedRoi, 1),
      infoKey: 'roi',
    },
  ];

  return (
    <DataCard title={title} subtitle={subtitle}>
      <div className="grid grid-cols-2 gap-3">
        {cells.map((cell) => (
          <div key={cell.label} className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="flex items-center text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {cell.label}
              {cell.infoKey && <InfoHint infoKey={cell.infoKey} />}
            </p>
            <p
              className={`mt-1 font-mono text-lg font-bold tabular-nums ${
                cell.label === 'edgePts'
                  ? economics.edgePts > 0
                    ? 'text-emerald-700'
                    : 'text-red-600'
                  : 'text-slate-900'
              }`}
            >
              {cell.value}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
        Basis: <span className="font-semibold">{economics.basis}</span>.{' '}
        {economics.recommended
          ? 'The guard allows the “recommended” label on this shape.'
          : 'Recommendation withheld.'}{' '}
        {guard.reason}
      </p>
    </DataCard>
  );
}

function CandidateTable({
  candidates,
  fixtures,
  shortlist,
  held,
}: {
  candidates: PickCandidate[];
  fixtures: Fixture[];
  shortlist: PickCandidate[];
  held: ReturnType<typeof buildPickSelection>['held'];
}) {
  const selectedIds = useMemo(
    () => new Set(shortlist.map((candidate) => candidate.fixtureId)),
    [shortlist]
  );
  const heldReason = useMemo(
    () => new Map(held.map((entry) => [entry.fixtureId, entry.reason])),
    [held]
  );
  const fixtureById = useMemo(
    () => new Map(fixtures.map((fixture) => [fixture.id, fixture])),
    [fixtures]
  );
  const statusFor = useCallback(
    (candidate: PickCandidate): SettlementStatus => {
      const fixture = fixtureById.get(candidate.fixtureId);
      return fixture ? evaluateMarketSettlement(fixture, candidate.market) : 'Pending';
    },
    [fixtureById]
  );
  const [sort, setSort] = useState<SortState>({ key: null, direction: SORT_ASC });
  const onSort = makeSortHandler(setSort);
  const accessors = useMemo<SortAccessors<PickCandidate>>(
    () => ({
      fixture: (candidate) => `${candidate.homeTeam} vs ${candidate.awayTeam}`,
      angle: (candidate) => candidate.market.label,
      grade: (candidate) => GRADE_SORT_RANK[candidate.grade],
      framework: (candidate) =>
        FRAMEWORK_SORT_RANK[candidate.frameworkStatus ?? 'NO_DECISION'],
      status: (candidate) => SETTLEMENT_SORT_RANK[statusFor(candidate)],
      value: (candidate) => candidate.edgePts,
      decision: (candidate) => decisionFor(candidate, selectedIds, heldReason).rank,
    }),
    [selectedIds, heldReason, statusFor]
  );
  const rows = useMemo(
    () => sortRows(candidates, sort, accessors),
    [candidates, sort, accessors]
  );

  const sortHeader = (label: string, columnKey: string, defaultDirection = SORT_ASC) => (
    <SortableTh
      bare
      label={label}
      columnKey={columnKey}
      sort={sort}
      onSort={onSort}
      defaultDirection={defaultDirection}
      className="font-semibold"
    />
  );

  const columns: ReadonlyArray<DataTableColumn<PickCandidate>> = [
    {
      key: 'fixture',
      header: sortHeader('Fixture', 'fixture'),
      cell: (candidate) => (
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">
            {candidate.homeTeam} <span className="font-normal text-slate-400">vs</span>{' '}
            {candidate.awayTeam}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {candidate.competition} · {candidate.kickoffTime}
          </p>
        </div>
      ),
      priority: 'primary',
    },
    {
      key: 'angle',
      header: sortHeader('Recommended angle', 'angle'),
      cell: (candidate) => (
        <div>
          <p className="font-medium text-slate-900">{candidate.market.label}</p>
          <p className="mt-0.5 font-mono tabular-nums text-slate-600">
            {fmtOdds(candidate.market.odds)} · {fmtPercent(candidate.probability, 0)}{' '}
            fair
          </p>
        </div>
      ),
      priority: 'primary',
    },
    {
      key: 'grade',
      header: sortHeader('Grade', 'grade', SORT_DESC),
      cell: (candidate) => (
        <span
          className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold ${angleTone(
            candidate.grade
          )}`}
        >
          {candidate.grade} · {candidate.role}
        </span>
      ),
      priority: 'secondary',
    },
    {
      key: 'framework',
      header: sortHeader('Framework', 'framework', SORT_DESC),
      cell: (candidate) => (
        <span
          className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold ${frameworkTone(
            candidate.frameworkStatus
          )}`}
        >
          {(candidate.frameworkStatus ?? 'NO DECISION').replace(/_/g, ' ')}
        </span>
      ),
      priority: 'secondary',
    },
    {
      key: 'status',
      header: sortHeader('Match status', 'status', SORT_DESC),
      cell: (candidate) => <SettlementLabel status={statusFor(candidate)} />,
      priority: 'primary',
    },
    {
      key: 'value',
      header: sortHeader('Edge / EV / stress', 'value', SORT_DESC),
      cell: (candidate) => (
        <span className="font-mono tabular-nums text-slate-700">
          {fmtFixed(candidate.edgePts, 1, { sign: true })}pp /{' '}
          {fmtSignedPercent(candidate.ev === null ? null : candidate.ev * 100, 0)} /{' '}
          {fmtSignedPercent(
            candidate.evStress === null ? null : candidate.evStress * 100,
            0
          )}
        </span>
      ),
      priority: 'tertiary',
    },
    {
      key: 'decision',
      header: sortHeader('Decision', 'decision', SORT_DESC),
      cell: (candidate) => {
        const decision = decisionFor(candidate, selectedIds, heldReason);
        return (
          <span className={DECISION_CLASS[decision.kind]} title={decision.detail}>
            {decision.label}
          </span>
        );
      },
      priority: 'primary',
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(candidate) => candidate.fixtureId}
      caption="Recommended Angle cards graded against the pick-selection filters"
      minWidth="min-w-[940px]"
      details={(candidate) => (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Hard filters
          </p>
          <ul className="grid gap-1 sm:grid-cols-2">
            {candidate.checks.map((check) => (
              <li key={check.id} className="flex items-start gap-2 text-[11px]">
                <FilterMark passed={check.passed} />
                <span className="text-slate-700">
                  <span className="font-medium">{check.label}</span>
                  <span className="ml-1 text-slate-500">— {check.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    />
  );
}

/** Signed-in Build tab that turns the selection rules into a repeatable audit. */
export function PickGuideView({
  fixtures,
  strategy,
  displayDate,
  cachedAt,
  slateGuard,
  onGoToSlate,
  onApplyLegs,
}: PickGuideViewProps) {
  const selection = useMemo(
    () => buildPickSelection(fixtures, strategy),
    [fixtures, strategy]
  );
  const shortlistGuard: TicketGuardSummary = useMemo(
    () => ({
      recommended: selection.guard.recommended,
      reason: selection.guard.reason,
      originalLegCount: selection.guard.originalLegCount,
      trimmedCount: selection.guard.trimmedCount,
      economics: selection.guard.economics,
    }),
    [selection.guard]
  );
  const exampleCandidate =
    selection.shortlist[0] ?? selection.candidates[0] ?? null;

  return (
    <section aria-label="Pick selection guide" className="space-y-8">
      <PageHeader
        eyebrow={`${displayDate} · Framework v1.2`}
        title="How to Choose the Actual Picks"
        description="Grade each match's Recommended Angle card, then run the hard filters before a leg touches the slip. This tab audits the live slate against those rules — it does not invent a second set of picks."
        scope="personal"
        onBack={onGoToSlate}
        backLabel="Back to Matchday Slate"
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(Object.keys(GRADE_PLAN) as Array<keyof typeof GRADE_PLAN>).map((grade) => {
          const plan = GRADE_PLAN[grade];
          const count = selection.candidates.filter(
            (candidate) => candidate.grade === grade
          ).length;
          return (
            <div
              key={grade}
              className="rounded-xl border border-slate-200 bg-white px-4 py-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${angleTone(
                    grade
                  )}`}
                >
                  {grade}
                </span>
                <span className="font-mono text-xs font-semibold tabular-nums text-slate-500">
                  {count} {count === 1 ? 'card' : 'cards'}
                </span>
              </div>
              <p className="mt-2 font-mono text-xs font-semibold text-slate-900">
                {plan.band}
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-800">
                {plan.role} <span className="font-normal text-slate-400">· {plan.slot}</span>
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                {plan.guidance}
              </p>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DataCard
          title="Hard filters"
          subtitle={
            exampleCandidate
              ? `All five must pass · example: ${exampleCandidate.homeTeam} vs ${exampleCandidate.awayTeam}`
              : 'All five must pass before the angle can be a leg'
          }
        >
          <ul className="space-y-2">
            {exampleCandidate?.checks.map((check) => (
              <li key={check.id} className="flex items-start gap-2 text-xs">
                <FilterMark passed={check.passed} />
                <span>
                  <span className="font-semibold text-slate-900">{check.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">
                    {check.detail}
                  </span>
                </span>
              </li>
            )) ?? (
              <li className="text-xs text-slate-500">
                No priced Recommended Angle card on this slate yet.
              </li>
            )}
          </ul>
          <p className="mt-3 border-t border-slate-200 pt-3 text-[11px] leading-relaxed text-slate-600">
            <span className="font-semibold">Shape rules:</span> one market per
            fixture; different competitions and different teams across legs. A
            Moderate middle leg is only allowed after two High/Solid legs.
          </p>
          {selection.candidates.length > 0 &&
            selection.candidates.every(
              (candidate) =>
                candidate.frameworkStatus === null ||
                candidate.frameworkStatus === 'INSUFFICIENT_DATA'
            ) && (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-800">
                Framework decisions are attached when a slate is fetched. If
                every card shows “no decision”, refresh the slate from the
                Matchday Slate tab — archived price files do not carry them.
              </p>
            )}
        </DataCard>

        <div className="space-y-4">
          <EconomicsPanel
            title="Ticket guard · candidate shortlist"
            subtitle={`${selection.legs.length} leg${
              selection.legs.length === 1 ? '' : 's'
            } after the structural cap`}
            guard={shortlistGuard}
          />
          {slateGuard && (
            <EconomicsPanel
              title="Ticket guard · live recommended ticket"
              subtitle="The slate's own headline ticket, unchanged"
              guard={slateGuard}
            />
          )}
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5">
            <p className="flex items-start gap-2 text-xs leading-relaxed text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                If fair chance is below break-even chance, the ticket is
                negative-EV even when every leg looks “safe”. The guard&apos;s
                fair prices come from the same book, so the “recommended” label is
                effectively unreachable without an independent model. If the UI
                withholds it, believe it.
              </span>
            </p>
          </div>
        </div>
      </div>

      <DataCard
        title="Live angle audit"
        subtitle={`${selection.candidates.length} angle cards · ${selection.eligible.length} pass the hard filters · ${selection.shortlist.length} in the shortlist`}
        actions={
          selection.legs.length > 0 ? (
            <button
              type="button"
              onClick={() => onApplyLegs(selection.guard.legs)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
            >
              Review shortlist in Ticket Review
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : undefined
        }
      >
        {selection.candidates.length === 0 ? (
          <EmptyState
            title="No Recommended Angle cards on this slate"
            description="Fetch a priced slate with fixtures still scheduled, then come back to grade its cards."
            action={
              <button
                type="button"
                onClick={onGoToSlate}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
              >
                Go to Matchday Slate
              </button>
            }
          />
        ) : (
          <CandidateTable
            candidates={selection.candidates}
            fixtures={fixtures}
            shortlist={selection.shortlist}
            held={selection.held}
          />
        )}
      </DataCard>

      <p className="text-[10px] text-slate-400">
        Cached slate: <span className="font-mono">{cachedAt || 'not available'}</span>.
        Grades use the Recommended Angle&apos;s fair chance; framework confidence is
        a separate evidence measure and must still clear its own gate.
      </p>
    </section>
  );
}
