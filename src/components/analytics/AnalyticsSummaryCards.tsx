import { Info } from 'lucide-react';
import { fmtCount, fmtPercent, fmtSignedPercent, fmtUnits } from '../../utils/format.ts';
import { pnlTone } from '../../utils/uiTone.ts';
import { researchCopy } from '../../utils/researchCopy.ts';
import type { PickAnalyticsResponse } from '../../types/analytics.ts';
import { InfoHint, MetricCard, MetricGrid } from '../ui/DataCard.tsx';
import type { Summary } from './analyticsModel.ts';

interface AnalyticsSummaryCardsProps {
  data: PickAnalyticsResponse;
  featuredSummary: Summary;
  marketSummary: Summary;
}

/** Archive provenance plus the six headline KPIs. */
export function AnalyticsSummaryCards({
  data,
  featuredSummary,
  marketSummary,
}: AnalyticsSummaryCardsProps) {
  return (
    <section id="summary" className="scroll-mt-16 space-y-3" aria-labelledby="analytics-summary-title">
      <h2 id="analytics-summary-title" className="sr-only">
        Archive summary
      </h2>
      <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs leading-relaxed text-slate-600">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        <p>
          Rebuilt from {fmtCount(data.sampleDates)} archived matchdays and{' '}
          {fmtCount(data.sampleFixtures)} finished priced fixtures. Every pick is
          settled at a flat {data.stakePerPick}-unit stake; voids return their
          stake and are excluded from hit rate, ROI, stake and returns. Featured
          picks are a subset of the individual markets, so the two sections
          overlap. Of {fmtCount(data.marketPicks)} market picks,{' '}
          {fmtCount(data.priceQuality.prematch)} were captured pre-match,{' '}
          {fmtCount(data.priceQuality.live)} after kickoff and{' '}
          {fmtCount(data.priceQuality.unknown)} with unknown capture time.
        </p>
      </div>

      <MetricGrid>
        <MetricCard
          label="Featured hit rate"
          value={fmtPercent(featuredSummary.hitRate)}
          detail={`${featuredSummary.wins}W · ${featuredSummary.losses}L`}
        />
        <MetricCard
          label="Featured net P&L"
          value={fmtUnits(featuredSummary.netPnl)}
          detail="angle + cover + note"
          tone={pnlTone(featuredSummary.netPnl)}
          infoKey="pnl"
        />
        <MetricCard
          label="Featured ROI"
          value={fmtSignedPercent(featuredSummary.roi)}
          detail={`${fmtCount(featuredSummary.stake)}u risked`}
          tone={pnlTone(featuredSummary.roi)}
          infoKey="roi"
        />
        <MetricCard
          label="Market hit rate"
          value={fmtPercent(marketSummary.hitRate)}
          detail={`${marketSummary.wins}W · ${marketSummary.losses}L`}
        />
        <MetricCard
          label="Market net P&L"
          value={fmtUnits(marketSummary.netPnl)}
          detail={`${fmtCount(data.marketPicks)} settled picks`}
          tone={pnlTone(marketSummary.netPnl)}
          infoKey="pnl"
        />
        <MetricCard
          label="Market ROI"
          value={fmtSignedPercent(marketSummary.roi)}
          detail={`${fmtCount(marketSummary.stake)}u risked`}
          tone={pnlTone(marketSummary.roi)}
          infoKey="roi"
        />
      </MetricGrid>
      <p className="flex items-center gap-1 text-[11px] text-slate-400">
        Flat-stake research record, not real money. Closing line value is
        tracked in the shadow ledger, not in this archive.
        <InfoHint infoKey="clv" /> {researchCopy.verifyPrices}
      </p>
    </section>
  );
}
