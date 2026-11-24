import { TabNav } from '../ui/TabNav.tsx';

export const ANALYTICS_SECTIONS = [
  { id: 'summary', label: 'Summary' },
  { id: 'featured', label: 'Featured' },
  { id: 'markets', label: 'Markets' },
  { id: 'replay', label: 'Replay' },
  { id: 'grade-filter', label: 'Grade filter' },
  { id: 'positive-reads', label: 'Qualifying reads' },
  { id: 'research', label: 'Research' },
] as const;

export type AnalyticsSectionId = (typeof ANALYTICS_SECTIONS)[number]['id'];

/** Unknown or stale deep links land on the summary page. */
export function resolveAnalyticsSection(
  value: string | undefined
): AnalyticsSectionId {
  return ANALYTICS_SECTIONS.some((section) => section.id === value)
    ? (value as AnalyticsSectionId)
    : 'summary';
}

interface AnalyticsSectionNavProps {
  activeId: AnalyticsSectionId;
  onSelect: (id: AnalyticsSectionId) => void;
}

/** Tab strip for the individual analytics pages. */
export function AnalyticsSectionNav({
  activeId,
  onSelect,
}: AnalyticsSectionNavProps) {
  return (
    <TabNav
      items={ANALYTICS_SECTIONS}
      activeId={activeId}
      onSelect={onSelect}
      label="Analytics pages"
    />
  );
}
