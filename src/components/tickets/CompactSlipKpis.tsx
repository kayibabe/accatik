import { ArrowRight, ChartNoAxesCombined } from 'lucide-react';
import {
  fmtCount,
  fmtPercent,
  fmtSignedPercent,
  fmtUnits,
} from '../../utils/format.ts';
import type { SlipAnalytics } from '../../utils/slipAnalytics.ts';
import { pnlTone } from '../../utils/uiTone.ts';
import { InfoHint } from '../ui/DataCard.tsx';

interface CompactSlipKpisProps {
  /** Same personal projection the authoritative My Activity screen renders. */
  analytics: SlipAnalytics;
  onViewActivity: () => void;
}

const SPARK_LIMIT = 8;
const SPARK_WIDTH = 104;
const SPARK_HEIGHT = 28;
const SPARK_PAD = 2;

function sparkPoints(values: number[]): string {
  if (values.length === 0) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  return values
    .map((value, index) => {
      const x =
        values.length === 1
          ? SPARK_WIDTH / 2
          : SPARK_PAD +
            (index / (values.length - 1)) * (SPARK_WIDTH - SPARK_PAD * 2);
      const y =
        span === 0
          ? SPARK_HEIGHT / 2
          : SPARK_PAD +
            (1 - (value - min) / span) * (SPARK_HEIGHT - SPARK_PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

/**
 * Lightweight personal summary for the archive screen. The full analytics
 * (days, odds bands, market types, equity curve) lives only in My Activity.
 */
export function CompactSlipKpis({
  analytics,
  onViewActivity,
}: CompactSlipKpisProps) {
  const trendValues = analytics.equity
    .slice(-SPARK_LIMIT)
    .map((point) => point.value);
  const latestPnl = trendValues[trendValues.length - 1] ?? 0;
  const trendLabel =
    trendValues.length > 1
      ? `Recent P&L trend across ${fmtCount(trendValues.length - 1)} settled slips, from ${fmtUnits(trendValues[0])} to ${fmtUnits(latestPnl)}`
      : 'No settled slips yet, so there is no P&L trend';
  const streak = analytics.currentStreak;

  return (
    <section
      aria-label="Saved slip performance summary"
      className="rounded-xl border border-slate-200 bg-white overflow-hidden"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
          <ChartNoAxesCombined
            className="h-4 w-4 text-slate-400"
            aria-hidden="true"
          />
          Performance snapshot
        </h2>
        <button
          type="button"
          onClick={onViewActivity}
          className="inline-flex items-center gap-1 rounded-md text-xs font-semibold text-emerald-700 hover:text-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 cursor-pointer"
        >
          View full performance in My Activity
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="grid grid-cols-2 divide-x divide-y divide-slate-200 sm:grid-cols-4 sm:divide-y-0">
        <div className="px-4 py-3">
          <p className="text-[11px] font-medium text-slate-500">Settled slips</p>
          <p className="mt-1 font-mono text-xl font-bold tabular-nums text-slate-900">
            {fmtCount(analytics.decided + analytics.voided)}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            {fmtCount(analytics.total)} saved · {fmtCount(analytics.open)} open
          </p>
        </div>

        <div className="px-4 py-3">
          <p className="text-[11px] font-medium text-slate-500">W / L / V</p>
          <p className="mt-1 font-mono text-xl font-bold tabular-nums text-slate-900">
            {fmtCount(analytics.won)} · {fmtCount(analytics.lost)} ·{' '}
            {fmtCount(analytics.voided)}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            {fmtPercent(analytics.hitRate)} hit rate
          </p>
        </div>

        <div className="px-4 py-3">
          <p className="flex items-center text-[11px] font-medium text-slate-500">
            ROI
            <InfoHint infoKey="roi" />
          </p>
          <p
            className={`mt-1 font-mono text-xl font-bold tabular-nums ${pnlTone(analytics.roi)}`}
          >
            {fmtSignedPercent(analytics.roi)}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            Net {fmtUnits(analytics.netPnl)}
          </p>
        </div>

        <div className="px-4 py-3">
          <p className="text-[11px] font-medium text-slate-500">Recent trend</p>
          <div
            className={`mt-1 flex items-center justify-between gap-2 ${pnlTone(latestPnl)}`}
            role="img"
            aria-label={trendLabel}
            title={trendLabel}
          >
            <span className="font-mono text-lg font-bold tabular-nums">
              {fmtUnits(latestPnl)}
            </span>
            <svg
              width={SPARK_WIDTH}
              height={SPARK_HEIGHT}
              viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
              aria-hidden="true"
              focusable="false"
              className="shrink-0"
            >
              <polyline
                points={sparkPoints(trendValues)}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {trendValues.length === 1 && (
                <circle
                  cx={SPARK_WIDTH / 2}
                  cy={SPARK_HEIGHT / 2}
                  r={2.5}
                  fill="currentColor"
                />
              )}
            </svg>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            {streak.kind
              ? `${fmtCount(streak.length)} ${streak.kind.toLowerCase()} streak`
              : 'No decided slips yet'}
          </p>
        </div>
      </div>
    </section>
  );
}
