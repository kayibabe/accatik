import type { ReactNode } from 'react';
import { fmtFixed, fmtOdds } from '../../utils/format.ts';
import { formatMwk } from '../../utils/accaMath.ts';
import { pnlTone } from '../../utils/uiTone.ts';
import type { SlipAnalytics } from '../../utils/slipAnalytics.ts';
import { DataCard } from '../ui/DataCard.tsx';
import { signedMwk } from './format.ts';

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-slate-600">{label}</dt>
      <dd className="font-mono font-semibold text-slate-800 tabular-nums">
        {children}
      </dd>
    </div>
  );
}

/** Supporting bankroll and ticket-shape breakdowns below the KPI strip. */
export function PerformanceDetail({ analytics }: { analytics: SlipAnalytics }) {
  const settled = analytics.won + analytics.lost + analytics.voided;
  const avgPnlPerSlip = settled > 0 ? analytics.netPnl / settled : null;
  const streakTone =
    analytics.currentStreak.kind === 'Win'
      ? pnlTone(1)
      : analytics.currentStreak.kind === 'Lost'
        ? pnlTone(-1)
        : 'text-slate-500';
  const streakText =
    analytics.currentStreak.kind === null
      ? 'no decided slips'
      : `${analytics.currentStreak.length} ${
          analytics.currentStreak.kind === 'Win'
            ? analytics.currentStreak.length === 1
              ? 'win'
              : 'wins'
            : analytics.currentStreak.length === 1
              ? 'loss'
              : 'losses'
        } in a row`;

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <DataCard title="Bankroll detail" bodyClassName="px-4 py-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          {/* Constant rows keep the two columns aligned. */}
          <DetailRow label="Total staked">
            {formatMwk(analytics.totalStaked)}
          </DetailRow>
          <DetailRow label="Settled stake">
            {formatMwk(analytics.settledStake)}
          </DetailRow>
          <DetailRow label="Settled returns">
            {formatMwk(analytics.returns)}
          </DetailRow>
          <DetailRow label="Void stake returned">
            {formatMwk(analytics.voidedStake)}
          </DetailRow>
          <DetailRow label="Biggest win">
            <span className={pnlTone(analytics.biggestWin)}>
              {formatMwk(analytics.biggestWin)}
            </span>
          </DetailRow>
          <DetailRow label="Biggest loss">
            <span className={pnlTone(-analytics.biggestLoss)}>
              {formatMwk(analytics.biggestLoss)}
            </span>
          </DetailRow>
          <DetailRow label="Gross profit">
            <span className={pnlTone(analytics.grossProfit)}>
              {formatMwk(analytics.grossProfit)}
            </span>
          </DetailRow>
          <DetailRow label="Gross loss">
            <span className={pnlTone(-analytics.grossLoss)}>
              {formatMwk(analytics.grossLoss)}
            </span>
          </DetailRow>
          <DetailRow label="Profit factor">
            {fmtFixed(analytics.profitFactor, 2)}
          </DetailRow>
          <DetailRow label={'Avg P&L / slip'}>
            <span className={avgPnlPerSlip === null ? '' : pnlTone(avgPnlPerSlip)}>
              {avgPnlPerSlip === null ? '—' : signedMwk(avgPnlPerSlip)}
            </span>
          </DetailRow>
        </dl>
      </DataCard>

      <DataCard title="Ticket profile" bodyClassName="px-4 py-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <DetailRow label="Avg stake (W/L)">
            {formatMwk(analytics.avgStake)}
          </DetailRow>
          <DetailRow label="Avg odds (W/L)">
            {fmtOdds(analytics.avgOdds > 0 ? analytics.avgOdds : null)}
          </DetailRow>
          <DetailRow label="Avg winning odds">
            <span className={pnlTone(1)}>
              {fmtOdds(analytics.avgWinningOdds)}
            </span>
          </DetailRow>
          <DetailRow label="Avg losing odds">
            <span className={pnlTone(-1)}>
              {fmtOdds(analytics.avgLosingOdds)}
            </span>
          </DetailRow>
          <DetailRow label="Avg legs">
            {fmtFixed(analytics.avgLegs > 0 ? analytics.avgLegs : null, 1)}
          </DetailRow>
          <DetailRow label="Longest streaks">
            <span className={pnlTone(1)}>{analytics.longestWinStreak}W</span>
            <span className="text-slate-300"> / </span>
            <span className={pnlTone(-1)}>{analytics.longestLossStreak}L</span>
          </DetailRow>
        </dl>
        <p className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-500">
          Current streak:{' '}
          <span className={`font-semibold ${streakTone}`}>{streakText}</span>
        </p>
      </DataCard>
    </div>
  );
}
