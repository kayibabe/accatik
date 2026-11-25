import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Check,
  Clipboard,
  Filter,
  Info,
  Layers3,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Ticket,
} from 'lucide-react';
import type { AccaStrategy } from '../types/fixtures.ts';
import type {
  AiAccumulatorResponse,
  AiBriefingResponse,
  AiPerformanceResponse,
  AiPick,
  AiRiskMode,
  AiTicketLeg,
} from '../types/ai.ts';
import { apiFetch } from '../utils/api.ts';
import { fmtSignedPercent, fmtUnits } from '../utils/format.ts';
import { DataCard, InfoHint, MetricCard, MetricGrid } from './ui/DataCard.tsx';
import { PageHeader } from './ui/PageHeader.tsx';
import { EmptyState, ErrorState, InlineLoading, LoadingState } from './ui/States.tsx';
import { frameworkTone, pnlTone } from '../utils/uiTone.ts';
import { aiPicksSummary } from '../utils/aiPicksSummary.ts';
import { researchCopy } from '../utils/researchCopy.ts';

interface AiViewProps {
  selectedDate: string;
  displayDate: string;
  strategy: AccaStrategy;
  minOdds: number;
  maxLegs: number;
  canApplyTicket: boolean;
  onGoToSlate: () => void;
  onApplyTicket: (legs: AiTicketLeg[]) => void;
}

const MARKET_OPTIONS = [
  { value: 'all', label: 'All markets' },
  { value: '1X2', label: '1X2 · Match result' },
  { value: 'Goals', label: 'Goals · Over / Under' },
  { value: 'BTTS', label: 'Both teams to score' },
  { value: 'Double Chance', label: 'Double chance' },
  { value: 'Draw No Bet', label: 'Draw no bet' },
];

const RISK_OPTIONS: Array<{ value: AiRiskMode; label: string }> = [
  { value: 'conservative', label: 'Conservative · high/solid only' },
  { value: 'balanced', label: 'Balanced · moderate allowed' },
  { value: 'aggressive', label: 'Wide · include speculative' },
];

const pct = (value: number, digits = 1): string => `${(value * 100).toFixed(digits)}%`;

function toLeg(pick: AiPick): AiTicketLeg {
  return {
    fixtureId: pick.fixtureId,
    marketId: pick.marketId,
    homeTeam: pick.homeTeam,
    awayTeam: pick.awayTeam,
    competition: pick.competition,
    kickoffTime: pick.kickoffTime,
    label: pick.label,
    marketType: pick.marketType,
    odds: pick.odds,
    pModel: pick.pModel,
    pStress: pick.pStress,
    aiScore: pick.aiScore,
    band: pick.band,
  };
}

/** The six numbers that decide one bet, kept together instead of scattered. */
function DecisionChain({
  pick,
  avgClv,
}: {
  pick: AiPick | null;
  avgClv: number | null;
}) {
  const calibration = pick?.calibration ?? null;
  const calibrationStatus = !calibration
    ? 'Unavailable'
    : calibration.status === 'verified'
      ? 'Verified'
      : calibration.status === 'thin'
        ? 'Thin'
        : 'Weak';
  const cells = [
    {
      key: 'price',
      label: 'Price',
      value: pick ? pick.odds.toFixed(2) : '—',
      detail: pick ? `${pick.label} @ ${pick.bookmaker ?? 'book'}` : undefined,
      tone: 'text-slate-900',
    },
    {
      key: 'fair',
      label: 'Fair price',
      value: pick && pick.pFair > 0 ? (1 / pick.pFair).toFixed(2) : '—',
      detail: pick ? `${pct(pick.pFair)} fair chance` : undefined,
      tone: 'text-slate-900',
      infoKey: 'fairProbability',
    },
    {
      key: 'ev',
      label: 'Stressed EV',
      value: pick ? pct(pick.evStress) : '—',
      detail: 'after uncertainty haircut',
      tone: pick && pick.evStress > 0 ? 'text-emerald-700' : 'text-slate-600',
      infoKey: 'ev',
    },
    {
      key: 'stake',
      label: 'Stake',
      value: pick ? pct(pick.stakePct, 2) : '—',
      detail: 'quarter-Kelly, capped at 2%',
      tone: 'text-slate-900',
      infoKey: 'stake',
    },
    {
      key: 'clv',
      label: 'Avg CLV',
      value: avgClv === null ? '—' : fmtSignedPercent(avgClv, 2),
      detail: 'settled shadow tickets',
      tone: avgClv === null ? 'text-slate-600' : pnlTone(avgClv),
      infoKey: 'clv',
    },
    {
      key: 'calibration',
      label: 'Calibration',
      value: calibrationStatus,
      detail: calibration
        ? `${calibration.settled} settled · Brier ${calibration.brier.toFixed(2)}`
        : 'no settled market history yet',
      tone: calibration?.status === 'poor' ? 'text-amber-700' : 'text-slate-900',
      infoKey: 'calibration',
    },
  ];

  return (
    <DataCard
      title="Decision chain"
      subtitle="Price → fair price → stressed EV → stake → CLV → calibration, for the top-ranked pick"
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {cells.map((cell) => (
          <div
            key={cell.key}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
          >
            <p className="flex items-center text-xs font-semibold uppercase tracking-wide text-slate-500">
              {cell.label}
              {cell.infoKey && <InfoHint infoKey={cell.infoKey} />}
            </p>
            <p className={`mt-1 font-mono text-sm font-bold tabular-nums ${cell.tone}`}>
              {cell.value}
            </p>
            {cell.detail && (
              <p className="mt-0.5 truncate text-xs text-slate-500" title={cell.detail}>
                {cell.detail}
              </p>
            )}
          </div>
        ))}
      </div>
      {!pick ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-700">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
          <span>
            <strong>No bet.</strong> No priced selection cleared the stressed-EV gate.
            Waiting for a better price or a clearer market is a valid decision.
          </span>
        </div>
      ) : (
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          CLV is measured after settlement. Calibration uses settled legs for this market;
          an empty record is shown as unavailable, never as a pass.
        </p>
      )}
    </DataCard>
  );
}

/**
 * Free AI football desk. All numbers come from the server's local ensemble;
 * an optional free-tier language model only adds short explanations.
 */
export function AiView({
  selectedDate,
  displayDate,
  strategy,
  minOdds,
  maxLegs,
  canApplyTicket,
  onGoToSlate,
  onApplyTicket,
}: AiViewProps) {
  const [marketFilter, setMarketFilter] = useState('all');
  const [competitionFilter, setCompetitionFilter] = useState('all');
  const [riskMode, setRiskMode] = useState<AiRiskMode>('balanced');
  const [minScore, setMinScore] = useState(60);
  const [briefing, setBriefing] = useState<AiBriefingResponse | null>(null);
  const [ticket, setTicket] = useState<AiAccumulatorResponse | null>(null);
  const [ticketScore, setTicketScore] = useState<number | null>(null);
  const [performance, setPerformance] = useState<AiPerformanceResponse | null>(null);
  const [performanceLoading, setPerformanceLoading] = useState(false);
  const [performanceError, setPerformanceError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<{
    scope: 'load' | 'generate';
    message: string;
  } | null>(null);
  // Rapid date/strategy/filter changes can leave older requests in flight.
  const loadRequestRef = useRef(0);
  const generateRequestRef = useRef(0);
  useEffect(
    () => () => {
      loadRequestRef.current += 1;
      generateRequestRef.current += 1;
    },
    []
  );

  const payload = useMemo(
    () => ({
      dateIso: selectedDate,
      strategy,
      marketFilter,
      competitionFilter,
      riskMode,
    }),
    [selectedDate, strategy, marketFilter, competitionFilter, riskMode]
  );

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    // A ticket built from an older briefing is no longer valid.
    generateRequestRef.current += 1;
    setBuilding(false);
    setLoading(true);
    setError(null);
    setTicket(null);
    setTicketScore(null);
    try {
      const result = await apiFetch<AiBriefingResponse>('/api/ai/briefing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (requestId !== loadRequestRef.current) return;
      setBriefing(result);
    } catch (err) {
      if (requestId !== loadRequestRef.current) return;
      setError({
        scope: 'load',
        message: err instanceof Error ? err.message : 'Could not build the AI briefing.',
      });
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [payload]);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = useCallback(async () => {
    const bar = minScore;
    const requestId = ++generateRequestRef.current;
    setBuilding(true);
    setError(null);
    try {
      const built = await apiFetch<AiAccumulatorResponse>('/api/ai/accumulator', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          minScore: bar,
          targetOdds: minOdds,
          maxLegs,
        }),
      });
      if (requestId !== generateRequestRef.current) return;
      setTicketScore(bar);
      setTicket(built);
    } catch (err) {
      if (requestId !== generateRequestRef.current) return;
      setError({
        scope: 'generate',
        message: err instanceof Error ? err.message : 'Could not build the AI accumulator.',
      });
    } finally {
      if (requestId === generateRequestRef.current) setBuilding(false);
    }
  }, [payload, minScore, minOdds, maxLegs]);

  const loadPerformance = useCallback(async () => {
    setPerformanceLoading(true);
    setPerformanceError(null);
    try {
      setPerformance(await apiFetch<AiPerformanceResponse>('/api/ai/performance'));
    } catch (err) {
      setPerformanceError(
        err instanceof Error ? err.message : 'Could not load AI Desk history.'
      );
    } finally {
      setPerformanceLoading(false);
    }
  }, []);

  const competitions = useMemo(() => {
    const names = new Set((briefing?.picks ?? []).map((pick) => pick.competition));
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [briefing]);

  const picks = useMemo(
    () => (briefing?.picks ?? []).filter((pick) => pick.aiScore >= minScore),
    [briefing, minScore]
  );

  // A ticket built under a previous score bar is stale, even if it arrived
  // after the slider moved, so it is hidden until regenerated at the new bar.
  const visibleTicket = ticket !== null && ticketScore === minScore ? ticket : null;

  const metrics = useMemo(() => {
    if (picks.length === 0) return { positiveEv: 0, avgEdge: 0, strong: 0 };
    return {
      positiveEv: picks.filter((pick) => pick.evStress > 0).length,
      avgEdge:
        picks.reduce((sum, pick) => sum + pick.edge, 0) / picks.length,
      strong: picks.filter((pick) => pick.band === 'High' || pick.band === 'Solid').length,
    };
  }, [picks]);

  const picksSummary = useMemo(
    () => aiPicksSummary(picks, displayDate, minScore),
    [picks, displayDate, minScore]
  );

  const copyTicket = async () => {
    if (!visibleTicket) return;
    const lines = [
      `ACCATIK AI DESK · ${displayDate}`,
      `${visibleTicket.legs.length} legs · ${visibleTicket.totalOdds.toFixed(2)} odds · ` +
        `${pct(visibleTicket.hitProbability)} model hit chance`,
      ...visibleTicket.legs.map(
        (leg, index) =>
          `${index + 1}. ${leg.homeTeam} v ${leg.awayTeam} — ${leg.label} @ ${leg.odds.toFixed(2)}`
      ),
      `${researchCopy.notRecommendation} ${researchCopy.verifyPrices}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section aria-label="AI football analytics" className="space-y-6">
      <PageHeader
        eyebrow="AI FOOTBALL ANALYTICS · FREE MODELS"
        title="AI Desk"
        scope="research"
        description="A free local ensemble reads the slate, analytics, ROI research, shadow ledger and provenance, then ranks today's priced selections by stressed expected value. An optional free-tier language model adds plain-English notes only."
        meta={<span className="font-mono">{displayDate} · {strategy} strategy</span>}
        actions={
          <>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh analysis
            </button>
            <button
              type="button"
              onClick={onGoToSlate}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 cursor-pointer"
            >
              Back to Today&apos;s Slate
            </button>
          </>
        }
      />

      <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">
        <ShieldAlert className="h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
        <p>
          <strong>Estimates, not certainty.</strong> No model can know a result; the accumulator
          assumes independent outcomes, so its combined hit chance is optimistic.{' '}
          {researchCopy.wideSlip}
        </p>
      </div>

      <DataCard
        title="What the models read"
        subtitle="Every source is already in your workbench — no paid feed, no extra upstream calls"
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {(briefing?.inputs ?? []).map((input) => (
            <div
              key={input.page}
              title={input.detail}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5"
            >
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                {input.page}
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-800">{input.label}</p>
              <p className="mt-0.5 font-mono text-xs text-slate-500">{input.records} records</p>
            </div>
          ))}
          {!briefing && loading && <LoadingState label="Reading workbench data…" count={6} />}
        </div>
      </DataCard>

      <DataCard
        title="Model controls"
        subtitle="Filter the market and the confidence bar before ranking picks"
        actions={
          loading ? <InlineLoading label="Recomputing…" /> : null
        }
        bodyClassName="px-4 py-3"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Market
            </span>
            <select
              value={marketFilter}
              onChange={(event) => setMarketFilter(event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
            >
              {MARKET_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Competition
            </span>
            <select
              value={competitionFilter}
              onChange={(event) => setCompetitionFilter(event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
            >
              <option value="all">All competitions</option>
              {competitions.map((competition) => (
                <option key={competition} value={competition}>{competition}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Risk mode · ticket
            </span>
            <select
              value={riskMode}
              onChange={(event) => setRiskMode(event.target.value as AiRiskMode)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
            >
              {RISK_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Min model score · {minScore}
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={minScore}
              onChange={(event) => setMinScore(Number(event.target.value))}
              className="w-full accent-emerald-700"
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => void generate()}
              disabled={building || picks.length === 0}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60 cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              {building ? 'Building…' : 'Build AI accumulator'}
            </button>
          </div>
        </div>
      </DataCard>

      <DataCard
        title="Historical performance"
        subtitle="Archived AI Desk picks graded against settled results · flat 1u stake"
        actions={
          <button
            type="button"
            onClick={() => void loadPerformance()}
            disabled={performanceLoading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${performanceLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
            {performance ? 'Refresh history' : 'Load history'}
          </button>
        }
      >
        {performanceError ? (
          <p className="text-sm text-rose-700">{performanceError}</p>
        ) : performanceLoading ? (
          <InlineLoading label="Grading archived picks…" />
        ) : !performance ? (
          <p className="text-sm text-slate-600">
            Load the archive to see hit rate and flat-stake ROI by model-score band.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              {performance.sample.dates} dates · {performance.sample.dedupedPicks} graded picks ·{' '}
              {performance.sample.settled} settled · {performance.sample.pending} pending ·{' '}
              {performance.sample.voids} void · {performance.sample.reconstructed} reconstructed
            </p>
            {performance.sample.dedupedPicks === 0 ? (
              <p className="text-sm text-slate-500">
                No AI Desk snapshots have been archived yet. Generate a briefing to start the record.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <caption className="sr-only">
                    Archived AI Desk performance by model-score band
                  </caption>
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                      <th scope="col" className="py-2 pr-3 font-semibold">Model score</th>
                      <th scope="col" className="py-2 pr-3 text-right font-semibold">Settled</th>
                      <th scope="col" className="py-2 pr-3 text-right font-semibold">Hit rate</th>
                      <th scope="col" className="py-2 pr-3 text-right font-semibold">ROI</th>
                      <th scope="col" className="py-2 pr-3 text-right font-semibold">Profit</th>
                      <th scope="col" className="py-2 text-right font-semibold">Avg score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performance.rows.map((row) => (
                      <tr key={row.key} className="border-b border-slate-100 last:border-0">
                        <td className={`py-2 pr-3 ${row.key === 'overall' ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>
                          {row.label}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono text-slate-700">{row.settled}</td>
                        <td className="py-2 pr-3 text-right font-mono text-slate-700">
                          {row.hitRate === null ? '—' : `${row.hitRate.toFixed(1)}%`}
                        </td>
                        <td className={`py-2 pr-3 text-right font-mono ${pnlTone(row.roiPct ?? 0)}`}>
                          {fmtSignedPercent(row.roiPct)}
                        </td>
                        <td className={`py-2 pr-3 text-right font-mono ${pnlTone(row.profitUnits)}`}>
                          {fmtUnits(row.profitUnits)}
                        </td>
                        <td className="py-2 text-right font-mono text-slate-700">
                          {row.avgAiScore === null ? '—' : row.avgAiScore.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs leading-relaxed text-slate-500">
              Each fixture/market is counted once per matchday using the newest archived snapshot.
              Void markets are excluded from hit rate and ROI. Research record only, not a staking guarantee.
            </p>
          </div>
        )}
      </DataCard>

      {error && (
        <ErrorState
          title={
            error.scope === 'generate'
              ? 'AI accumulator could not be built'
              : 'AI briefing could not be loaded'
          }
          description={error.message}
          onRetry={() => void (error.scope === 'generate' ? generate() : load())}
          retryLabel={error.scope === 'generate' ? 'Retry building ticket' : 'Retry analysis'}
        />
      )}

      {loading && !briefing && error?.scope !== 'load' ? (
        <LoadingState label="Scoring today's priced markets…" count={5} />
      ) : briefing ? (
        <>
          <MetricGrid>
            <MetricCard label="Picks above bar" value={String(picks.length)} detail={`of ${briefing.picks.length} eligible`} />
            <MetricCard
              label="Positive EV picks"
              value={String(metrics.positiveEv)}
              detail={`${pct(picks.length > 0 ? metrics.positiveEv / picks.length : 0, 0)} of above-bar picks`}
              tone={metrics.positiveEv > 0 ? 'text-emerald-700' : 'text-slate-600'}
              infoKey="ev"
            />
            <MetricCard
              label="Avg edge (pp)"
              value={`${(metrics.avgEdge * 100).toFixed(1)} pp`}
              detail="vs de-vigged price"
              infoKey="modelEdge"
            />
            <MetricCard label="Quality bands" value={String(metrics.strong)} detail="high / solid estimates" />
          </MetricGrid>

          <DecisionChain pick={picks[0] ?? null} avgClv={briefing.avgClv} />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
            <div className="lg:col-span-7 min-w-0 space-y-3">
              <DataCard
                title={`Ranked picks · ${marketFilter === 'all' ? 'all markets' : marketFilter}`}
                subtitle={picksSummary}
                actions={
                  picks.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => onApplyTicket(picks.map(toLeg))}
                      disabled={!canApplyTicket}
                      title={
                        canApplyTicket
                          ? `Add all ${picks.length} visible picks to a wide research slip; the five-leg cap is not applied`
                          : 'Load the matchday slate first'
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      Add all to slip
                    </button>
                  ) : null
                }
              >
                {picks.length === 0 ? (
                  <EmptyState
                    title="No picks clear this bar"
                    description="Lower the model score threshold or widen the market filter. An empty shortlist is a legitimate no-bet result."
                    action={
                      <button
                        type="button"
                        onClick={() => setMinScore(40)}
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        Lower threshold to 40
                      </button>
                    }
                  />
                ) : (
                  <ol className="space-y-3">
                    {picks.map((pick, index) => (
                      <li
                        key={`${pick.fixtureId}:${pick.marketId}`}
                        className="rounded-xl border border-slate-200 bg-white p-3.5"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                              #{index + 1} · {pick.competition} · {pick.kickoffTime}
                            </p>
                            <p className="truncate text-sm font-bold text-slate-900">
                              {pick.homeTeam} <span className="text-slate-600">vs</span> {pick.awayTeam}
                            </p>
                            <p className="mt-0.5 text-sm text-slate-600">
                              {pick.label} <span className="font-mono font-semibold text-slate-900">@ {pick.odds.toFixed(2)}</span>
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`rounded-full border px-2 py-0.5 text-xs font-bold uppercase ${frameworkTone(pick.frameworkStatus)}`}>
                              {pick.band}
                            </span>
                            <span className="rounded-lg bg-slate-900 px-2.5 py-1 font-mono text-sm font-bold text-white">
                              {pick.aiScore}
                            </span>
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                          <div className="rounded-lg bg-slate-50 px-2.5 py-2">
                            <p className="text-xs text-slate-500">Model</p>
                            <p className="font-mono text-sm font-bold text-slate-900">{pct(pick.pModel)}</p>
                          </div>
                          <div className="rounded-lg bg-slate-50 px-2.5 py-2">
                            <p className="text-xs text-slate-500">Fair price</p>
                            <p className="font-mono text-sm font-bold text-slate-900">{pct(pick.pFair)}</p>
                          </div>
                          <div className="rounded-lg bg-emerald-50 px-2.5 py-2">
                            <p className="text-xs text-emerald-700">Model edge (pp)</p>
                            <p className="font-mono text-sm font-bold text-emerald-800">
                              {pick.edge >= 0 ? '+' : ''}
                              {(pick.edge * 100).toFixed(1)} pp
                            </p>
                          </div>
                          <div className="rounded-lg bg-emerald-50 px-2.5 py-2">
                            <p className="text-xs text-emerald-700">EV %</p>
                            <p className="font-mono text-sm font-bold text-emerald-800">{pct(pick.evStress)}</p>
                          </div>
                        </div>

                        <ul className="mt-3 space-y-1 text-xs leading-relaxed text-slate-600">
                          {pick.narrative && (
                            <li className="flex gap-1.5 font-medium text-slate-800">
                              <Bot className="mt-0.5 h-3 w-3 shrink-0 text-indigo-500" aria-hidden="true" />
                              {pick.narrative}
                            </li>
                          )}
                          {pick.reasons.slice(0, 3).map((reason) => (
                            <li key={reason} className="flex gap-1.5">
                              <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" aria-hidden="true" />
                              {reason}
                            </li>
                          ))}
                        </ul>

                        {pick.risks.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {pick.risks.slice(0, 4).map((risk) => (
                              <span
                                key={risk}
                                className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800"
                              >
                                {risk}
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
                          <span className="text-xs text-slate-500">
                            Suggested stake {pct(pick.stakePct, 2)} of bankroll · {pick.signals.poisson !== null ? '5' : '4'} signals
                          </span>
                          <button
                            type="button"
                            onClick={() => onApplyTicket([toLeg(pick)])}
                            disabled={!canApplyTicket}
                            title={canApplyTicket ? 'Add to a wide research slip; the five-leg cap is not applied' : 'Load the matchday slate first'}
                            className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 cursor-pointer"
                          >
                            Add to slip
                          </button>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </DataCard>
            </div>

            <div className="lg:col-span-5 min-w-0 space-y-3">
              <DataCard
                title="AI accumulator"
                subtitle="Correlation-aware, capped at five legs"
                actions={
                  visibleTicket ? (
                    <button
                      type="button"
                      onClick={() => void generate()}
                      disabled={building}
                      className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
                    >
                      Regenerate
                    </button>
                  ) : null
                }
              >
                {!visibleTicket ? (
                  <EmptyState
                    title="No ticket generated yet"
                    description="The builder searches small leg combinations, rejects low-confidence estimates and penalises shared competitions. It ranks by stressed EV, not by the biggest odds."
                    action={
                      <button
                        type="button"
                        onClick={() => void generate()}
                        disabled={building || picks.length === 0}
                        className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60 cursor-pointer"
                      >
                        {building ? 'Building…' : 'Generate with AI'}
                      </button>
                    }
                  />
                ) : visibleTicket.legs.length === 0 ? (
                  <EmptyState
                    title="The model declined to build a ticket"
                    description={visibleTicket.reason}
                  />
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5">
                      <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">
                        Combined quote
                      </p>
                      <p className="mt-1 font-mono text-3xl font-bold tabular-nums text-emerald-900">
                        {visibleTicket.totalOdds.toFixed(2)}
                      </p>
                      <p className="mt-1 text-xs text-emerald-800">
                        {visibleTicket.legs.length} legs · {visibleTicket.targetReached ? 'target reached' : 'below target'}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-slate-200 p-2.5">
                        <p className="text-xs text-slate-500">Model hit chance</p>
                        <p className="font-mono text-lg font-bold text-slate-900">{pct(visibleTicket.hitProbability)}</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 p-2.5">
                        <p className="text-xs text-slate-500">Break-even</p>
                        <p className="font-mono text-lg font-bold text-slate-900">{pct(visibleTicket.breakEvenProbability)}</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 p-2.5">
                        <p className="text-xs text-slate-500">Stressed EV</p>
                        <p className={`font-mono text-lg font-bold ${visibleTicket.evStress > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                          {pct(visibleTicket.evStress)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-slate-200 p-2.5">
                        <p className="text-xs text-slate-500">Kelly stake</p>
                        <p className="font-mono text-lg font-bold text-slate-900">{pct(visibleTicket.stakePct, 2)}</p>
                      </div>
                    </div>

                    <ol className="space-y-2">
                      {visibleTicket.legs.map((leg, index) => (
                        <li key={`${leg.fixtureId}:${leg.marketId}`} className="flex gap-2 rounded-lg border border-slate-200 p-2.5">
                          <span className="font-mono text-xs font-bold text-slate-600">{index + 1}</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-slate-800">
                              {leg.homeTeam} v {leg.awayTeam}
                            </p>
                            <p className="text-xs text-slate-500">
                              {leg.label} · <span className="font-mono">{leg.odds.toFixed(2)}</span> · {leg.band}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ol>

                    <p className="text-xs leading-relaxed text-slate-600">{visibleTicket.reason}</p>

                    {visibleTicket.risks.length > 0 && (
                      <ul className="space-y-1 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900">
                        {visibleTicket.risks.map((risk) => (
                          <li key={risk}>· {risk}</li>
                        ))}
                      </ul>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onApplyTicket(visibleTicket.legs)}
                        disabled={!canApplyTicket}
                        title={canApplyTicket ? 'Load into a wide research slip; the five-leg cap is not applied' : 'Load the matchday slate first'}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60 cursor-pointer"
                      >
                        <Ticket className="h-3.5 w-3.5" aria-hidden="true" />
                        Load into slip
                      </button>
                      <button
                        type="button"
                        onClick={() => void copyTicket()}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Clipboard className="h-3.5 w-3.5" aria-hidden="true" />}
                        {copied ? 'Copied' : 'Copy ticket'}
                      </button>
                    </div>
                  </div>
                )}
              </DataCard>

              <DataCard title="How the free models work" subtitle="Why picks rank the way they do">
                <div className="space-y-2 text-xs leading-relaxed text-slate-600">
                  <p className="flex gap-2">
                    <Filter className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-600" aria-hidden="true" />
                    When signals disagree, the estimate is pulled toward the market and the confidence
                    band falls. Ranking uses <strong>stressed EV</strong>, not hit rate, because a high
                    win rate at short odds can still lose money.
                  </p>
                  <p className="flex gap-2">
                    <Layers3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-600" aria-hidden="true" />
                    The generated accumulator is capped at five legs from separate matches, penalises
                    shared competitions, and sizes stakes with quarter-Kelly capped at 2% per pick and
                    1% per ticket.
                  </p>
                  <p className="flex gap-2">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-600" aria-hidden="true" />
                    {briefing.narrativeNote}
                  </p>
                </div>
              </DataCard>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
