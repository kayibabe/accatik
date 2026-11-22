import {
  DEFAULT_SLATE_FILTER_STATE,
  type SlateFilterState,
} from './slateFilterState.ts';

export const SLATE_FILTER_PRESET_IDS = [
  'default',
  'safe',
  'value',
  'short',
  'probability',
] as const;

export type SlateFilterPresetId = (typeof SLATE_FILTER_PRESET_IDS)[number];
export type SlateFilterPresetSelection = SlateFilterPresetId | 'custom';

export interface SlateFilterPreset {
  id: SlateFilterPresetId;
  label: string;
  description: string;
  filters: SlateFilterState;
}

export const SLATE_FILTER_PRESETS: readonly SlateFilterPreset[] = [
  {
    id: 'default',
    label: 'Default',
    description: 'Every fixture on the matchday, priced or not.',
    filters: DEFAULT_SLATE_FILTER_STATE,
  },
  {
    id: 'safe',
    label: 'Safe',
    description: 'High-confidence angle and cover with a 70%+ fair chance.',
    filters: {
      ...DEFAULT_SLATE_FILTER_STATE,
      angle: 'High',
      cover: 'High',
      minProbability: 70,
    },
  },
  {
    id: 'value',
    label: 'Value',
    description: 'At least +5 points of model edge over the book.',
    filters: { ...DEFAULT_SLATE_FILTER_STATE, minModelEdge: 5 },
  },
  {
    id: 'short',
    label: 'Short kickoff',
    description: 'Matches starting within the next two hours.',
    filters: { ...DEFAULT_SLATE_FILTER_STATE, kickoffWindowHours: 2 },
  },
  {
    id: 'probability',
    label: 'High probability',
    description: 'Markets with an 80%+ fair chance.',
    filters: { ...DEFAULT_SLATE_FILTER_STATE, minProbability: 80 },
  },
];

export const SLATE_FILTER_PRESET_STORAGE_KEY = 'matchslip:slate-preset:v1';

/** Which dimensions live behind the "Advanced filters" disclosure. */
export const ADVANCED_FILTER_KEYS = [
  'angle',
  'cover',
  'note',
  'minModelEdge',
  'kickoffWindowHours',
  'minOddsInput',
  'maxOddsInput',
] as const;

export function presetFilters(id: SlateFilterPresetId): SlateFilterState {
  const preset = SLATE_FILTER_PRESETS.find((item) => item.id === id);
  const source = preset?.filters ?? DEFAULT_SLATE_FILTER_STATE;
  return { ...source, marketSelections: [...source.marketSelections] };
}

/** Friendly name for the current filter set, or `custom` when it was edited. */
export function detectFilterPreset(
  filters: SlateFilterState
): SlateFilterPresetSelection {
  const match = SLATE_FILTER_PRESETS.find((preset) =>
    Object.keys(DEFAULT_SLATE_FILTER_STATE).every((key) => {
      const current = filters[key as keyof SlateFilterState];
      const expected = preset.filters[key as keyof SlateFilterState];
      return Array.isArray(current) && Array.isArray(expected)
        ? current.length === expected.length &&
            current.every((value, index) => value === expected[index])
        : current === expected;
    })
  );
  return match?.id ?? 'custom';
}

export function activeFilterCount(
  filters: SlateFilterState,
  scope: 'all' | 'advanced' = 'all'
): number {
  const keys = (
    scope === 'advanced' ? ADVANCED_FILTER_KEYS : Object.keys(DEFAULT_SLATE_FILTER_STATE)
  ) as ReadonlyArray<keyof SlateFilterState>;

  return keys.reduce((count, key) => {
    const value = filters[key];
    const defaultValue = DEFAULT_SLATE_FILTER_STATE[key];
    if (Array.isArray(value)) return count + (value.length > 0 ? 1 : 0);
    if (typeof value === 'string') {
      return count + (value !== '' && value !== defaultValue ? 1 : 0);
    }
    return count + (value !== defaultValue ? 1 : 0);
  }, 0);
}

function availableStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadPresetPreference(
  storage: Storage | null = availableStorage()
): SlateFilterPresetSelection {
  if (!storage) return 'default';
  try {
    const raw = storage.getItem(SLATE_FILTER_PRESET_STORAGE_KEY);
    return raw && SLATE_FILTER_PRESET_IDS.includes(raw as SlateFilterPresetId)
      ? (raw as SlateFilterPresetId)
      : 'default';
  } catch {
    return 'default';
  }
}

export function savePresetPreference(
  id: SlateFilterPresetSelection,
  storage: Storage | null = availableStorage()
): void {
  if (!storage) return;
  try {
    if (id === 'custom') {
      storage.removeItem(SLATE_FILTER_PRESET_STORAGE_KEY);
    } else {
      storage.setItem(SLATE_FILTER_PRESET_STORAGE_KEY, id);
    }
  } catch {
    // Private mode: the in-memory selection still works this session.
  }
}
