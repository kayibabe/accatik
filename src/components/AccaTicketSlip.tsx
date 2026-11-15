import { useState } from 'react';
import {
  AlertTriangle,
  Bookmark,
  Check,
  Copy,
  Lock,
  Shuffle,
  Unlock,
  Wand2,
  X,
} from 'lucide-react';
import type { AccaLeg, AccaStrategy, Fixture } from '../types/fixtures.ts';
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

interface AccaTicketSlipProps {
  legs: AccaLeg[];
  fixtures: Fixture[];
  minOdds: number;
  strategy: AccaStrategy;
  displayDate: string;
  stake: number;
  onChangeStake: (stake: number) => void;
  onChangeStrategy: (strategy: AccaStrategy) => void;
  onChangeMinOdds: (minOdds: number) => void;
  onRemoveLeg: (fixtureId: string) => void;
  onToggleLock: (fixtureId: string) => void;
  onAutoCompleteToTarget: () => void;
  onRebuildUnlocked: () => void;
  onResetRecommended: () => void;
  onClearAll: () => void;
  onSaveTicket: (stake: number) => void;
}

const STRATEGIES: { id: AccaStrategy; label: string }[] = [
  { id: 'balanced', label: 'Balanced' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'goals', label: 'Goals' },
  { id: 'high-yield', label: 'High-Yield' },
];

const TARGET_ODDS_OPTIONS = [5, 8, 12];
const STAKE_PRESETS = [500, 1000, 2500, 5000];

export function AccaTicketSlip({
  legs,
  fixtures,
  minOdds,
  strategy,
  displayDate,
  stake,
  onChangeStake,
  onChangeStrategy,
  onChangeMinOdds,
  onRemoveLeg,
  onToggleLock,
  onAutoCompleteToTarget,
  onRebuildUnlocked,
  onResetRecommended,
  onClearAll,
  onSaveTicket,
}: AccaTicketSlipProps) {
  const [copied, setCopied] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);

  const totalOdds = calculateTotalOdds(legs);
  const combinedProb = calculateCombinedImpliedProbability(legs);
  const potentialReturn = calculatePotentialReturn(stake, totalOdds);
  const netProfit = Math.max(0, Math.round((potentialReturn - stake) * 100) / 100);
  const meetsTarget = legs.length > 0 && totalOdds >= minOdds;
  const fixtureMap = new Map(fixtures.map((f) => [f.id, f]));
  const ticketSettlement = evaluateTicketSettlement(legs, fixtures, stake);
  const hasSettledLegs =
    ticketSettlement.winCount +
      ticketSettlement.lostCount +
      ticketSettlement.voidCount +
      ticketSettlement.liveCount >
    0;

  const handleCopy = async () => {
    if (legs.length === 0) return;
    const text = formatTicketForCopy(legs, stake, displayDate, fixtures);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback ignored if clipboard permissions restricted
    }
  };

  const handleSave = () => {
    if (legs.length === 0) return;
    onSaveTicket(stake);
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 2000);
  };

  return (
    <aside
      aria-label="Accumulator Ticket Slip"
      className="bg-white border border-slate-200 rounded-xl overflow-hidden lg:sticky lg:top-6"
    >
      {/* Ticket Header */}
      <div className="p-4 sm:p-5 border-b border-slate-200 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Accumulator Ticket
            </h2>
            <p className="text-xs text-slate-500 font-mono tabular-nums">
              {legs.length} {legs.length === 1 ? 'selection' : 'selections'} · Target{' '}
              {minOdds.toFixed(2)}+ odds
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={onResetRecommended}
              className="font-medium text-emerald-700 hover:text-emerald-800 whitespace-nowrap cursor-pointer"
            >
              Reset Pick
            </button>
            {legs.length > 0 && (
              <>
                <span className="text-slate-300" aria-hidden="true">
                  /
                </span>
                <button
                  type="button"
                  onClick={onClearAll}
                  className="font-medium text-slate-500 hover:text-red-600 whitespace-nowrap cursor-pointer"
                >
                  Clear
                </button>
              </>
            )}
          </div>
        </div>

        {/* Strategy & Minimum Odds Threshold */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-600">Strategy</span>
            <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg">
              {STRATEGIES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onChangeStrategy(s.id)}
                  className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    strategy === s.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-600">Min Odds</span>
            <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg">
              {TARGET_ODDS_OPTIONS.map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => onChangeMinOdds(val)}
                  className={`px-2.5 py-1 text-[11px] font-mono font-medium rounded-md transition-colors whitespace-nowrap tabular-nums cursor-pointer ${
                    minOdds === val
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {val.toFixed(2)}+
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Combined Odds & 5.00+ Qualification Strip */}
      <div className="px-4 sm:px-5 py-3.5 bg-slate-50 border-b border-slate-200">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-slate-500">Total Acca Odds</p>
            <p className="text-2xl font-bold font-mono text-slate-900 tabular-nums">
              {totalOdds > 0 ? totalOdds.toFixed(2) : '0.00'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium text-slate-500">Implied Hit Prob</p>
            <p className="text-sm font-semibold font-mono text-slate-700 tabular-nums">
              {combinedProb > 0 ? `${combinedProb.toFixed(1)}%` : '0.0%'}
            </p>
          </div>
        </div>

        {legs.length > 0 && (
          <div className="mt-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              {meetsTarget ? (
                <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                  <Check className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Qualifies ({minOdds.toFixed(2)}+ target met)</span>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2 w-full">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                    <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Below {minOdds.toFixed(2)} target</span>
                  </span>
                  <button
                    type="button"
                    onClick={onAutoCompleteToTarget}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Wand2 className="w-3 h-3" aria-hidden="true" />
                    <span>Boost to {minOdds.toFixed(2)}+</span>
                  </button>
                </div>
              )}
            </div>

            {hasSettledLegs && (
              <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-200/80 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-slate-500">Ticket Status:</span>
                  <SettlementLabel status={ticketSettlement.status} />
                </div>
                <span className="font-mono text-[11px] text-slate-600 tabular-nums">
                  {ticketSettlement.winCount}W · {ticketSettlement.lostCount}L ·{' '}
                  {ticketSettlement.voidCount}V
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Selections List */}
      {legs.length === 0 ? (
        <div className="p-8 text-center space-y-3">
          <p className="text-sm font-semibold text-slate-900">
            Your ticket slip is empty
          </p>
          <p className="text-xs text-slate-500 leading-relaxed">
            Click any market odd from today&apos;s fixture board or auto-build a{' '}
            {minOdds.toFixed(2)}+ odds accumulator.
          </p>
          <button
            type="button"
            onClick={onAutoCompleteToTarget}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors cursor-pointer"
          >
            <Wand2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Build {minOdds.toFixed(2)}+ Acca</span>
          </button>
        </div>
      ) : (
        <div className="divide-y divide-slate-200 max-h-[380px] overflow-y-auto">
          {legs.map((leg, index) => {
            const matchedFixture = fixtureMap.get(leg.fixtureId);
            const legStatus = matchedFixture
              ? evaluateMarketSettlement(matchedFixture, {
                  id: leg.marketId,
                  label: leg.marketLabel,
                  marketType: leg.marketType,
                })
              : 'Pending';
            const dateDisplay = leg.matchDate || matchedFixture?.matchDate;
            const resultText =
              matchedFixture &&
              (matchedFixture.status !== 'Scheduled' ||
                matchedFixture.awaitingResult)
                ? getFixtureMatchResultSummary(matchedFixture)
                : null;

            return (
              <div key={leg.fixtureId} className="p-4 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-mono text-slate-400 tabular-nums">
                      {String(index + 1).padStart(2, '0')} ·{' '}
                      {dateDisplay ? `${dateDisplay} · ` : ''}
                      {leg.kickoffTime} · {leg.competition}
                    </p>
                    <p className="text-sm font-semibold text-slate-900 truncate">
                      {leg.homeTeam} vs {leg.awayTeam}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => onToggleLock(leg.fixtureId)}
                      title={leg.locked ? 'Unlock selection' : 'Lock selection'}
                      aria-label={
                        leg.locked ? 'Unlock selection' : 'Lock selection'
                      }
                      className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                        leg.locked
                          ? 'text-emerald-700 bg-emerald-50'
                          : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {leg.locked ? (
                        <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                      ) : (
                        <Unlock className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveLeg(leg.fixtureId)}
                      title="Remove from ticket"
                      aria-label={`Remove ${leg.homeTeam} vs ${leg.awayTeam}`}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-semibold text-emerald-800 truncate">
                      {leg.marketLabel}
                    </span>
                    {matchedFixture && (
                      <SettlementLabel status={legStatus} />
                    )}
                  </div>
                  <span className="text-sm font-mono font-bold text-slate-900 tabular-nums shrink-0">
                    {leg.odds.toFixed(2)}
                  </span>
                </div>
                {resultText && (
                  <p className="text-[11px] font-mono text-slate-600 tabular-nums">
                    Result: {resultText}
                  </p>
                )}
                <p className="text-xs text-slate-500 leading-snug">
                  {leg.rationale}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Stake, Return & Ticket Actions */}
      <div className="p-4 sm:p-5 border-t border-slate-200 bg-slate-50/70 space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="acca-stake-input"
              className="text-xs font-semibold text-slate-700 whitespace-nowrap"
            >
              Stake (MWK)
            </label>
            <div className="flex items-center gap-1">
              {STAKE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => onChangeStake(preset)}
                  className={`px-2 py-0.5 text-[11px] font-mono rounded border transition-colors tabular-nums whitespace-nowrap cursor-pointer ${
                    stake === preset
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {preset.toLocaleString('en-US')}
                </button>
              ))}
            </div>
          </div>

          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono font-semibold text-slate-500">
              MK
            </span>
            <input
              id="acca-stake-input"
              type="number"
              min={50}
              step={100}
              value={stake || ''}
              onChange={(e) => {
                const v = Number(e.target.value);
                onChangeStake(Number.isFinite(v) && v >= 0 ? v : 0);
              }}
              className="w-full h-10 pl-10 pr-3 text-sm font-mono font-semibold text-slate-900 bg-white border border-slate-200 rounded-lg tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-1 border-t border-slate-200">
          <div>
            <p className="text-xs text-slate-500">Potential Return</p>
            <p className="text-base sm:text-lg font-bold font-mono text-emerald-700 tabular-nums">
              {formatMwk(potentialReturn)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">Net Profit</p>
            <p className="text-base sm:text-lg font-bold font-mono text-slate-900 tabular-nums">
              +{formatMwk(netProfit)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleCopy}
            disabled={legs.length === 0}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Copied Slip</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Copy Ticket</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={legs.length === 0}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold text-slate-800 bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            {savedFeedback ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                <span>Saved</span>
              </>
            ) : (
              <>
                <Bookmark className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Save Slip</span>
              </>
            )}
          </button>
        </div>

        {legs.length > 0 && (
          <button
            type="button"
            onClick={onRebuildUnlocked}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            <Shuffle className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Rebuild Unlocked Legs ({minOdds.toFixed(2)}+)</span>
          </button>
        )}
      </div>
    </aside>
  );
}
