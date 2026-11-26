import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bookmark,
  Check,
  Copy,
  Lock,
  RefreshCw,
  Shuffle,
  Target,
  Unlock,
  Wand2,
  X,
} from 'lucide-react';
import type {
  AccaLeg,
  AccaStrategy,
  Fixture,
  FrameworkSlateSummary,
} from '../types/fixtures.ts';
import {
  calculatePotentialReturn,
  calculateTotalOdds,
  evaluateMarketSettlement,
  evaluateTicketSettlement,
  formatMwk,
  formatTicketForCopy,
  getFixtureMatchResultSummary,
} from '../utils/accaMath.ts';
import {
  formatLeaguePosition,
  LEAGUE_POSITION_TITLE,
} from '../utils/leaguePosition.ts';
import { noQualifiedPicksCopy } from '../utils/frameworkAvailability.ts';
import { isPreMatchFixture } from '../utils/priceQuality.ts';
import {
  TICKET_MAX_LEGS_OPTIONS,
  TICKET_STRATEGY_OPTIONS,
  TICKET_TARGET_ODDS_OPTIONS,
} from '../utils/ticketControls.ts';
import { guardTicket } from '../utils/ticketGuard.ts';
import { MATCH_METRIC_TONE } from '../utils/uiTone.ts';
import {
  TICKET_SHAPES,
  matchTicketShape,
  type TicketShape,
} from '../utils/ticketShapes.ts';
import { SettlementLabel } from './SettlementLabel.tsx';
import { MarketLabelText } from './ui/MarketLabel.tsx';

interface AccaTicketSlipProps {
  legs: AccaLeg[];
  fixtures: Fixture[];
  minOdds: number;
  maxLegs: number;
  strategy: AccaStrategy;
  displayDate: string;
  /** Matchday framework summary, used to explain an empty auto-built slip. */
  framework?: FrameworkSlateSummary;
  stake: number;
  onChangeStake: (stake: number) => void;
  onChangeStrategy: (strategy: AccaStrategy) => void;
  onChangeMinOdds: (minOdds: number) => void;
  onChangeMaxLegs: (maxLegs: number) => void;
  onApplyShape: (shape: TicketShape) => void;
  onRemoveLeg: (fixtureId: string) => void;
  onToggleLock: (fixtureId: string) => void;
  onAutoCompleteToTarget: () => void;
  onRebuildUnlocked: () => void;
  onResetRecommended: () => void;
  onTrimToRecommended: () => void;
  onClearAll: () => void;
  /** Resolves only once the slip has actually been persisted. */
  onSaveTicket: (stake: number) => Promise<boolean>;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

const STRATEGIES = TICKET_STRATEGY_OPTIONS;
const TARGET_ODDS_OPTIONS = TICKET_TARGET_ODDS_OPTIONS;
// The structural cap is now five legs; the controls are derived from it so a
// clicked leg budget is never silently rewritten.
const LEG_OPTIONS = TICKET_MAX_LEGS_OPTIONS;

export function AccaTicketSlip({
  legs,
  fixtures,
  minOdds,
  maxLegs,
  strategy,
  displayDate,
  framework,
  stake,
  onChangeStake,
  onChangeStrategy,
  onChangeMinOdds,
  onChangeMaxLegs,
  onApplyShape,
  onRemoveLeg,
  onToggleLock,
  onAutoCompleteToTarget,
  onRebuildUnlocked,
  onResetRecommended,
  onTrimToRecommended,
  onClearAll,
  onSaveTicket,
}: AccaTicketSlipProps) {
  const [copied, setCopied] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const totalOdds = calculateTotalOdds(legs);
  const guard = guardTicket(legs);
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
  const breakEvenProb = totalOdds > 1 ? 100 / totalOdds : null;
  const activeShape = matchTicketShape(strategy, minOdds, maxLegs);
  const noQualifiedCopy = noQualifiedPicksCopy(framework, fixtures);
  const startedLeg =
    legs.find((leg) => {
      const fixture = fixtureMap.get(leg.fixtureId);
      return fixture ? !isPreMatchFixture(fixture) : false;
    }) ?? null;
  const canSave = legs.length > 0 && startedLeg === null;
  const atLegCap = legs.length >= maxLegs;

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

  // Any change to the ticket invalidates a previous save confirmation.
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
          </div>
          <div className="flex items-center gap-2 text-sm">
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

        {/* Ticket shape: picks strategy, target and leg cap together */}
        <div className="space-y-1">
          <span className="text-sm font-medium text-slate-600">Ticket shape</span>
          <div className="grid grid-cols-2 gap-1">
            {TICKET_SHAPES.map((shape) => (
              <button
                key={shape.id}
                type="button"
                onClick={() => onApplyShape(shape)}
                aria-pressed={activeShape?.id === shape.id}
                title={shape.description}
                className={`px-2 py-1.5 text-xs font-medium rounded-md border text-left transition-colors cursor-pointer ${
                  activeShape?.id === shape.id
                    ? 'bg-emerald-700 border-emerald-700 text-white'
                    : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300'
                }`}
              >
                {shape.label}
              </button>
            ))}
          </div>
          <p className="text-xs leading-snug text-slate-600">
            {activeShape?.description ??
              'Custom shape. Presets keep the leg count honest, so the target cannot be reached by adding lottery legs.'}
          </p>
        </div>

        {/* Strategy & Minimum Odds Threshold */}
        <div className="space-y-2">
          <div className="space-y-1">
            <span className="text-sm font-medium text-slate-600">Strategy</span>
            <div className="flex flex-wrap items-center gap-1 p-0.5 bg-slate-100 rounded-lg">
              {STRATEGIES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onChangeStrategy(s.id)}
                  className={`px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
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
            <span className="text-sm font-medium text-slate-600">Min Odds</span>
            <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg">
              {TARGET_ODDS_OPTIONS.map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => onChangeMinOdds(val)}
                  className={`px-2.5 py-1 text-xs font-mono font-medium rounded-md transition-colors whitespace-nowrap tabular-nums cursor-pointer ${
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

          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-slate-600">Max legs</span>
            <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg">
              {LEG_OPTIONS.map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => onChangeMaxLegs(val)}
                  className={`px-2.5 py-1 text-xs font-mono font-medium rounded-md transition-colors whitespace-nowrap tabular-nums cursor-pointer ${
                    maxLegs === val
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {val}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Combined Odds & Target Qualification Strip */}
      <div className="px-4 sm:px-5 py-3.5 bg-slate-50 border-b border-slate-200">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-500">Total Acca Odds</p>
            <p className="text-2xl font-bold font-mono text-slate-900 tabular-nums">
              {totalOdds > 0 ? totalOdds.toFixed(2) : '0.00'}
            </p>
          </div>
          <div
            className="text-right"
            title={
              guard.economics.basis === 'fair'
                ? 'Chance every leg lands, with the bookmaker margin removed from each price.'
                : 'Chance every leg lands at the quoted prices (includes bookmaker margin).'
            }
          >
            <p className="text-sm font-medium text-slate-500">
              {guard.economics.basis === 'fair'
                ? 'Win Chance (fair)'
                : 'Implied Hit Prob'}
            </p>
            <p className="text-sm font-semibold font-mono text-slate-700 tabular-nums">
              {guard.economics.fairChance > 0
                ? `${guard.economics.fairChance.toFixed(1)}%`
                : '0.0%'}
            </p>
          </div>
        </div>

        {legs.length > 0 && breakEvenProb !== null && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-slate-200/80 pt-2 text-xs">
            <span className="text-slate-500">Break-even hit rate</span>
            <span className="flex items-center gap-2 font-mono tabular-nums">
              <span className="font-semibold text-slate-700">
                {breakEvenProb.toFixed(1)}%
              </span>
              <span
                className={`font-semibold ${
                  guard.economics.edgePts >= 0
                    ? 'text-emerald-700'
                    : 'text-red-600'
                }`}
                title="The system's own de-vigged win chance minus the break-even rate"
              >
                {guard.economics.edgePts >= 0 ? '+' : ''}
                {guard.economics.edgePts.toFixed(1)} pp vs fair
              </span>
            </span>
          </div>
        )}

        {legs.length > 0 && (
          <div className="mt-2 space-y-2 border-t border-slate-200/80 pt-2">
            {/* One verdict for the current shape: cap, recommendation and any trim action. */}
            <div
              role="status"
              className={`rounded-lg border px-2.5 py-2 text-xs leading-snug ${
                guard.recommended && guard.trimmedCount === 0
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-amber-300 bg-amber-50 text-amber-900'
              }`}
            >
              <p className="font-semibold">
                {guard.trimmedCount > 0
                  ? `${legs.length} legs is past the ${guard.legs.length}-leg structural cap.`
                  : guard.recommended
                    ? 'Ticket passes the structural guard.'
                    : 'Not a recommended ticket'}
              </p>
              <p className="mt-0.5">
                {guard.trimmedCount > 0
                  ? 'Every extra leg multiplies the bookmaker margin, so the added price is paid for twice: once in stake, once in lost fair value.'
                  : guard.recommended
                    ? 'Inside the structural cap and priced above fair.'
                    : (
                        <>
                          {guard.economics.basis === 'fair' && (
                            <>Expected return {guard.economics.expectedRoi.toFixed(1)}%. </>
                          )}
                          {guard.reason}
                        </>
                      )}
              </p>
              {guard.trimmedCount > 0 && (
                <button
                  type="button"
                  onClick={onTrimToRecommended}
                  className="mt-1.5 inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-md transition-colors cursor-pointer"
                >
                  Trim to {guard.legs.length} legs
                </button>
              )}
            </div>

            <div className="flex items-center justify-between gap-2">
              {meetsTarget ? (
                <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                  <Target className="w-4 h-4 shrink-0 text-slate-500" aria-hidden="true" />
                  <span>Odds target met ({minOdds.toFixed(2)}+)</span>
                </div>
              ) : (
                <>
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-700">
                    <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>
                      {atLegCap
                        ? `Below ${minOdds.toFixed(2)} — unreachable at the ${maxLegs}-leg cap`
                        : `Below ${minOdds.toFixed(2)} target`}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={onAutoCompleteToTarget}
                    disabled={atLegCap}
                    title={
                      atLegCap
                        ? `Already at the ${maxLegs}-leg structural cap. Lower the target instead of adding legs.`
                        : `Add selections (up to ${maxLegs} legs) until the target is met`
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Wand2 className="w-3 h-3" aria-hidden="true" />
                    <span>Boost to {minOdds.toFixed(2)}+</span>
                  </button>
                </>
              )}
            </div>

            {hasSettledLegs && (
              <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-200/80 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-slate-500">Ticket Status:</span>
                  <SettlementLabel status={ticketSettlement.status} />
                </div>
                <span className="font-mono text-xs text-slate-600 tabular-nums">
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
            {noQualifiedCopy ? noQualifiedCopy.headline : 'Your ticket slip is empty'}
          </p>
          <p className="text-sm text-slate-500 leading-relaxed">
            {noQualifiedCopy
              ? noQualifiedCopy.detail
              : `Click any pre-match market odd from today's fixture board or auto-build a ${minOdds.toFixed(2)}+ accumulator of up to ${maxLegs} legs.`}
          </p>
          {noQualifiedCopy ? (
            <p
              role="status"
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
            >
              Auto-build stays off until a market qualifies. Manual picks are
              unaffected.
            </p>
          ) : (
            <button
              type="button"
              onClick={onAutoCompleteToTarget}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors cursor-pointer"
            >
              <Wand2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Build {minOdds.toFixed(2)}+ Acca</span>
            </button>
          )}
        </div>
      ) : (
        <div className="divide-y divide-slate-200 max-h-[380px] overflow-y-auto">
          {legs.map((leg, index) => {
            const matchedFixture = fixtureMap.get(leg.fixtureId);
            const leaguePosition = matchedFixture
              ? formatLeaguePosition(matchedFixture)
              : null;
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
                    <p className="text-xs font-mono text-slate-600 tabular-nums">
                      {String(index + 1).padStart(2, '0')} ·{' '}
                      {dateDisplay ? `${dateDisplay} · ` : ''}
                      {leg.kickoffTime} · {leg.competition}
                      {leg.bookmaker ? ` · ${leg.bookmaker}` : ''}
                    </p>
                    <p className="text-sm font-semibold text-slate-900 truncate">
                      {leg.homeTeam} vs {leg.awayTeam}
                    </p>
                    {leaguePosition && (
                      <p
                        className={`mt-0.5 font-mono text-xs ${MATCH_METRIC_TONE.position}`}
                        title={LEAGUE_POSITION_TITLE}
                      >
                        {leaguePosition}
                      </p>
                    )}
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
                          : 'text-slate-600 hover:text-slate-700 hover:bg-slate-100'
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
                      className="p-1.5 text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="line-clamp-2 text-sm leading-snug">
                      <MarketLabelText
                        label={leg.marketLabel}
                        marketType={leg.marketType}
                      />
                    </span>
                    {matchedFixture && (
                      <SettlementLabel status={legStatus} />
                    )}
                  </div>
                  <span className="text-sm font-mono font-bold text-slate-900 tabular-nums shrink-0 text-right">
                    {leg.odds.toFixed(2)}
                    <span className="block text-xs font-medium text-slate-600">
                      {leg.fairProbability
                        ? `${leg.fairProbability.toFixed(1)}%`
                        : '—'}
                    </span>
                  </span>
                </div>
                {resultText && (
                  <p className="text-xs font-mono text-slate-600 tabular-nums">
                    Result: {resultText}
                  </p>
                )}
                <p className="text-sm text-slate-500 leading-snug">
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
          <div className="flex items-baseline justify-between gap-2">
            <label
              htmlFor="acca-stake-input"
              className="text-sm font-semibold text-slate-700 whitespace-nowrap"
            >
              Stake (MWK)
            </label>
            <span className="text-xs text-slate-600">
              Any amount · defaults to 1
            </span>
          </div>

          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-mono font-semibold text-slate-500">
              MK
            </span>
            <input
              id="acca-stake-input"
              type="number"
              inputMode="decimal"
              min={1}
              step={1}
              value={stake || ''}
              placeholder="Enter your stake"
              onChange={(e) => {
                const v = e.target.value === '' ? 0 : Number(e.target.value);
                onChangeStake(Number.isFinite(v) && v >= 0 ? v : 0);
              }}
              className="w-full h-10 pl-10 pr-3 text-sm font-mono font-semibold text-slate-900 bg-white border border-slate-200 rounded-lg tabular-nums placeholder:font-sans placeholder:font-normal placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-1 border-t border-slate-200">
          <div>
            <p className="text-sm text-slate-500">Potential Return</p>
            <p className="text-base sm:text-lg font-bold font-mono text-emerald-700 tabular-nums">
              {formatMwk(potentialReturn)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-slate-500">Net Profit</p>
            <p className="text-base sm:text-lg font-bold font-mono text-slate-900 tabular-nums">
              +{formatMwk(netProfit)}
            </p>
          </div>
        </div>

        {startedLeg && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs leading-snug text-amber-800">
            Save disabled — {startedLeg.homeTeam} vs {startedLeg.awayTeam} has
            already kicked off. Remove the started selection to save a
            pre-match slip.
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleCopy}
            disabled={legs.length === 0}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
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
            onClick={() => void handleSave()}
            disabled={!canSave || saveState === 'saving'}
            title={
              startedLeg
                ? 'This slip contains a match that has already started.'
                : 'Save this slip to your archive'
            }
            aria-live="polite"
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-semibold text-slate-800 bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            {saveState === 'saving' ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                <span>Saving…</span>
              </>
            ) : saveState === 'saved' ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                <span>Saved</span>
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
        </div>

        {legs.length > 0 && (
          <button
            type="button"
            onClick={onRebuildUnlocked}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            <Shuffle className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Rebuild Unlocked Legs ({minOdds.toFixed(2)}+)</span>
          </button>
        )}
      </div>
    </aside>
  );
}
