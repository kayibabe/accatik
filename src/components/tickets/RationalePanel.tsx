import type { AccaLeg } from '../../types/fixtures.ts';
import { fmtCount, fmtOdds, fmtPercent } from '../../utils/format.ts';
import type { TicketGuardResult } from '../../utils/ticketGuard.ts';
import { DataCard } from '../ui/DataCard.tsx';

interface RationalePanelProps {
  /** Existing guard output; no economics are recomputed or invented here. */
  guard: TicketGuardResult;
  legs: AccaLeg[];
  strategyName: string;
  minOdds: number;
}

/**
 * Explains the guard verdict. Headline odds, chance and settlement live in the
 * summary strip; per-leg prices, notes and results live in the leg ledger, so
 * this card only answers "why".
 */
export function RationalePanel({
  guard,
  legs,
  strategyName,
  minOdds,
}: RationalePanelProps) {
  const isFair = guard.economics.basis === 'fair';

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
          </span>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-600">
          <p className="font-semibold text-slate-800">Why this verdict</p>
          <p className="mt-1">{guard.reason}</p>
          <p className="mt-1 text-[11px] text-slate-500">
            {isFair
              ? `De-vigged prices, with ${fmtPercent(
                  (guard.economics.combinedOverround - 1) * 100
                )} combined bookmaker margin.`
              : 'No de-vigged price on every leg, so the chance figure still includes the bookmaker margin.'}{' '}
            Bookmaker margin compounds with every added leg, so the structural
            cap and the price are judged together.
          </p>
        </div>
      </div>
    </DataCard>
  );
}
