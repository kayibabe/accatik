import type { AccaLeg, Fixture } from '../../types/fixtures.ts';
import {
  evaluateMarketSettlement,
  getFixtureMatchResultSummary,
} from '../../utils/accaMath.ts';
import { fmtOdds, fmtPercent } from '../../utils/format.ts';
import type { SortDirection, SortState } from '../../utils/tableSort.ts';
import { SORT_ASC, sortRows } from '../../utils/tableSort.ts';
import { SettlementLabel } from '../SettlementLabel.tsx';
import { MarketLabelText } from '../ui/MarketLabel.tsx';
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
 * Wide screens get the full ledger table; narrower screens get stacked cards
 * so the review never needs horizontal scrolling.
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

  const rows = sortedRows.map(({ leg, index }) => {
    const matched = fixtureMap.get(leg.fixtureId);
    return {
      leg,
      index,
      status: settlementFor(leg),
      matchDate: leg.matchDate || matched?.matchDate || displayDate,
      resultText: matched
        ? getFixtureMatchResultSummary(matched)
        : 'Scheduled',
    };
  });

  return (
    <DataCard
      labelledBy="ticket-review-leg-title"
      title="Leg-by-leg review"
      subtitle="Ticket order is preserved; sort only changes how the legs are displayed."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-500 xl:hidden">
            Sort
            <select
              aria-label="Sort legs"
              value={legSort.key ?? 'index'}
              onChange={(event) =>
                event.target.value === 'index'
                  ? onRestoreOrder()
                  : onSort(event.target.value)
              }
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 cursor-pointer"
            >
              <option value="index">Ticket order</option>
              <option value="fixture">Fixture</option>
              <option value="date">Kickoff</option>
              <option value="result">Result</option>
              <option value="selection">Selection</option>
              <option value="odds">Odds</option>
              <option value="status">Status</option>
              <option value="rationale">Justification</option>
            </select>
          </label>
          {legSort.key ? (
            <button
              type="button"
              onClick={onRestoreOrder}
              className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 cursor-pointer"
            >
              Restore ticket order
            </button>
          ) : (
            <span className="hidden text-xs text-slate-600 xl:inline">
              Click a column header to sort
            </span>
          )}
        </div>
      }
      bodyClassName="px-4 py-4"
    >
      {/* Narrow screens: one card per leg, no sideways scrolling. */}
      <div className="space-y-3 xl:hidden">
        {rows.map(({ leg, index, status, matchDate, resultText }) => (
          <article
            key={leg.fixtureId}
            className="space-y-2 rounded-lg border border-slate-200 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-slate-600">
                #{String(index + 1).padStart(2, '0')}
              </span>
              <SettlementLabel status={status} />
            </div>
            <div>
              <p className="font-semibold text-slate-900">
                {leg.homeTeam} vs {leg.awayTeam}
              </p>
              <p className="text-xs text-slate-500">{leg.competition}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="block text-slate-500">Selection</span>
                <MarketLabelText
                  label={leg.marketLabel}
                  marketType={leg.marketType}
                />
              </div>
              <div>
                <span className="block text-slate-500">Odds / Prob</span>
                <span className="font-mono font-bold text-slate-900">
                  {fmtOdds(leg.odds)}
                </span>
                <span className="block font-mono text-slate-600">
                  {leg.fairProbability
                    ? fmtPercent(leg.fairProbability)
                    : '—'}
                </span>
              </div>
              <div>
                <span className="block text-slate-500">Date & Kickoff</span>
                <span className="font-mono text-slate-700">{matchDate}</span>
                <span className="block font-mono text-slate-500">
                  {leg.kickoffTime}
                </span>
              </div>
              <div>
                <span className="block text-slate-500">Match Result</span>
                <span className="font-mono text-slate-700">{resultText}</span>
              </div>
            </div>
            {leg.rationale && (
              <p className="border-t border-slate-100 pt-2 text-xs text-slate-600">
                {leg.rationale}
              </p>
            )}
          </article>
        ))}
      </div>

      {/* Wide screens: the full sortable ledger. */}
      <div className="hidden xl:block">
        <table className="w-full min-w-[920px] border-collapse text-left text-sm">
          <caption className="sr-only">Selected accumulator legs</caption>
          <thead className="border-b border-slate-200 bg-slate-50 text-sm font-semibold text-slate-600">
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
            {rows.map(({ leg, index, status, matchDate, resultText }) => (
              <tr key={leg.fixtureId} className="hover:bg-slate-50/70">
                <td className="py-3.5 px-4 font-mono text-sm text-slate-600 tabular-nums">
                  {String(index + 1).padStart(2, '0')}
                </td>
                <td className="py-3.5 px-4">
                  <p className="font-semibold text-slate-900">
                    {leg.homeTeam} vs {leg.awayTeam}
                  </p>
                  <p className="text-sm text-slate-500">{leg.competition}</p>
                </td>
                <td className="py-3.5 px-4 font-mono text-sm text-slate-600 tabular-nums whitespace-nowrap">
                  <p className="font-semibold text-slate-800">{matchDate}</p>
                  <p>{leg.kickoffTime}</p>
                </td>
                <td className="py-3.5 px-4 font-mono text-sm text-slate-700 tabular-nums whitespace-nowrap">
                  {resultText}
                </td>
                <td className="py-3.5 px-4">
                  <p>
                    <MarketLabelText
                      label={leg.marketLabel}
                      marketType={leg.marketType}
                    />
                  </p>
                  <p className="text-sm text-slate-500">
                    {leg.marketType}
                    {leg.bookmaker ? ` · ${leg.bookmaker}` : ''}
                  </p>
                </td>
                <td className="py-3.5 px-4 text-left font-mono font-bold text-slate-900 tabular-nums whitespace-nowrap">
                  {fmtOdds(leg.odds)}
                  <span className="block text-xs font-medium text-slate-600">
                    {leg.fairProbability
                      ? fmtPercent(leg.fairProbability)
                      : '—'}
                  </span>
                </td>
                <td className="py-3.5 px-4 whitespace-nowrap">
                  <SettlementLabel status={status} />
                </td>
                <td className="py-3.5 px-4 text-sm text-slate-600 max-w-sm">
                  {leg.rationale}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DataCard>
  );
}
