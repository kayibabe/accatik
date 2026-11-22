import { fmtPercent } from '../../utils/format.ts';

/** Compact hit-rate bar plus value, reused by both analytics tables. */
export function HitRateCell({ value }: { value: number | null }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <div
        className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100"
        aria-hidden="true"
      >
        <div
          className="h-full rounded-full bg-emerald-500"
          style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }}
        />
      </div>
      <span className="w-12 text-right font-mono font-semibold text-slate-800 tabular-nums">
        {fmtPercent(value)}
      </span>
    </div>
  );
}
