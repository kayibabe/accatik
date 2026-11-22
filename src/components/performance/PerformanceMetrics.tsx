import { fmtPercent, fmtSignedPercent } from '../../utils/format.ts';
import { formatMwk } from '../../utils/accaMath.ts';
import { pnlTone } from '../../utils/uiTone.ts';
import type { SlipAnalytics } from '../../utils/slipAnalytics.ts';
import { InfoHint, MetricCard, MetricGrid } from '../ui/DataCard.tsx';
import { signedMwk } from './format.ts';

/** Top-level KPI strip. Five cards keep the hierarchy compact on desktop. */
export function PerformanceMetrics({ analytics }: { analytics: SlipAnalytics }) {
  const settled = analytics.won + analytics.lost + analytics.voided;
  const avgPnlPerSlip = settled > 0 ? analytics.netPnl / settled : null;

  return (
    <MetricGrid>
      <MetricCard
        label="Net P&L"
        value={signedMwk(analytics.netPnl)}
        tone={pnlTone(analytics.netPnl)}
        infoKey="pnl"
        detail={
          <>
            {formatMwk(analytics.returns)} gross returned ·{' '}
            {formatMwk(analytics.settledStake)} settled stake
          </>
        }
      />
      <MetricCard
        label="ROI"
        value={fmtSignedPercent(analytics.roi)}
        tone={analytics.roi === null ? 'text-slate-400' : pnlTone(analytics.roi)}
        infoKey="roi"
        detail="Net P&L ÷ Win/Lost stake"
      />
      <MetricCard
        label="Hit rate"
        value={fmtPercent(analytics.hitRate)}
        detail={
          <>
            {analytics.won} won of {analytics.decided} decided ·{' '}
            {fmtPercent(analytics.voidRate)} void
            <InfoHint
              label="Hit rate"
              definition="Wins as a share of decided (Win/Lost) slips. Void and open slips are excluded."
              source="Settled archive · saved slips"
            />
          </>
        }
      />
      <MetricCard
        label="Record"
        value={`${analytics.won} / ${analytics.lost} / ${analytics.voided}`}
        detail={
          <>
            Wins / losses / voids
            <InfoHint
              label="Settlement record"
              definition="Win, Lost and Void counts across saved slips, including slips still open elsewhere in the archive."
              source="Saved slip settlement"
            />
          </>
        }
      />
      <MetricCard
        label="Avg P&L / slip"
        value={avgPnlPerSlip === null ? '—' : signedMwk(avgPnlPerSlip)}
        tone={
          avgPnlPerSlip === null ? 'text-slate-400' : pnlTone(avgPnlPerSlip)
        }
        detail={
          <>
            Across {settled} settled slips
            <InfoHint
              label="Average P&L per slip"
              definition="Net settled profit divided by Win, Lost and Void slips. Open slips are excluded."
              source="Settled archive / saved slips"
            />
          </>
        }
      />
    </MetricGrid>
  );
}
