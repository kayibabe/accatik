import { useState } from 'react';
import { ArrowRight, Check, Copy, Bookmark, Wand2 } from 'lucide-react';
import type { AccaLeg, Fixture } from '../types/fixtures.ts';
import {
  calculateCombinedImpliedProbability,
  calculatePotentialReturn,
  calculateTotalOdds,
  evaluateMarketSettlement,
  evaluateTicketSettlement,
  formatMwk,
  formatTicketForCopy,
  getFixtureMatchResultSummary,
} from '../utils/accaMath.ts';
import { SettlementLabel } from './SettlementLabel.tsx';

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
  onSaveTicket: (stake: number) => void;
  onAutoComplete: () => void;
}

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
  const [saved, setSaved] = useState(false);

  const totalOdds = calculateTotalOdds(legs);
  const combinedProb = calculateCombinedImpliedProbability(legs);
  const potentialReturn = calculatePotentialReturn(stake, totalOdds);
  const fixtureMap = new Map(fixtures.map((f) => [f.id, f]));
  const ticketSettlement = evaluateTicketSettlement(legs, fixtures, stake);

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

  const handleSave = () => {
    if (legs.length === 0) return;
    onSaveTicket(stake);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <section aria-label="Curated Winning Accumulator" className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1 max-w-2xl">
          <p className="text-xs font-medium text-slate-500">
            {displayDate} · Minimum {minOdds.toFixed(2)} Odds Qualification
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 [text-wrap:balance]">
            {strategyName}
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            {strategySummary}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleCopy}
            disabled={legs.length === 0 || isFetchingDate}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
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
            onClick={handleSave}
            disabled={legs.length === 0 || isFetchingDate}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            <Bookmark className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{saved ? 'Saved to Slips' : 'Save Slip'}</span>
          </button>

          <button
            type="button"
            onClick={onGoToSlate}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-slate-700 hover:text-slate-900 transition-colors whitespace-nowrap cursor-pointer"
          >
            <span>Edit on Fixture Board</span>
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {isFetchingDate && (
        <div className="px-4 py-2.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-600">
          Loading matches and building accumulator ticket for {selectedDate}...
        </div>
      )}

      {/* Quantitative Summary Strip */}
      <div className="bg-white border border-slate-200 rounded-xl grid grid-cols-2 lg:grid-cols-5 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
        <div className="p-5">
          <p className="text-xs text-slate-500">Total Acca Odds</p>
          <p className="mt-1 text-2xl font-bold font-mono text-slate-900 tabular-nums">
            {totalOdds.toFixed(2)}
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs text-slate-500">Ticket Legs</p>
          <p className="mt-1 text-2xl font-bold font-mono text-slate-900 tabular-nums">
            {legs.length} Matches
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs text-slate-500">Ticket Status</p>
          <div className="mt-2">
            <SettlementLabel status={ticketSettlement.status} />
          </div>
          <p className="mt-1 text-[11px] font-mono text-slate-500 tabular-nums">
            {ticketSettlement.winCount}W · {ticketSettlement.lostCount}L ·{' '}
            {ticketSettlement.voidCount}V
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs text-slate-500">Combined Implied Prob</p>
          <p className="mt-1 text-2xl font-bold font-mono text-slate-900 tabular-nums">
            {combinedProb.toFixed(1)}%
          </p>
        </div>
        <div className="p-5 col-span-2 lg:col-span-1">
          <p className="text-xs text-slate-500">
            Est. Return ({formatMwk(stake)} Stake)
          </p>
          <p className="mt-1 text-2xl font-bold font-mono text-emerald-700 tabular-nums">
            {formatMwk(potentialReturn)}
          </p>
        </div>
      </div>

      {/* Leg-by-Leg Ledger Table */}
      {legs.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
          <p className="text-sm font-semibold text-slate-900">
            No selections currently on the ticket
          </p>
          <button
            type="button"
            onClick={onAutoComplete}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors cursor-pointer"
          >
            <Wand2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Generate {minOdds.toFixed(2)}+ Acca</span>
          </button>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4 w-12">#</th>
                  <th className="py-3 px-4">Fixture &amp; Competition</th>
                  <th className="py-3 px-4">Date &amp; Kickoff</th>
                  <th className="py-3 px-4">Match Result</th>
                  <th className="py-3 px-4">Selection</th>
                  <th className="py-3 px-4 text-right">Odds</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Tactical Justification</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {legs.map((leg, idx) => {
                  const matched = fixtureMap.get(leg.fixtureId);
                  const status = matched
                    ? evaluateMarketSettlement(matched, {
                        id: leg.marketId,
                        label: leg.marketLabel,
                        marketType: leg.marketType,
                      })
                    : 'Pending';
                  const matchDate = leg.matchDate || matched?.matchDate || displayDate;
                  const resultText = matched
                    ? getFixtureMatchResultSummary(matched)
                    : 'Scheduled';

                  return (
                    <tr key={leg.fixtureId} className="hover:bg-slate-50/70">
                      <td className="py-3.5 px-4 font-mono text-xs text-slate-400 tabular-nums">
                        {String(idx + 1).padStart(2, '0')}
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
                        <p className="text-xs text-slate-500">{leg.marketType}</p>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900 tabular-nums whitespace-nowrap">
                        {leg.odds.toFixed(2)}
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
          </div>
        </div>
      )}
    </section>
  );
}
