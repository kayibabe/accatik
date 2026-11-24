/** Every top-level workbench screen, shared by the nav and URL state. */
export type ActiveTab =
  | 'slate'
  | 'pick-guide'
  | 'acca'
  | 'positive-reads'
  | 'saved'
  | 'activity'
  | 'analytics'
  | 'roi'
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
  'roi',
  'ai',
  'sources',
];

export type NavGroupId = 'build' | 'track' | 'analyze' | 'reference';

export interface NavItem {
  id: ActiveTab;
  label: string;
  research?: boolean;
}

export interface NavGroup {
  id: NavGroupId;
  label: string;
  description: string;
  items: readonly NavItem[];
}

/** Grouped by job-to-be-done instead of one flat list of seven peers. */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: 'build',
    label: 'Build',
    description: 'Assemble and review a ticket.',
    items: [
      { id: 'slate', label: 'Matchday Slate' },
      { id: 'pick-guide', label: 'Pick Selection' },
      { id: 'acca', label: 'Ticket Review' },
    ],
  },
  {
    id: 'track',
    label: 'Track',
    description: 'Your saved slips and results.',
    items: [
      { id: 'saved', label: 'Saved Slips' },
      { id: 'activity', label: 'My Activity' },
    ],
  },
  {
    id: 'analyze',
    label: 'Analyze',
    description: 'Global aggregates and research.',
    items: [
      { id: 'analytics', label: 'Analytics' },
      { id: 'positive-reads', label: 'Positive Reads and Analytics', research: true },
      { id: 'ai', label: 'AI Desk', research: true },
    ],
  },
  {
    id: 'reference',
    label: 'Reference',
    description: 'Where the data comes from.',
    items: [{ id: 'sources', label: 'Sources' }],
  },
];
