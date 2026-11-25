import { ExternalLink } from 'lucide-react';
import type { GroundingSource } from '../types/fixtures.ts';
import { fmtCount } from '../utils/format.ts';
import { DataCard } from './ui/DataCard.tsx';
import { DataStatus } from './ui/DataStatus.tsx';
import { PageHeader } from './ui/PageHeader.tsx';
import { EmptyState } from './ui/States.tsx';

interface SourcesViewProps {
  sources: GroundingSource[];
  displayDate: string;
  cachedAt: string;
  onGoToSlate: () => void;
}

function retrievalLabel(cachedAt: string): string {
  if (!cachedAt) return 'Retrieved today';
  const parsed = new Date(cachedAt);
  if (Number.isNaN(parsed.getTime())) return 'Retrieved time unknown';
  return `Retrieved ${parsed.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Africa/Blantyre',
  })} CAT`;
}

export function SourcesView({
  sources,
  displayDate,
  cachedAt,
  onGoToSlate,
}: SourcesViewProps) {
  return (
    <section aria-label="Verified Fixture Sources" className="space-y-6">
      <PageHeader
        eyebrow={`${displayDate} · ${retrievalLabel(cachedAt)}`}
        title="Live Schedule & Odds Grounding Sources"
        description="Read-only reference list of the external URLs attached to this slate and to fixture news lookups. Refresh the slate from the fixture board to gather new citations."
        scope="global"
        onBack={onGoToSlate}
      />

      <DataStatus
        source="Fixture schedule & odds grounding"
        mode="Reference"
        capturedAt={cachedAt || null}
        timezone="Africa/Blantyre"
        note={<span className="font-mono tabular-nums">{displayDate}</span>}
      />

      {sources.length === 0 ? (
        <EmptyState
          title="No external grounding URLs attached to this batch"
          description="Open the fixture board and use “Refresh Slate”, or request “Fetch Live Team News” on a fixture, to inspect live search citations here."
          action={
            <button
              type="button"
              onClick={onGoToSlate}
              className="px-4 py-2 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors cursor-pointer"
            >
              Back to Fixture Board
            </button>
          }
        />
      ) : (
        <DataCard
          labelledBy="grounding-sources-title"
          title="Attached citations"
          subtitle={`${fmtCount(sources.length)} ${sources.length === 1 ? 'source' : 'sources'} in this slate`}
          bodyClassName="divide-y divide-slate-200"
        >
          {sources.map((src) => (
            <a
              key={src.uri}
              href={src.uri}
              target="_blank"
              rel="noopener noreferrer"
              title={src.uri}
              aria-label={`Open ${src.title} in a new tab`}
              className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 transition-colors"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">
                  {src.title}
                </p>
                <p className="text-sm font-mono text-slate-500 truncate mt-0.5">
                  {src.uri}
                </p>
              </div>
              <ExternalLink
                className="w-4 h-4 text-slate-600 shrink-0"
                aria-hidden="true"
              />
            </a>
          ))}
        </DataCard>
      )}
    </section>
  );
}
