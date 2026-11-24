import type { AccaLeg, Fixture } from '../../types/fixtures.ts';
import {
  evaluateMarketSettlement,
  getFixtureMatchResultSummary,
} from '../../utils/accaMath.ts';
import {
  fmtCount,
  fmtFixed,
  fmtOdds,
  fmtPercent,
  fmtSignedPercent,
} from '../../utils/format.ts';
import type { TicketGuardResult } from '../../utils/ticketGuard.ts';
import { SettlementLabel } from '../SettlementLabel.tsx';
import { DataCard, InfoHint } from '../ui/DataCard.tsx';

interface RationalePanelProps {
  /** Existing guard output; no economics are recomputed or invented here. */
  guard: TicketGuardResult;
  legs: AccaLeg[];
  fixtures: Fixture[];
  strategyName: string;
  minOdds: number;
}

/** "Why this ticket" — derived entirely from guard economics and leg notes. */
export function RationalePanel({
  guard,
  legs,
  fixtures,
  strategyName,
  minOdds,
}: RationalePanelProps) {
  const { economics } = guard;
  const isFair = economics.basis === 'fair';
  const fixtureMap = new Map(fixtures.map((fixture) => [fixture.id, fixture]));

  return (
    <DataCard
      labelledBy="ticket-rationale-title"
      title="Why this ticket"
      subtitle={`${strategyName} · minimum ${fmtOdds(minOdds)} odds · ${fmtCount(legs.length)} selected legs`}
    >
      <div className="space-y-3">
        <div
          className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${
            guard.recommended
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}
        >
          <span className="font-semibold">
            {guard.recommended
              ? 'Passes the structural guard.'
              : 'Not a recommended ticket.'}
          </span>{' '}
          {guard.reason}
        </div>

        <dl className="grid gap-3 text-xs sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <dt className="font-medium text-slate-500">Price basis</dt>
            <dd className="mt-1 font-semibold text-slate-800">
              {isFair ? 'De-vigged prices' : 'Quoted prices (margin included)'}
            </dd>
            <dd className="mt-0.5 text-[11px] text-slate-500">
              Combined margin {fmtPercent((economics.combinedOverround - 1) * 100)}
            </dd>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <dt className="flex items-center font-medium text-slate-500">
              Chance vs break-even
              <InfoHint infoKey="fairProbability" />
            </dt>
            <dd className="mt-1 font-mono font-semibold text-slate-800 tabular-nums">
              {fmtPercent(economics.fairChance)} vs{' '}
              {fmtPercent(economics.breakEvenChance)}
            </dd>
            <dd className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
              Edge {fmtFixed(economics.edgePts, 1, { sign: true, suffix: ' pts' })}
            </dd>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <dt className="flex items-center font-medium text-slate-500">
              Expected return
              <InfoHint infoKey="ev" />
            </dt>
            <dd className="mt-1 font-mono font-semibold text-slate-800 tabular-nums">
              {isFair ? fmtSignedPercent(economics.expectedRoi) : '—'}
            </dd>
            <dd className="mt-0.5 text-[11px] text-slate-500">
              {isFair
                ? `At ${fmtOdds(economics.totalOdds)} combined odds`
                : 'No de-vigged price on every leg'}
            </dd>
          </div>
        </dl>

        {legs.length > 0 && (
          <ol className="list-decimal space-y-1.5 border-t border-slate-200 pt-3 pl-5 text-xs text-slate-600 marker:font-semibold marker:text-slate-400">
            {legs.map((leg, index) => {
              const fixture = fixtureMap.get(leg.fixtureId);
              const status = fixture
                ? evaluateMarketSettlement(fixture, {
                    id: leg.marketId,
                    label: leg.marketLabel,
                    marketType: leg.marketType,
                  })
                : 'Pending';
              const result = fixture
                ? getFixtureMatchResultSummary(fixture)
                : 'Scheduled';
              const note = leg.rationale?.trim();

              return (
                <li key={`${leg.fixtureId}-${leg.marketId}`} value={index + 1}>
                  <span className="font-semibold text-slate-800">
                    {leg.homeTeam} vs {leg.awayTeam} · {leg.marketLabel}:
                  </span>{' '}
                  {note || (
                    <span className="italic text-slate-400">
                      No tactical note captured.
                    </span>
                  )}{' '}
                  <span className="inline-flex items-center gap-2 whitespace-nowrap">
                    <SettlementLabel status={status} />
                    <span className="font-mono text-[11px] text-slate-500">
                      {result}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </DataCard>
  );
}
