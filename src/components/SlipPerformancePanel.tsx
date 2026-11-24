import { fmtCount } from '../utils/format.ts';
import type {
  DayPerformance,
  MarketTypePerformance,
  OddsBandPerformance,
  SlipAnalytics,
} from '../utils/slipAnalytics.ts';
import { DataStatus } from './ui/DataStatus.tsx';
import { DataCard } from './ui/DataCard.tsx';
import { EquityCurve } from './performance/EquityCurve.tsx';
import { PerformanceDetail } from './performance/PerformanceDetail.tsx';
import { PerformanceMetrics } from './performance/PerformanceMetrics.tsx';
import { SlipDailyTable } from './performance/SlipDailyTable.tsx';
import { SlipMarketTypesTable } from './performance/SlipMarketTypesTable.tsx';
import { SlipOddsBandsTable } from './performance/SlipOddsBandsTable.tsx';
import { signedMwk } from './performance/format.ts';
import { pnlTone } from '../utils/uiTone.ts';

interface SlipPerformancePanelProps {
  analytics: SlipAnalytics;
  daily: DayPerformance[];
  oddsBands: OddsBandPerformance[];
  marketTypes: MarketTypePerformance[];
  todayDate: string;
}

/**
 * Saved-slip performance dashboard. The section components own their own
 * sorting and formatting; this file only composes the surfaces.
 */
export function SlipPerformancePanel({
  analytics,
  daily,
  oddsBands,
  marketTypes,
  todayDate,
}: SlipPerformancePanelProps) {
  const settled = analytics.won + analytics.lost + analytics.voided;
  const lastEquity = analytics.equity[analytics.equity.length - 1]?.value ?? 0;

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
          {fmtCount(settled)} settled · {fmtCount(analytics.open)} open ·{' '}
          {fmtCount(analytics.total)} saved
        </p>
      </div>

      <DataStatus source="Settled archive" mode="Saved slips" />

      <PerformanceMetrics analytics={analytics} />
      <PerformanceDetail analytics={analytics} />

      <DataCard
        title="Equity curve"
        subtitle="Cumulative net P&L, one point per settled slip"
        actions={
          <span
            className={`font-mono text-lg font-bold tabular-nums ${pnlTone(lastEquity)}`}
          >
            {signedMwk(lastEquity)}
          </span>
        }
        bodyClassName="px-4 py-3"
      >
        <EquityCurve points={analytics.equity} />
      </DataCard>

      <SlipDailyTable daily={daily} todayDate={todayDate} />

      <div className="grid gap-3 lg:grid-cols-2">
        <SlipMarketTypesTable marketTypes={marketTypes} />
        <SlipOddsBandsTable oddsBands={oddsBands} />
      </div>
    </section>
  );
}
