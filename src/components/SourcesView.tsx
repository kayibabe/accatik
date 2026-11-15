import { ExternalLink } from 'lucide-react';
import type { GroundingSource } from '../types/fixtures.ts';

interface SourcesViewProps {
  sources: GroundingSource[];
  displayDate: string;
  cachedAt: string;
  onGoToSlate: () => void;
}

export function SourcesView({
  sources,
  displayDate,
  cachedAt,
  onGoToSlate,
}: SourcesViewProps) {
  return (
    <section aria-label="Verified Fixture Sources" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500">
            {displayDate} · Retrieved{' '}
            {cachedAt
              ? `${new Date(cachedAt).toLocaleTimeString('en-GB', {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                  timeZone: 'Africa/Blantyre',
                })} CAT`
              : 'Today'}
          </p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Live Schedule &amp; Odds Grounding Sources
          </h1>
        </div>
        <button
          type="button"
          onClick={onGoToSlate}
          className="self-start sm:self-auto px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors cursor-pointer"
        >
          Back to Today&apos;s Slate
        </button>
      </div>

      {sources.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
          <p className="text-sm font-semibold text-slate-900">
            No external grounding URLs attached to this batch
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Use &ldquo;Refresh Slate&rdquo; or request &ldquo;Fetch Live Team News&rdquo; on any fixture to inspect live search citations.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-200">
          {sources.map((src) => (
            <a
              key={src.uri}
              href={src.uri}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-4 p-4 hover:bg-slate-50 transition-colors"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">
                  {src.title}
                </p>
                <p className="text-xs font-mono text-slate-500 truncate mt-0.5">
                  {src.uri}
                </p>
              </div>
              <ExternalLink
                className="w-4 h-4 text-slate-400 shrink-0"
                aria-hidden="true"
              />
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
