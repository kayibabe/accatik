import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, X } from 'lucide-react';
import type {
  AccaLeg,
  AccaStrategy,
  Fixture,
  SettlementStatus,
  TicketGuardSummary,
} from '../types/fixtures.ts';
import {
  evaluateMarketSettlement,
  getFixtureMatchResultSummary,
} from '../utils/accaMath.ts';
import {
  buildPickSelection,
  GRADE_PLAN,
  guardEconomics,
  type PickCandidate,
} from '../utils/pickSelection.ts';
import { fmtFixed, fmtOdds, fmtPercent, fmtSignedPercent } from '../utils/format.ts';
import {
  formatLeaguePosition,
  LEAGUE_POSITION_TITLE,
} from '../utils/leaguePosition.ts';
import { formatXg, getXgDisplay, xgTitle } from '../utils/modelXg.ts';
import {
  makeSortHandler,
  sortRows,
  SORT_ASC,
  SORT_DESC,
  type SortAccessors,
  type SortState,
} from '../utils/tableSort.ts';
import {
  angleTone,
  frameworkTone,
  MATCH_METRIC_TONE,
} from '../utils/uiTone.ts';
import { SettlementLabel } from './SettlementLabel.tsx';
import { SortableTh } from './SortableTh.tsx';
import { DataCard, InfoHint } from './ui/DataCard.tsx';
import { MarketLabelText } from './ui/MarketLabel.tsx';
import { DataTable, type DataTableColumn } from './ui/DataTable.tsx';
import { PageHeader } from './ui/PageHeader.tsx';
import { EmptyState } from './ui/States.tsx';

interface PickGuideViewProps {
  fixtures: Fixture[];
  strategy: AccaStrategy;
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

const MATCH_RESULT_SORT_RANK: Record<Fixture['status'], number> = {
  Finished: 4,
  Live: 3,
  Void: 2,
  Scheduled: 1,
};

interface MatchResultInfo {
  label: string;
  note: string;
  title: string;
  rank: number;
}

/** Compact result-cell copy; the full feed summary stays in the hover title. */
function matchResultInfo(fixture: Fixture | undefined): MatchResultInfo {
  if (!fixture) {
    return { label: '—', note: 'No fixture data', title: 'No fixture data', rank: 0 };
  }
  const title = getFixtureMatchResultSummary(fixture);
  const rank = MATCH_RESULT_SORT_RANK[fixture.status];
  const home = fixture.score?.home;
  const away = fixture.score?.away;
  const hasScore = typeof home === 'number' && typeof away === 'number';

  if (fixture.status === 'Void') {
    return { label: 'Void', note: 'Match void', title, rank };
  }
  if (!hasScore) {
    return {
      label: fixture.status === 'Live' ? 'Live' : '—',
      note: fixture.awaitingResult ? 'Score unconfirmed' : fixture.status,
      title,
      rank,
    };
  }
  if (fixture.status === 'Live') {
    return { label: `${home} - ${away}`, note: 'Live score', title, rank };
  }
  return {
    label: `${home} - ${away}`,
    note: home > away ? 'Home win' : home < away ? 'Away win' : 'Draw',
    title,
    rank,
  };
}

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

/**
 * One economics summary for the view: the candidate shortlist leads, and the
 * slate's live ticket is a comparison line rather than a second four-cell panel
 * repeating the same four metrics.
 */
function EconomicsSummary({
  shortlist,
  slate,
}: {
  shortlist: TicketGuardSummary;
  slate?: TicketGuardSummary;
}) {
  const economics = guardEconomics(shortlist);
  const rows = [
    {
      key: 'fair',
      label: 'Fair chance',
      infoKey: 'fairProbability',
      value: (guard: TicketGuardSummary) =>
        fmtPercent(guardEconomics(guard).fairChance),
    },
    {
      key: 'breakEven',
      label: 'Break-even chance',
      infoKey: undefined,
      value: (guard: TicketGuardSummary) =>
        fmtPercent(guardEconomics(guard).breakEvenChance),
    },
    {
      key: 'edge',
      label: 'Ticket edge (pp)',
      infoKey: 'ticketEdge',
      value: (guard: TicketGuardSummary) =>
        fmtFixed(guardEconomics(guard).edgePts, 1, { sign: true }),
    },
    {
      key: 'ev',
      label: 'EV %',
      infoKey: 'ticketEv',
      value: (guard: TicketGuardSummary) =>
        fmtSignedPercent(guardEconomics(guard).expectedRoi, 1),
    },
  ];

  return (
    <DataCard
      title="Ticket guard economics"
      subtitle="Candidate shortlist · slate ticket shown below each measure where available"
    >
      <div className="grid grid-cols-2 gap-3">
        {rows.map((row) => (
          <div key={row.key} className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="flex items-center text-xs font-semibold uppercase tracking-wide text-slate-500">
              {row.label}
              {row.infoKey && <InfoHint infoKey={row.infoKey} />}
            </p>
            <p
              className={`mt-1 font-mono text-lg font-bold tabular-nums ${
                row.key === 'edge'
                  ? economics.edgePts > 0
                    ? 'text-emerald-700'
                    : 'text-red-600'
                  : 'text-slate-900'
              }`}
            >
              {row.value(shortlist)}
            </p>
            {slate && (
              <p className="mt-1 border-t border-slate-200 pt-1 text-xs text-slate-600">
                Live ticket:{' '}
                <span className="font-mono font-semibold tabular-nums">
                  {row.value(slate)}
                </span>
              </p>
            )}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-slate-600">
        Basis: <span className="font-semibold">{economics.basis}</span>.{' '}
        {economics.recommended
          ? 'The guard allows the “recommended” label on the shortlist.'
          : 'Recommendation withheld on the shortlist.'}{' '}
        {shortlist.reason}
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
      result: (candidate) =>
        matchResultInfo(fixtureById.get(candidate.fixtureId)).rank,
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
      cell: (candidate) => {
        const fixture = fixtureById.get(candidate.fixtureId);
        const xg = fixture ? getXgDisplay(fixture) : null;
        const leaguePosition = fixture ? formatLeaguePosition(fixture) : null;
        return (
          <div className="min-w-0">
            <p className="font-semibold text-slate-900">
              {candidate.homeTeam} <span className="font-normal text-slate-600">vs</span>{' '}
              {candidate.awayTeam}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {candidate.competition} · {candidate.kickoffTime}
            </p>
            {leaguePosition && (
              <p
                className={`mt-0.5 font-mono text-xs ${MATCH_METRIC_TONE.position}`}
                title={LEAGUE_POSITION_TITLE}
              >
                {leaguePosition}
              </p>
            )}
            {xg && (
              <p
                className={`mt-0.5 font-mono text-xs ${MATCH_METRIC_TONE.xg}`}
                title={xgTitle(xg)}
              >
                {formatXg(xg)}
              </p>
            )}
          </div>
        );
      },
      priority: 'primary',
    },
    {
      key: 'angle',
      header: sortHeader('Recommended angle', 'angle'),
      cell: (candidate) => (
        <div>
          <p>
            <MarketLabelText
              label={candidate.market.label}
              marketType={candidate.market.marketType}
            />
          </p>
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
          className={`inline-flex rounded border px-1.5 py-0.5 text-xs font-semibold ${angleTone(
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
          className={`inline-flex rounded border px-1.5 py-0.5 text-xs font-semibold ${frameworkTone(
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
      key: 'result',
      header: sortHeader('Match Results', 'result', SORT_DESC),
      cell: (candidate) => {
        const result = matchResultInfo(fixtureById.get(candidate.fixtureId));
        return (
          <div className="min-w-0" title={result.title}>
            <span className="font-mono font-semibold tabular-nums text-slate-900">
              {result.label}
            </span>
            <p className="mt-0.5 text-xs text-slate-500">{result.note}</p>
          </div>
        );
      },
      priority: 'primary',
    },
    {
      key: 'value',
      header: sortHeader('Model edge (pp) / EV % / stress', 'value', SORT_DESC),
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
      minWidth="min-w-[1060px]"
      details={(candidate) => {
        const failed = candidate.checks.filter((check) => !check.passed);
        return (
          <div className="space-y-2">
            {/* The full five-check legend lives in the Hard filters card above;
                a row only needs to show why it was rejected. */}
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {failed.length === 0
                ? 'All five hard filters pass'
                : `${failed.length} hard filter${failed.length === 1 ? '' : 's'} failed`}
            </p>
            {failed.length > 0 && (
              <ul className="grid gap-1 sm:grid-cols-2">
                {failed.map((check) => (
                  <li key={check.id} className="flex items-start gap-2 text-xs">
                    <FilterMark passed={false} />
                    <span className="text-slate-700">
                      <span className="font-medium">{check.label}</span>
                      <span className="ml-1 text-slate-500">— {check.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      }}
    />
  );
}

/** Signed-in Build tab that turns the selection rules into a repeatable audit. */
export function PickGuideView({
  fixtures,
  strategy,
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
        eyebrow="Framework check"
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
                  className={`rounded border px-1.5 py-0.5 text-xs font-semibold ${angleTone(
                    grade
                  )}`}
                >
                  {grade}
                </span>
                <span className="font-mono text-sm font-semibold tabular-nums text-slate-500">
                  {count} {count === 1 ? 'card' : 'cards'}
                </span>
              </div>
              <p className="mt-2 font-mono text-sm font-semibold text-slate-900">
                {plan.band}
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-800">
                {plan.role} <span className="font-normal text-slate-600">· {plan.slot}</span>
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
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
              <li key={check.id} className="flex items-start gap-2 text-sm">
                <FilterMark passed={check.passed} />
                <span>
                  <span className="font-semibold text-slate-900">{check.label}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                    {check.detail}
                  </span>
                </span>
              </li>
            )) ?? (
              <li className="text-sm text-slate-500">
                No priced Recommended Angle card on this slate yet.
              </li>
            )}
          </ul>
          <p className="mt-3 border-t border-slate-200 pt-3 text-xs leading-relaxed text-slate-600">
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
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-800">
                Framework decisions are attached when a slate is fetched. If
                every card shows “no decision”, refresh the slate from the
                Matchday Slate tab — archived price files do not carry them.
              </p>
            )}
        </DataCard>

        <div className="space-y-4">
          <EconomicsSummary shortlist={shortlistGuard} slate={slateGuard} />
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5">
            <p className="flex items-start gap-2 text-sm leading-relaxed text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                A ticket is recommended only when its fair chance clears
                break-even and it stays inside the leg cap. Fair prices here come
                from the captured book, so a missing recommendation means value
                could not be independently verified — not that the legs are safe.
                Treat it as a no-bet signal.
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
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 cursor-pointer"
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
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 cursor-pointer"
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

      <p className="text-xs leading-relaxed text-slate-600">
        Grades use the Recommended Angle&apos;s fair chance; framework confidence is
        a separate evidence measure and must still clear its own gate.
      </p>
    </section>
  );
}
