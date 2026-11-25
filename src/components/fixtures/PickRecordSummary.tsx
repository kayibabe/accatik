import type { PickRecordsResponse } from '../../types/fixtures.ts';
import { fmtPercent } from '../../utils/format.ts';

/** Archive-backed hit rates for the active strategy's three pick types. */
export function PickRecordSummary({
  records,
  sampleDates,
  sampleFixtures,
}: PickRecordsResponse) {
  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/50 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-violet-800">
          Historical pick record
        </p>
        <span
          className="text-xs text-violet-700"
          title="Rebuilt from archived prices with the active strategy, then settled from each finished match's final score. Voids are excluded from the percentage."
        >
          {sampleFixtures} finished matches · {sampleDates} matchdays
        </span>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {records.map((entry) => (
          <div
            key={entry.key}
            className="flex items-center justify-between gap-2 rounded-md border border-violet-100 bg-white/80 px-2.5 py-1.5"
          >
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-slate-700">
                {entry.label}
              </p>
              <p className="font-mono text-xs tabular-nums text-slate-500">
                {entry.settled === 0
                  ? 'No settled matches yet'
                  : `${entry.wins}W / ${entry.losses}L${
                      entry.voids > 0 ? ` / ${entry.voids}V` : ''
                    }`}
              </p>
            </div>
            <span className="font-mono text-sm font-semibold tabular-nums text-violet-900">
              {entry.hitRate === null ? '—' : fmtPercent(entry.hitRate, 1)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
