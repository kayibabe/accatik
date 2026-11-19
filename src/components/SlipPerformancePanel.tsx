import {
  Activity,
  Percent,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import { formatMwk } from '../utils/accaMath.ts';
import type {
  DayPerformance,
  MarketTypePerformance,
  OddsBandPerformance,
  SlipAnalytics,
} from '../utils/slipAnalytics.ts';

interface SlipPerformancePanelProps {
  analytics: SlipAnalytics;
  daily: DayPerformance[];
  oddsBands: OddsBandPerformance[];
  marketTypes: MarketTypePerformance[];
}

const percent = (value: number | null): string =>
  value === null ? '—' : `${value.toFixed(1)}%`;

const signedPercent = (value: number | null): string => {
  if (value === null) return '—';
  if (value > 0) return `+${value.toFixed(1)}%`;
  if (value < 0) return `${value.toFixed(1)}%`;
  return '0.0%';
};

const signedMwk = (value: number): string => {
  if (value > 0) return `+${formatMwk(value)}`;
  if (value < 0) return `-${formatMwk(Math.abs(value))}`;
  return formatMwk(0);
};

const pnlTone = (value: number): string =>
  value > 0 ? 'text-emerald-700' : value < 0 ? 'text-red-600' : 'text-slate-700';

const recordLabel = (won: number, lost: number, voided: number): string =>
  `${won}W · ${lost}L · ${voided}V`;

function shortDate(dateIso: string): string {
  if (!dateIso) return 'Start';
  const [year, month, day] = dateIso.split('-').map(Number);
  if (!year || !month || !day) return dateIso;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** Inline equity chart. Starts at zero and plots one point per settled slip. */
function EquityCurve({ analytics }: { analytics: SlipAnalytics }) {
  const points = analytics.equity;
  if (points.length <= 1) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/60">
        <p className="px-4 text-center text-xs text-slate-400">
          Not enough settled slips to plot an equity curve yet.
        </p>
      </div>
    );
  }

  const width = 640;
  const height = 160;
  const padX = 10;
  const padY = 16;
  const values = points.map((point) => point.value);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = Math.max(1, max - min);
  const step = (width - padX * 2) / Math.max(1, points.length - 1);
  const toY = (value: number) => padY + ((max - value) / range) * (height - padY * 2);

  const coordinates = points.map((point, index) => ({
    x: padX + index * step,
    y: toY(point.value),
  }));
  const line = coordinates.map((point) => `${point.x},${point.y}`).join(' ');
  const area = [
    `M ${coordinates[0].x} ${coordinates[0].y}`,
    ...coordinates.slice(1).map((point) => `L ${point.x} ${point.y}`),
    `L ${coordinates[coordinates.length - 1].x} ${height - padY}`,
    `L ${coordinates[0].x} ${height - padY}`,
    'Z',
  ].join(' ');
  const zeroY = toY(0);
  const isUp = points[points.length - 1].value >= 0;
  const tone = isUp ? '#047857' : '#dc2626';

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Equity curve from zero to ${signedMwk(
          points[points.length - 1].value
        )} over ${points.length - 1} settled slips`}
        className="h-40 w-full"
        preserveAspectRatio="none"
      >
        <line
          x1={padX}
          y1={zeroY}
          x2={width - padX}
          y2={zeroY}
          stroke="#cbd5e1"
          strokeWidth="1"
          strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
        />
        <path d={area} fill={isUp ? '#10b981' : '#ef4444'} opacity={0.1} />
        <polyline
          points={line}
          fill="none"
          stroke={tone}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
        <span>{shortDate(points[1].dateIso)}</span>
        <span>zero line</span>
        <span>{shortDate(points[points.length - 1].dateIso)}</span>
      </div>
    </div>
  );
}

export function SlipPerformancePanel({
  analytics,
  daily,
  oddsBands,
  marketTypes,
}: SlipPerformancePanelProps) {
  const lastEquity = analytics.equity[analytics.equity.length - 1]?.value ?? 0;
  const settled = analytics.won + analytics.lost + analytics.voided;
  const avgPnlPerSlip = settled > 0 ? analytics.netPnl / settled : null;
  const pnlUp = analytics.netPnl >= 0;

  return (
    <section aria-label="Slip performance analytics" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
            Performance
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Settled slips only. Void stakes are returned and kept out of ROI;
            open slips never enter the money metrics.
          </p>
        </div>
        <p className="text-[11px] font-mono text-slate-500 tabular-nums">
          {settled} settled · {analytics.open} open · {analytics.total} saved
        </p>
      </div>

      {/* Headline metrics */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
            {pnlUp ? (
              <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Net P&amp;L
          </p>
          <p
            className={`mt-1 text-lg font-bold font-mono tabular-nums ${pnlTone(
              analytics.netPnl
            )}`}
          >
            {signedMwk(analytics.netPnl)}
          </p>
          <p className="text-[11px] text-slate-400">
            {formatMwk(analytics.returns)} gross returned ·{' '}
            {formatMwk(analytics.settledStake)} settled stake
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
            <Percent className="h-3.5 w-3.5" aria-hidden="true" />
            ROI
          </p>
          <p
            className={`mt-1 text-lg font-bold font-mono tabular-nums ${
              analytics.roi === null ? 'text-slate-400' : pnlTone(analytics.roi)
            }`}
          >
            {signedPercent(analytics.roi)}
          </p>
          <p className="text-[11px] text-slate-400">
            Net P&amp;L ÷ Win/Lost stake
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
            <Target className="h-3.5 w-3.5" aria-hidden="true" />
            Hit rate
          </p>
          <p className="mt-1 text-lg font-bold font-mono tabular-nums text-slate-900">
            {percent(analytics.hitRate)}
          </p>
          <p className="text-[11px] text-slate-400">
            {analytics.won} won of {analytics.decided} decided ·{' '}
            {percent(analytics.voidRate)} void
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
            <Trophy className="h-3.5 w-3.5" aria-hidden="true" />
            Record
          </p>
          <p className="mt-1 text-lg font-bold font-mono tabular-nums">
            <span className="text-emerald-700">{analytics.won}</span>
            <span className="text-slate-300"> / </span>
            <span className="text-red-600">{analytics.lost}</span>
            <span className="text-slate-300"> / </span>
            <span className="text-amber-700">{analytics.voided}</span>
          </p>
          <p className="text-[11px] text-slate-400">
            Wins / losses / voids
          </p>
        </div>
      </div>

      {/* Bankroll + equity */}
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
            <Activity className="h-3.5 w-3.5" aria-hidden="true" />
            Bankroll detail
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
            {/* Constant rows keep the two columns aligned. */}
            <div>
              <dt className="text-slate-400">Total staked</dt>
              <dd className="font-mono font-semibold text-slate-800 tabular-nums">
                {formatMwk(analytics.totalStaked)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Settled stake</dt>
              <dd className="font-mono font-semibold text-slate-800 tabular-nums">
                {formatMwk(analytics.settledStake)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Settled returns</dt>
              <dd className="font-mono font-semibold text-slate-800 tabular-nums">
                {formatMwk(analytics.returns)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Void stake returned</dt>
              <dd className="font-mono font-semibold text-slate-800 tabular-nums">
                {formatMwk(analytics.voidedStake)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Biggest win</dt>
              <dd className="font-mono font-semibold text-emerald-700 tabular-nums">
                {formatMwk(analytics.biggestWin)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Biggest loss</dt>
              <dd className="font-mono font-semibold text-red-600 tabular-nums">
                {formatMwk(analytics.biggestLoss)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Gross profit</dt>
              <dd className="font-mono font-semibold text-emerald-700 tabular-nums">
                {formatMwk(analytics.grossProfit)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Gross loss</dt>
              <dd className="font-mono font-semibold text-red-600 tabular-nums">
                {formatMwk(analytics.grossLoss)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Profit factor</dt>
              <dd className="font-mono font-semibold text-slate-800 tabular-nums">
                {analytics.profitFactor === null
                  ? '—'
                  : analytics.profitFactor.toFixed(2)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Avg P&amp;L / slip</dt>
              <dd
                className={`font-mono font-semibold tabular-nums ${pnlTone(
                  avgPnlPerSlip ?? 0
                )}`}
              >
                {avgPnlPerSlip === null ? '—' : signedMwk(avgPnlPerSlip)}
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-[11px] font-medium text-slate-500">
            Ticket profile
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
            <div>
              <dt className="text-slate-400">Avg stake (W/L)</dt>
              <dd className="font-mono font-semibold text-slate-800 tabular-nums">
                {formatMwk(analytics.avgStake)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Avg odds (W/L)</dt>
              <dd className="font-mono font-semibold text-slate-800 tabular-nums">
                {analytics.avgOdds > 0 ? analytics.avgOdds.toFixed(2) : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Avg winning odds</dt>
              <dd className="font-mono font-semibold text-emerald-700 tabular-nums">
                {analytics.avgWinningOdds === null
                  ? '—'
                  : analytics.avgWinningOdds.toFixed(2)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Avg losing odds</dt>
              <dd className="font-mono font-semibold text-red-600 tabular-nums">
                {analytics.avgLosingOdds === null
                  ? '—'
                  : analytics.avgLosingOdds.toFixed(2)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Avg legs</dt>
              <dd className="font-mono font-semibold text-slate-800 tabular-nums">
                {analytics.avgLegs > 0 ? analytics.avgLegs.toFixed(1) : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Longest streaks</dt>
              <dd className="font-mono font-semibold text-slate-800 tabular-nums">
                <span className="text-emerald-700">
                  {analytics.longestWinStreak}W
                </span>
                <span className="text-slate-300"> / </span>
                <span className="text-red-600">
                  {analytics.longestLossStreak}L
                </span>
              </dd>
            </div>
          </dl>
          <p className="mt-2 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
            Current streak:{' '}
            <span
              className={`font-semibold ${
                analytics.currentStreak.kind === 'Win'
                  ? 'text-emerald-700'
                  : analytics.currentStreak.kind === 'Lost'
                    ? 'text-red-600'
                    : 'text-slate-500'
              }`}
            >
              {analytics.currentStreak.kind === null
                ? 'no decided slips'
                : `${analytics.currentStreak.length} ${
                    analytics.currentStreak.kind === 'Win'
                      ? analytics.currentStreak.length === 1
                        ? 'win'
                        : 'wins'
                      : analytics.currentStreak.length === 1
                        ? 'loss'
                        : 'losses'
                  } in a row`}
            </span>
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[11px] font-medium text-slate-500">
              Equity curve
            </p>
            <p
              className={`font-mono text-lg font-bold tabular-nums ${pnlTone(
                lastEquity
              )}`}
            >
              {signedMwk(lastEquity)}
            </p>
          </div>
          <div className="mt-2">
            <EquityCurve analytics={analytics} />
          </div>
        </div>
      </div>

      {/* P&L by matchday */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
          <h3 className="text-xs font-semibold text-slate-700">
            P&amp;L by matchday
          </h3>
          <span className="text-[11px] text-slate-400">
            Newest first · void days stay flat
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Matchday</th>
                <th className="px-3 py-2 text-right font-semibold">Slips</th>
                <th className="px-3 py-2 text-right font-semibold">W-L-V</th>
                <th className="px-3 py-2 text-right font-semibold">Staked</th>
                <th className="px-3 py-2 text-right font-semibold">Returns</th>
                <th className="px-3 py-2 text-right font-semibold">Net P&amp;L</th>
                <th className="px-4 py-2 text-right font-semibold">ROI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {daily.map((day) => (
                <tr key={day.dateIso}>
                  <td className="px-4 py-2 font-medium text-slate-800">
                    {shortDate(day.dateIso)}
                    {day.open > 0 && (
                      <span className="ml-1.5 text-[10px] text-slate-400">
                        ({day.open} open)
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-600 tabular-nums">
                    {day.slips}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-600 tabular-nums">
                    {recordLabel(day.won, day.lost, day.voided)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-600 tabular-nums">
                    {formatMwk(day.settledStake)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-600 tabular-nums">
                    {formatMwk(day.returns)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono font-semibold tabular-nums ${pnlTone(
                      day.netPnl
                    )}`}
                  >
                    {signedMwk(day.netPnl)}
                  </td>
                  <td
                    className={`px-4 py-2 text-right font-mono font-semibold tabular-nums ${pnlTone(
                      day.roi ?? 0
                    )}`}
                  >
                    {signedPercent(day.roi)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Leg hit rate by market type */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-2.5">
            <h3 className="text-xs font-semibold text-slate-700">
              Leg hit rate by market
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Every leg on a saved slip, settled independently.
            </p>
          </div>
          {marketTypes.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-slate-400">
              No legs saved yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Market</th>
                    <th className="px-3 py-2 text-right font-semibold">Legs</th>
                    <th className="px-3 py-2 text-right font-semibold">W-L-V</th>
                    <th className="px-3 py-2 text-right font-semibold">Open</th>
                    <th className="px-4 py-2 text-right font-semibold">
                      Hit rate
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {marketTypes.map((row) => (
                    <tr key={row.marketType}>
                      <td className="px-4 py-2 font-medium text-slate-800">
                        {row.marketType}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-600 tabular-nums">
                        {row.legs}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-600 tabular-nums">
                        {recordLabel(row.won, row.lost, row.voided)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-600 tabular-nums">
                        {row.open}
                      </td>
                      <td className="px-4 py-2 text-right font-mono font-semibold text-slate-800 tabular-nums">
                        {percent(row.hitRate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Performance by odds band */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-2.5">
            <h3 className="text-xs font-semibold text-slate-700">
              P&amp;L by odds band
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Settled slips grouped by their void-adjusted total odds.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-semibold">Odds</th>
                  <th className="px-3 py-2 text-right font-semibold">Slips</th>
                  <th className="px-3 py-2 text-right font-semibold">W-L-V</th>
                  <th className="px-3 py-2 text-right font-semibold">Net P&amp;L</th>
                  <th className="px-3 py-2 text-right font-semibold">ROI</th>
                  <th className="px-4 py-2 text-right font-semibold">Hit rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {oddsBands.map((band) => (
                  <tr key={band.id}>
                    <td className="px-4 py-2 font-medium text-slate-800">
                      {band.label}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600 tabular-nums">
                      {band.slips}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600 tabular-nums">
                      {recordLabel(band.won, band.lost, band.voided)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono font-semibold tabular-nums ${pnlTone(
                        band.netPnl
                      )}`}
                    >
                      {signedMwk(band.netPnl)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono font-semibold tabular-nums ${pnlTone(
                        band.roi ?? 0
                      )}`}
                    >
                      {signedPercent(band.roi)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono font-semibold text-slate-800 tabular-nums">
                      {percent(band.hitRate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
            Hit rate counts wins against Win/Lost slips only. Void and open
            slips stay out of both ratios.
          </p>
        </div>
      </div>
    </section>
  );
}
