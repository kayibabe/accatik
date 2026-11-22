import type { AccaLeg, Fixture } from '../../types/fixtures.ts';
import {
  evaluateMarketSettlement,
  getFixtureMatchResultSummary,
} from '../../utils/accaMath.ts';
import { fmtOdds, fmtPercent } from '../../utils/format.ts';
import type { SortDirection, SortState } from '../../utils/tableSort.ts';
import { SORT_ASC, sortRows } from '../../utils/tableSort.ts';
import { SettlementLabel } from '../SettlementLabel.tsx';
import { SortableTh } from '../SortableTh.tsx';
import { DataCard } from '../ui/DataCard.tsx';

interface TicketReviewLegTableProps {
  legs: AccaLeg[];
  fixtures: Fixture[];
  displayDate: string;
  legSort: SortState;
  onSort: (key: string, defaultDirection?: SortDirection) => void;
  onRestoreOrder: () => void;
}

/**
 * Read-only leg ledger for Ticket Review. Sorting changes only the view order;
 * the original ticket position is carried through and never renumbered.
 */
export function TicketReviewLegTable({
  legs,
  fixtures,
  displayDate,
  legSort,
  onSort,
  onRestoreOrder,
}: TicketReviewLegTableProps) {
  const fixtureMap = new Map(fixtures.map((fixture) => [fixture.id, fixture]));

  const settlementFor = (leg: AccaLeg) => {
    const matched = fixtureMap.get(leg.fixtureId);
    return matched
      ? evaluateMarketSettlement(matched, {
          id: leg.marketId,
          label: leg.marketLabel,
          marketType: leg.marketType,
        })
      : 'Pending';
  };

  const sortedRows = sortRows(
    legs.map((leg, index) => ({ leg, index })),
    legSort,
    {
      index: (row) => row.index,
      fixture: (row) => `${row.leg.homeTeam} ${row.leg.awayTeam}`,
      date: (row) => fixtureMap.get(row.leg.fixtureId)?.kickoffTimestamp ?? null,
      result: (row) => {
        const matched = fixtureMap.get(row.leg.fixtureId);
        return matched ? getFixtureMatchResultSummary(matched) : 'Scheduled';
      },
      selection: (row) => row.leg.marketLabel,
      odds: (row) => row.leg.odds,
      status: (row) => settlementFor(row.leg),
      rationale: (row) => row.leg.rationale,
    }
  );

  return (
    <DataCard
      labelledBy="ticket-review-leg-title"
      title="Leg-by-leg review"
      subtitle="Ticket order is preserved; sort only changes how the legs are displayed."
      actions={
        legSort.key ? (
          <button
            type="button"
            onClick={onRestoreOrder}
            className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 cursor-pointer"
          >
            Restore ticket order
          </button>
        ) : (
          <span className="text-[11px] text-slate-400">
            Click a column header to sort
          </span>
        )
      }
      bodyClassName="overflow-x-auto"
    >
      <table className="w-full min-w-[920px] border-collapse text-left text-xs">
        <caption className="sr-only">Selected accumulator legs</caption>
        <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
          <tr>
            <SortableTh
              label="#"
              columnKey="index"
              sort={legSort}
              onSort={onSort}
              className="py-3 px-4 w-12"
            />
            <SortableTh
              label="Fixture & Competition"
              columnKey="fixture"
              sort={legSort}
              onSort={onSort}
              className="py-3 px-4"
            />
            <SortableTh
              label="Date & Kickoff"
              columnKey="date"
              sort={legSort}
              onSort={onSort}
              className="py-3 px-4"
            />
            <SortableTh
              label="Match Result"
              columnKey="result"
              sort={legSort}
              onSort={onSort}
              className="py-3 px-4"
            />
            <SortableTh
              label="Selection"
              columnKey="selection"
              sort={legSort}
              onSort={onSort}
              className="py-3 px-4"
            />
            <SortableTh
              label="Odds / Prob"
              columnKey="odds"
              sort={legSort}
              onSort={onSort}
              defaultDirection="desc"
              align="right"
              className="py-3 px-4"
            />
            <SortableTh
              label="Status"
              columnKey="status"
              sort={legSort}
              onSort={onSort}
              className="py-3 px-4"
            />
            <SortableTh
              label="Tactical Justification"
              columnKey="rationale"
              sort={legSort}
              onSort={onSort}
              className="py-3 px-4"
            />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {sortedRows.map(({ leg, index }) => {
            const matched = fixtureMap.get(leg.fixtureId);
            const status = settlementFor(leg);
            const matchDate = leg.matchDate || matched?.matchDate || displayDate;
            const resultText = matched
              ? getFixtureMatchResultSummary(matched)
              : 'Scheduled';

            return (
              <tr key={leg.fixtureId} className="hover:bg-slate-50/70">
                <td className="py-3.5 px-4 font-mono text-xs text-slate-400 tabular-nums">
                  {String(index + 1).padStart(2, '0')}
                </td>
                <td className="py-3.5 px-4">
                  <p className="font-semibold text-slate-900">
                    {leg.homeTeam} vs {leg.awayTeam}
                  </p>
                  <p className="text-xs text-slate-500">{leg.competition}</p>
                </td>
                <td className="py-3.5 px-4 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                  <p className="font-semibold text-slate-800">{matchDate}</p>
                  <p>{leg.kickoffTime}</p>
                </td>
                <td className="py-3.5 px-4 font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                  {resultText}
                </td>
                <td className="py-3.5 px-4">
                  <p className="font-semibold text-emerald-800">
                    {leg.marketLabel}
                  </p>
                  <p className="text-xs text-slate-500">
                    {leg.marketType}
                    {leg.bookmaker ? ` · ${leg.bookmaker}` : ''}
                  </p>
                </td>
                <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900 tabular-nums whitespace-nowrap">
                  {fmtOdds(leg.odds)}
                  <span className="block text-[11px] font-medium text-slate-400">
                    {leg.fairProbability
                      ? fmtPercent(leg.fairProbability)
                      : '—'}
                  </span>
                </td>
                <td className="py-3.5 px-4 whitespace-nowrap">
                  <SettlementLabel status={status} />
                </td>
                <td className="py-3.5 px-4 text-xs text-slate-600 max-w-sm">
                  {leg.rationale}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </DataCard>
  );
}
