/** Every top-level workbench screen, shared by the nav and URL state. */
export type ActiveTab =
  | 'slate'
  | 'pick-guide'
  | 'acca'
  | 'positive-reads'
  | 'roi-research'
  | 'saved'
  | 'activity'
  | 'analytics'
  | 'ai'
  | 'sources';

export const ACTIVE_TABS: readonly ActiveTab[] = [
  'slate',
  'pick-guide',
  'acca',
  'positive-reads',
  'roi-research',
  'saved',
  'activity',
  'analytics',
  'ai',
  'sources',
];

export type NavGroupId = 'build' | 'review' | 'research';

export interface NavItem {
  id: ActiveTab;
  label: string;
}

export interface NavGroup {
  id: NavGroupId;
  label: string;
  description: string;
  items: readonly NavItem[];
}

/** Three destinations by job-to-be-done, with no separate reference silo. */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: 'build',
    label: 'Build',
    description: 'Assemble and stress-test a ticket.',
    items: [
      { id: 'slate', label: 'Matchday Slate' },
      { id: 'pick-guide', label: 'Pick Shortlist' },
      { id: 'acca', label: 'Ticket Builder' },
    ],
  },
  {
    id: 'review',
    label: 'Review',
    description: 'Track saved slips, results and aggregates.',
    items: [
      { id: 'saved', label: 'Saved Slips' },
      { id: 'activity', label: 'My Performance' },
      { id: 'analytics', label: 'Analytics' },
    ],
  },
  {
    id: 'research',
    label: 'Research',
    description: 'Read-only studies and data provenance.',
    items: [
      { id: 'positive-reads', label: 'Positive Reads' },
      { id: 'roi-research', label: 'Promoted ROI Picks' },
      { id: 'ai', label: 'AI Desk' },
      { id: 'sources', label: 'Sources' },
    ],
  },
];
