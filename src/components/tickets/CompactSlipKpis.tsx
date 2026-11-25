import { ArrowRight, ChartNoAxesCombined } from 'lucide-react';
import {
  EMPTY_COPY,
  pnlTone,
} from '../../utils/uiTone.ts';
import {
  fmtCount,
  fmtPercent,
  fmtSignedPercent,
  fmtUnits,
} from '../../utils/format.ts';
import type { SlipAnalytics } from '../../utils/slipAnalytics.ts';
import { MetricCell } from '../ui/DataCard.tsx';

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
      : `${EMPTY_COPY.settledSlips}, so there is no P&L trend`;
  const streak = analytics.currentStreak;

  return (
    <section
      aria-label="Saved slip performance summary"
      className="rounded-xl border border-slate-200 bg-white overflow-hidden"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
          <ChartNoAxesCombined
            className="h-4 w-4 text-slate-600"
            aria-hidden="true"
          />
          Performance snapshot
        </h2>
        <button
          type="button"
          onClick={onViewActivity}
          className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-semibold text-emerald-700 hover:text-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 cursor-pointer"
        >
          View full performance in My Activity
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="grid grid-cols-2 divide-x divide-y divide-slate-200 sm:grid-cols-4 sm:divide-y-0">
        <MetricCell
          variant="plain"
          label="Settled slips"
          value={fmtCount(analytics.decided + analytics.voided)}
          detail={`${fmtCount(analytics.total)} saved · ${fmtCount(analytics.open)} open`}
        />
        <MetricCell
          variant="plain"
          label="W / L / V"
          value={`${fmtCount(analytics.won)} · ${fmtCount(analytics.lost)} · ${fmtCount(analytics.voided)}`}
          detail={`${fmtPercent(analytics.hitRate)} hit rate`}
        />
        <MetricCell
          variant="plain"
          label="ROI"
          infoKey="roi"
          value={fmtSignedPercent(analytics.roi)}
          tone={pnlTone(analytics.roi)}
          detail={`Net ${fmtUnits(analytics.netPnl)}`}
        />
        <MetricCell
          variant="plain"
          label="Recent trend"
          tone={pnlTone(latestPnl)}
          value={
            <span
              role="img"
              aria-label={trendLabel}
              title={trendLabel}
              className="flex items-center justify-between gap-2"
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
            </span>
          }
          detail={
            streak.kind
              ? `${fmtCount(streak.length)} ${streak.kind.toLowerCase()} streak`
              : 'No decided slips yet'
          }
        />
      </div>
    </section>
  );
}
