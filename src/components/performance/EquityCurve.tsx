import { useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { fmtShortDate } from '../../utils/format.ts';
import type { EquityPoint } from '../../utils/slipAnalytics.ts';
import { signedMwk } from './format.ts';

interface EquityCurveProps {
  /** Starts with the zero anchor, followed by one point per settled slip. */
  points: EquityPoint[];
}

const WIDTH = 640;
const HEIGHT = 160;
const PAD_X = 12;
const PAD_Y = 18;
const FOCUSABLE_LIMIT = 20;

/** Human label for the synthetic zero anchor. */
function pointDate(point: EquityPoint): string {
  return point.dateIso ? fmtShortDate(point.dateIso) : 'Start';
}

/**
 * SVG-only cumulative P&L chart. Hover, keyboard arrows and (for small series)
 * individual point focus all resolve to the same nearest-point readout.
 */
export function EquityCurve({ points }: EquityCurveProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);

  if (points.length <= 1) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/60">
        <p className="px-4 text-center text-sm text-slate-600">
          Not enough settled slips to plot an equity curve yet.
        </p>
      </div>
    );
  }

  const activeIndex = focusIndex ?? hoverIndex;
  const values = points.map((point) => point.value);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = Math.max(1, max - min);
  const step = (WIDTH - PAD_X * 2) / Math.max(1, points.length - 1);
  const toY = (value: number) =>
    PAD_Y + ((max - value) / range) * (HEIGHT - PAD_Y * 2);

  const coordinates = points.map((point, index) => ({
    x: PAD_X + index * step,
    y: toY(point.value),
  }));
  const line = coordinates.map((point) => `${point.x},${point.y}`).join(' ');
  const area = [
    `M ${coordinates[0].x} ${coordinates[0].y}`,
    ...coordinates.slice(1).map((point) => `L ${point.x} ${point.y}`),
    `L ${coordinates[coordinates.length - 1].x} ${HEIGHT - PAD_Y}`,
    `L ${coordinates[0].x} ${HEIGHT - PAD_Y}`,
    'Z',
  ].join(' ');
  const zeroY = toY(0);
  const last = points[points.length - 1];
  const isUp = last.value >= 0;
  const tone = isUp ? '#047857' : '#dc2626';
  const minIndex = values.indexOf(min);
  const maxIndex = values.indexOf(max);
  const showExtremes = min !== max;
  const annotate = points.length <= 5;
  const pointTabbable = points.length <= FOCUSABLE_LIMIT;
  const active = activeIndex === null ? null : points[activeIndex];
  const activeCoordinate =
    activeIndex === null ? null : coordinates[activeIndex];
  const activeDelta = activeIndex === null || activeIndex === 0
    ? 0
    : values[activeIndex] - values[activeIndex - 1];

  const ariaLabel =
    `Equity curve from zero to ${signedMwk(last.value)} over ` +
    `${points.length - 1} settled slips. Lowest ${signedMwk(min)}, ` +
    `highest ${signedMwk(max)}.`;

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const nearest = Math.round((x - PAD_X) / step);
    setHoverIndex(Math.max(0, Math.min(points.length - 1, nearest)));
  }

  function handleKeyDown(event: ReactKeyboardEvent<SVGSVGElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = activeIndex ?? points.length - 1;
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? points.length - 1
          : event.key === 'ArrowRight'
            ? Math.min(points.length - 1, current + 1)
            : Math.max(0, current - 1);
    setFocusIndex(next);
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={ariaLabel}
        className="h-40 w-full"
        preserveAspectRatio="none"
        tabIndex={pointTabbable ? undefined : 0}
        onKeyDown={pointTabbable ? undefined : handleKeyDown}
        onBlur={pointTabbable ? undefined : () => setFocusIndex(null)}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        <line
          x1={PAD_X}
          y1={zeroY}
          x2={WIDTH - PAD_X}
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

        {activeCoordinate && (
          <line
            x1={activeCoordinate.x}
            y1={PAD_Y}
            x2={activeCoordinate.x}
            y2={HEIGHT - PAD_Y}
            stroke="#94a3b8"
            strokeWidth="1"
            strokeDasharray="2 3"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {showExtremes && (
          <>
            <circle
              cx={coordinates[maxIndex].x}
              cy={coordinates[maxIndex].y}
              r="4.5"
              fill="#047857"
              stroke="#ffffff"
              strokeWidth="1.5"
            >
              <title>High · {signedMwk(max)}</title>
            </circle>
            <circle
              cx={coordinates[minIndex].x}
              cy={coordinates[minIndex].y}
              r="4.5"
              fill="#dc2626"
              stroke="#ffffff"
              strokeWidth="1.5"
            >
              <title>Low · {signedMwk(min)}</title>
            </circle>
          </>
        )}

        {coordinates.map((coordinate, index) => (
          <circle
            key={`${points[index].dateIso}-${index}`}
            cx={coordinate.x}
            cy={coordinate.y}
            r={activeIndex === index ? 5 : 2.5}
            fill={tone}
            stroke="#ffffff"
            strokeWidth="1"
            tabIndex={pointTabbable ? 0 : -1}
            role="img"
            aria-label={`${pointDate(points[index])}: ${signedMwk(
              index === 0 ? 0 : values[index] - values[index - 1]
            )} change, cumulative ${signedMwk(values[index])}`}
            onFocus={() => setFocusIndex(index)}
            onBlur={() => setFocusIndex(null)}
            onPointerEnter={() => setHoverIndex(index)}
          >
            <title>
              {pointDate(points[index])} · cumulative {signedMwk(values[index])}
            </title>
          </circle>
        ))}

        {annotate &&
          coordinates.map((coordinate, index) => (
            <text
              key={`label-${points[index].dateIso}-${index}`}
              x={coordinate.x}
              y={coordinate.y > HEIGHT / 2 ? coordinate.y - 8 : coordinate.y + 14}
              textAnchor={
                coordinate.x < 60
                  ? 'start'
                  : coordinate.x > WIDTH - 60
                    ? 'end'
                    : 'middle'
              }
              className="fill-slate-500 font-mono text-xs"
            >
              {signedMwk(values[index])}
            </text>
          ))}
      </svg>

      {active && activeCoordinate && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left text-xs shadow-lg"
          style={{
            left: `${Math.min(88, Math.max(12, (activeCoordinate.x / WIDTH) * 100))}%`,
            top: `${(activeCoordinate.y / HEIGHT) * 100 - 4}%`,
          }}
        >
          <p className="font-semibold text-slate-700">{pointDate(active)}</p>
          <p className="font-mono tabular-nums text-slate-500">
            Δ {signedMwk(activeDelta)} · cum{' '}
            <span className={active.value >= 0 ? 'text-emerald-700' : 'text-red-600'}>
              {signedMwk(active.value)}
            </span>
          </p>
        </div>
      )}

      <div className="mt-1 flex items-center justify-between text-xs text-slate-600">
        <span>{pointDate(points[0])}</span>
        <span>zero line</span>
        <span>{pointDate(last)}</span>
      </div>
    </div>
  );
}
