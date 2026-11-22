import { useState } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { fmtShortDate, fmtUnits } from '../../utils/format.ts';
import { pnlTone } from '../../utils/uiTone.ts';
import type { PickAnalyticsDay } from '../../types/analytics.ts';

/** Dependency-free equity curve, matching the existing activity chart style. */
function EquityChart({ days }: { days: PickAnalyticsDay[] }) {
  const [series, setSeries] = useState<'featured' | 'markets'>('featured');
  const values = days.map((day) =>
    series === 'featured' ? day.cumulativeFeatured : day.cumulativeMarkets
  );
  const last = values[values.length - 1] ?? 0;

  if (days.length <= 1) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/60">
        <p className="px-4 text-center text-xs text-slate-400">
          More settled matchdays are needed to plot a curve.
        </p>
      </div>
    );
  }

  const width = 640;
  const height = 160;
  const padX = 10;
  const padY = 16;
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = Math.max(1, max - min);
  const step = (width - padX * 2) / (values.length - 1);
  const toY = (value: number) =>
    padY + ((max - value) / range) * (height - padY * 2);
  const coordinates = values.map((value, index) => ({
    x: padX + index * step,
    y: toY(value),
  }));
  const line = coordinates.map((point) => `${point.x},${point.y}`).join(' ');
  const area = [
    `M ${coordinates[0].x} ${coordinates[0].y}`,
    ...coordinates.slice(1).map((point) => `L ${point.x} ${point.y}`),
    `L ${coordinates[coordinates.length - 1].x} ${height - padY}`,
    `L ${coordinates[0].x} ${height - padY}`,
    'Z',
  ].join(' ');
  const tone = last >= 0 ? '#047857' : '#dc2626';

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          {(
            [
              ['featured', 'Featured picks'],
              ['markets', 'All markets'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSeries(id)}
              aria-pressed={series === id}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                series === id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className={`font-mono text-lg font-bold tabular-nums ${pnlTone(last)}`}>
          {fmtUnits(last)}
        </p>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Cumulative ${series === 'featured' ? 'featured pick' : 'market pick'} P&L from zero to ${fmtUnits(last)} over ${days.length} matchdays`}
        className="mt-2 h-40 w-full"
        preserveAspectRatio="none"
      >
        <line
          x1={padX}
          y1={toY(0)}
          x2={width - padX}
          y2={toY(0)}
          stroke="#cbd5e1"
          strokeWidth="1"
          strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={area}
          fill={last >= 0 ? '#10b981' : '#ef4444'}
          opacity={0.1}
        />
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
        <span>{fmtShortDate(days[0].dateIso)}</span>
        <span>zero line</span>
        <span>{fmtShortDate(days[days.length - 1].dateIso)}</span>
      </div>
    </div>
  );
}

function lastTrendIcon(days: PickAnalyticsDay[]) {
  const last = days[days.length - 1]?.cumulativeFeatured ?? 0;
  return last >= 0 ? (
    <TrendingUp className="h-4 w-4 text-emerald-700" aria-hidden="true" />
  ) : (
    <TrendingDown className="h-4 w-4 text-red-600" aria-hidden="true" />
  );
}

/** One point per archived matchday, oldest to newest. */
export function CumulativePnlSection({ days }: { days: PickAnalyticsDay[] }) {
  return (
    <section
      id="cumulative-pnl"
      className="scroll-mt-16 rounded-xl border border-slate-200 bg-white px-4 py-3"
      aria-labelledby="cumulative-pnl-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2
            id="cumulative-pnl-title"
            className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-slate-500"
          >
            {lastTrendIcon(days)}
            Cumulative P&amp;L
          </h2>
          <p className="mt-0.5 text-[11px] text-slate-400">
            One point per archived matchday, oldest to newest.
          </p>
        </div>
      </div>
      <div className="mt-3">
        <EquityChart days={days} />
      </div>
    </section>
  );
}
