/** Every top-level workbench screen, shared by the nav and URL state. */
export type ActiveTab =
  | 'slate'
  | 'pick-guide'
  | 'acca'
  | 'positive-reads'
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
      { id: 'pick-guide', label: 'Pick Selection' },
      { id: 'acca', label: 'Ticket Review' },
    ],
  },
  {
    id: 'review',
    label: 'Review',
    description: 'Track saved slips, results and aggregates.',
    items: [
      { id: 'saved', label: 'Saved Slips' },
      { id: 'activity', label: 'My Activity' },
      { id: 'analytics', label: 'Analytics' },
    ],
  },
  {
    id: 'research',
    label: 'Research',
    description: 'Read-only studies and data provenance.',
    items: [
      { id: 'positive-reads', label: 'Positive Reads' },
      { id: 'ai', label: 'AI Desk' },
      { id: 'sources', label: 'Sources' },
    ],
  },
];
