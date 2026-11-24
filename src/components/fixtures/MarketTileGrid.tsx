import { Check, TrendingUp } from 'lucide-react';
import type { MarketOption } from '../../types/fixtures.ts';
import { evaluateMarketSettlement } from '../../utils/accaMath.ts';
import { marketProbability } from '../../utils/probability.ts';
import { fmtOdds, fmtPercent } from '../../utils/format.ts';
import {
  frameworkDecisionCopy,
  frameworkStatusLabel,
} from '../../utils/frameworkCopy.ts';
import { frameworkDot } from '../../utils/uiTone.ts';
import { SettlementLabel } from '../SettlementLabel.tsx';
import {
  modelPercentFor,
  marketTypeShortLabel,
  type FixtureCardModel,
} from './fixtureShared.ts';

interface MarketTileGridProps {
  model: FixtureCardModel;
  pickLabel: string;
  marketChipsActive: boolean;
  onToggleMarket: (market: MarketOption) => void;
}

/** Probability-ranked market tiles, with framework and settlement cues. */
export function MarketTileGrid({
  model,
  pickLabel,
  marketChipsActive,
  onToggleMarket,
}: MarketTileGridProps) {
  const {
    fixture,
    displayMarkets,
    activeLeg,
    pickMarket,
    angle,
    shortestPrice,
    isPreMatch,
  } = model;

  if (displayMarkets.length === 0) {
    return (
      <p className="pt-1 text-xs text-slate-400">
        {marketChipsActive
          ? 'No markets on this match meet the current market, probability and price filters.'
          : 'Pre-match bookmaker odds are not currently published for this fixture.'}
      </p>
    );
  }

  return (
    <div className="space-y-2 pt-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
          {marketChipsActive
            ? `Markets · ${displayMarkets.length} of ${fixture.markets.length} meeting your filters`
            : 'Markets · ranked by win probability'}
        </p>
        {!marketChipsActive &&
          shortestPrice &&
          shortestPrice.id !== pickMarket?.id &&
          shortestPrice.id !== angle?.cover?.id && (
            <p
              className="inline-flex items-center gap-1 text-[11px] text-slate-400"
              title="Highest margin-adjusted win probability on this fixture — market context, not a recommendation"
            >
              <TrendingUp className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span>Shortest price</span>
              <span className="font-medium text-slate-500">
                {shortestPrice.label}
              </span>
              <span className="font-mono font-semibold tabular-nums text-slate-500">
                {fmtPercent(marketProbability(shortestPrice), 0)}
              </span>
            </p>
          )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {displayMarkets.map((market) => {
          const isSelected = activeLeg?.marketId === market.id;
          const isRecommended = market.id === pickMarket?.id;
          const probability = marketProbability(market);
          const modelPct = modelPercentFor(market, fixture.modelProbabilities);
          const marketOutcome =
            fixture.status === 'Finished' || fixture.status === 'Void'
              ? evaluateMarketSettlement(fixture, market)
              : null;
          const unselectedTone =
            marketOutcome === 'Win'
              ? 'border-emerald-200 bg-emerald-50/70 text-slate-900 hover:border-emerald-300 hover:bg-emerald-50'
              : marketOutcome === 'Lost'
              ? 'border-red-200/80 bg-red-50/45 text-slate-900 hover:border-red-300 hover:bg-red-50/70'
              : marketOutcome === 'Void'
              ? 'border-amber-200 bg-amber-50/60 text-slate-900 hover:bg-amber-50'
              : 'border-slate-200 bg-slate-50 text-slate-900 hover:border-slate-300 hover:bg-white';

          return (
            <button
              key={market.id}
              type="button"
              onClick={() => onToggleMarket(market)}
              disabled={!isPreMatch}
              aria-pressed={isSelected}
              title={[
                !isPreMatch
                  ? 'Kickoff has passed — this price is no longer available for a new bet.'
                  : null,
                market.rationale,
                modelPct !== null
                  ? `API-Football model: ${fmtPercent(modelPct)}`
                  : null,
                market.bookmaker,
                market.framework
                  ? frameworkDecisionCopy(
                      market.framework.status,
                      market.framework.reasonCodes
                    )
                  : null,
              ]
                .filter(Boolean)
                .join(' — ')}
              className={`group flex min-h-[60px] flex-col justify-between rounded-lg border p-2.5 text-left transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-700 ${
                isSelected
                  ? 'border-emerald-700 bg-emerald-700 text-white'
                  : unselectedTone
              }`}
            >
              <div className="flex w-full items-center justify-between gap-1">
                <span
                  className={`inline-flex min-w-0 items-center gap-1 text-[11px] font-medium ${
                    isSelected ? 'text-emerald-100' : 'text-slate-500'
                  }`}
                >
                  {isSelected && (
                    <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
                  )}
                  <span className="truncate">
                    {marketTypeShortLabel(market.marketType)}
                  </span>
                  {market.framework && (
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${frameworkDot(
                        market.framework.status
                      )}`}
                      title={frameworkStatusLabel(market.framework.status)}
                      aria-hidden="true"
                    />
                  )}
                </span>
                {marketOutcome ? (
                  <SettlementLabel status={marketOutcome} inverted={isSelected} />
                ) : (
                  isRecommended && (
                    <span
                      className={`whitespace-nowrap text-[11px] font-semibold ${
                        isSelected ? 'text-white' : 'text-emerald-700'
                      }`}
                    >
                      {pickLabel}
                    </span>
                  )
                )}
              </div>
              <div className="mt-1 flex w-full items-end justify-between gap-1.5">
                <span className="truncate text-xs font-medium">{market.label}</span>
                <span className="shrink-0 text-right leading-tight">
                  <span
                    className={`block text-sm font-mono font-semibold tabular-nums ${
                      isSelected ? 'text-white' : 'text-slate-900'
                    }`}
                  >
                    {fmtOdds(market.odds)}
                  </span>
                  <span
                    className={`block text-[10px] font-mono tabular-nums ${
                      isSelected
                        ? 'text-emerald-100'
                        : probability >= 70
                        ? 'font-semibold text-emerald-700'
                        : 'text-slate-400'
                    }`}
                    title="Margin-adjusted win probability"
                  >
                    {fmtPercent(probability, 0)}
                  </span>
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
