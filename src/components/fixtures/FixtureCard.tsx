import type { ReactNode } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Compass,
  NotebookPen,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import type { MarketOption } from '../../types/fixtures.ts';
import type { SortDirection, SortState } from '../../utils/tableSort.ts';
import { fmtOdds, fmtPercent } from '../../utils/format.ts';
import { angleConfidence } from '../../utils/recommendedAngle.ts';
import { angleTone, frameworkTone } from '../../utils/uiTone.ts';
import { SettlementLabel } from '../SettlementLabel.tsx';
import { BriefPanel } from './BriefPanel.tsx';
import { MarketTileGrid } from './MarketTileGrid.tsx';
import {
  INSIGHT_CARD_TONES,
  type FixtureCardModel,
  type InsightTone,
} from './fixtureShared.ts';

interface FixtureCardProps {
  model: FixtureCardModel;
  pickLabel: string;
  marketChipsActive: boolean;
  marketSort: SortState;
  onMarketSort: (key: string, defaultDirection?: SortDirection) => void;
  onToggleExpanded: () => void;
  onToggleMarket: (market: MarketOption) => void;
  onRequestDeepAnalysis: () => void;
}

interface BriefToggleProps {
  isExpanded: boolean;
  onToggle: () => void;
  controls: string;
  accent?: boolean;
  className?: string;
}

function BriefToggle({
  isExpanded,
  onToggle,
  controls,
  accent = false,
  className = '',
}: BriefToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isExpanded}
      aria-controls={controls}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
        accent
          ? 'border-emerald-200 bg-white/70 text-emerald-800 hover:bg-white hover:text-emerald-900'
          : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900'
      } ${className}`}
    >
      {isExpanded ? 'Hide Brief' : 'Tactical Brief'}
      {isExpanded ? (
        <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      )}
    </button>
  );
}

function PickResultChip({
  status,
  label,
}: {
  status: FixtureCardModel['angleOutcome'];
  label: string;
}) {
  if (!status) return null;
  return <SettlementLabel status={status} prefix={label} />;
}

function InsightCard({
  tone,
  label,
  children,
  action,
}: {
  tone: InsightTone;
  label: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const theme = INSIGHT_CARD_TONES[tone];
  const Icon =
    tone === 'angle' ? Compass : tone === 'cover' ? ShieldCheck : NotebookPen;
  return (
    <div
      className={`rounded-md border border-l-2 px-2.5 py-1.5 text-[11px] leading-snug ${theme.surface}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <Icon className={`h-3 w-3 shrink-0 ${theme.iconColor}`} aria-hidden="true" />
          <span className={`font-semibold uppercase tracking-wide ${theme.labelColor}`}>
            {label}
          </span>
          {children}
        </p>
        {action}
      </div>
    </div>
  );
}

/** One match card: context, three insight cards, the brief and the market grid. */
export function FixtureCard({
  model,
  pickLabel,
  marketChipsActive,
  marketSort,
  onMarketSort,
  onToggleExpanded,
  onToggleMarket,
  onRequestDeepAnalysis,
}: FixtureCardProps) {
  const {
    fixture,
    isExpanded,
    activeLeg,
    deepAnalysis,
    isAnalyzing,
    analysisError,
    homeForm,
    awayForm,
    hasScore,
    hasHalftime,
    pickOutcome,
    resultSummary,
    angle,
    angleOutcome,
    coverOutcome,
    analystNote,
    noteBand,
    noteOutcome,
    modelEdge,
    showModelEdge,
  } = model;

  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-colors">
      <div className="space-y-3.5 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-semibold tabular-nums text-slate-800">
              {fixture.matchDate}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono font-semibold tabular-nums text-slate-700">
              {fixture.kickoffTime}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-medium text-slate-700">{fixture.competition}</span>
            <span aria-hidden="true">·</span>
            <span>{fixture.country}</span>
            {fixture.bookmakerName && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-medium text-slate-600">
                  {fixture.bookmakerName}
                </span>
              </>
            )}
            <span aria-hidden="true" className="hidden sm:inline">
              ·
            </span>
            <span className="hidden text-slate-400 sm:inline">{fixture.venue}</span>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            {showModelEdge && modelEdge && (
              <span
                className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-sky-700"
                title={`API-Football's 1X2 model has ${fmtPercent(
                  modelEdge.points,
                  1
                )} points more on ${modelEdge.side} than the de-vigged book.`}
              >
                <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
                Model +{fmtPercent(modelEdge.points, 1)} pts · {modelEdge.side}
              </span>
            )}
            {pickOutcome &&
              (fixture.status === 'Finished' || fixture.status === 'Void') && (
                <SettlementLabel
                  status={pickOutcome}
                  prefix={model.pickMarket ? pickLabel : 'Match'}
                />
              )}
            {activeLeg && (
              <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-emerald-700">
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                In Ticket @ {fmtOdds(activeLeg.odds)}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <h2 className="text-base font-semibold tracking-tight text-slate-900 sm:text-lg">
                {fixture.homeTeam}
              </h2>
              {hasScore ? (
                <span className="font-mono text-base font-bold tabular-nums text-slate-900">
                  {fixture.score?.home} - {fixture.score?.away}
                </span>
              ) : (
                <span className="text-xs font-medium text-slate-400">vs</span>
              )}
              <h2 className="text-base font-semibold tracking-tight text-slate-900 sm:text-lg">
                {fixture.awayTeam}
              </h2>
              {(fixture.status !== 'Scheduled' || fixture.awaitingResult) && (
                <span
                  className={`font-mono text-xs font-semibold tabular-nums ${
                    fixture.status === 'Void' || fixture.awaitingResult
                      ? 'text-amber-700'
                      : fixture.status === 'Live'
                      ? 'text-emerald-700'
                      : 'text-slate-700'
                  }`}
                >
                  · {resultSummary}
                  {hasHalftime
                    ? ` (HT ${fixture.score?.halftimeHome}-${fixture.score?.halftimeAway})`
                    : ''}
                </span>
              )}
            </div>
            {(homeForm !== '—' || awayForm !== '—') && (
              <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-slate-500">
                <span>Home form: {homeForm}</span>
                <span aria-hidden="true">/</span>
                <span>Away form: {awayForm}</span>
              </div>
            )}
          </div>

          {!angle && (
            <BriefToggle
              isExpanded={isExpanded}
              onToggle={onToggleExpanded}
              controls={`brief-${fixture.id}`}
              className="self-start lg:self-center"
            />
          )}
        </div>

        <p className="max-w-3xl text-sm leading-relaxed text-slate-600">
          {fixture.tacticalSummary}
        </p>

        {angle && (
          <InsightCard
            tone="angle"
            label="Recommended Angle"
            action={
              <BriefToggle
                isExpanded={isExpanded}
                onToggle={onToggleExpanded}
                controls={`brief-${fixture.id}`}
                accent
              />
            }
          >
            <span className="font-semibold text-slate-900">
              {angle.market.label}
            </span>
            <span className="font-mono font-semibold tabular-nums text-slate-700">
              @ {fmtOdds(angle.market.odds)}
            </span>
            <span
              className="font-mono text-emerald-800 tabular-nums"
              title="Margin-adjusted win probability"
            >
              {fmtPercent(angle.probability, 0)} fair
            </span>
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${angleTone(
                angle.confidence
              )}`}
            >
              {angle.confidence}
            </span>
            {fixture.framework && (
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${frameworkTone(
                  fixture.framework.status
                )}`}
                title={`Framework ${fixture.framework.status}: ${
                  fixture.framework.reasonCodes.join(', ') || 'no reason codes'
                } — ${fixture.framework.summary}`}
              >
                Framework: {fixture.framework.status.replace(/_/g, ' ')}
              </span>
            )}
            <PickResultChip status={angleOutcome} label="Angle" />
            {marketChipsActive &&
              !model.displayMarkets.some(
                (market) => market.id === angle.market.id
              ) && (
                <span
                  className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
                  title="This pick does not meet the current market, probability or price filters, so its tile is hidden from the grid below."
                >
                  Outside your market filters
                </span>
              )}
            <span className="basis-full text-slate-600">{angle.note}</span>
          </InsightCard>
        )}

        {angle?.cover && (
          <InsightCard tone="cover" label="Safer cover">
            <span className="font-medium text-slate-900">{angle.cover.label}</span>
            <span className="font-mono font-semibold tabular-nums text-slate-900">
              @ {fmtOdds(angle.cover.odds)}
            </span>
            <span className="font-mono tabular-nums text-slate-600">
              {fmtPercent(angle.coverProbability, 0)} fair
            </span>
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${angleTone(
                angleConfidence(angle.coverProbability)
              )}`}
              title="Confidence band used by the Safer Cover filter"
            >
              {angleConfidence(angle.coverProbability)}
            </span>
            <PickResultChip status={coverOutcome} label="Cover" />
          </InsightCard>
        )}

        {analystNote && (
          <InsightCard
            tone="note"
            label="Analyst note"
            action={<PickResultChip status={noteOutcome} label="Note" />}
          >
            {noteBand && (
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${angleTone(
                  noteBand
                )}`}
                title="Confidence band used by the Analyst Note filter"
              >
                {noteBand}
              </span>
            )}
            <span>{analystNote}</span>
          </InsightCard>
        )}

        {isExpanded && (
          <BriefPanel
            model={model}
            marketSort={marketSort}
            onMarketSort={onMarketSort}
            onRequestDeepAnalysis={onRequestDeepAnalysis}
          />
        )}

        <MarketTileGrid
          model={model}
          pickLabel={pickLabel}
          marketChipsActive={marketChipsActive}
          onToggleMarket={onToggleMarket}
        />

        {analysisError && !isExpanded && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{analysisError}</span>
          </div>
        )}
        {deepAnalysis && !isExpanded && (
          <p className="text-[11px] text-slate-500">
            Tactical brief loaded — expand to read the full notes and market
            ladder.
          </p>
        )}
      </div>
    </article>
  );
}
