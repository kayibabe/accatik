import { SectionNav } from '../ui/DataStatus.tsx';

export const ANALYTICS_SECTIONS = [
  { id: 'summary', label: 'Summary' },
  { id: 'featured', label: 'Featured' },
  { id: 'markets', label: 'Markets' },
  { id: 'replay', label: 'Replay' },
  { id: 'positive-reads', label: 'Positive reads' },
  { id: 'research', label: 'Research' },
] as const;

/** Sticky in-page navigation for the long global analytics screen. */
export function AnalyticsSectionNav() {
  return <SectionNav items={ANALYTICS_SECTIONS} label="Analytics sections" />;
}
