import {
  ANGLE_FILTERS,
  KICKOFF_WINDOWS,
  MARKET_TYPE_FILTERS,
  MODEL_EDGE_THRESHOLDS,
  PROBABILITY_THRESHOLDS,
  SELECTION_FILTER_KEYS,
} from './slateFilters.ts';
import type { AngleFilter, MarketTypeFilter } from './slateFilters.ts';

/**
 * The slate-filter chips as the user left them.
 *
 * The board keeps this set for the whole session — across date changes, tab
 * switches and refreshes — and mirrors it into localStorage so a reload does
 * not silently widen the slate again. Free-text search is deliberately not
 * stored: a stale query is more confusing than a cleared one.
 */

export interface SlateFilterState {
  angle: AngleFilter;
  marketType: MarketTypeFilter;
  /** Canonical selection keys; empty means every priced outcome. */
  marketSelections: string[];
  minProbability: number;
  minModelEdge: number;
  kickoffWindowHours: number;
  /** Odds are stored as typed so a half-entered price survives a reload. */
  minOddsInput: string;
  maxOddsInput: string;
}

export const DEFAULT_SLATE_FILTER_STATE: SlateFilterState = {
  angle: 'all',
  marketType: 'all',
  marketSelections: [],
  minProbability: 0,
  minModelEdge: 0,
  kickoffWindowHours: 0,
  minOddsInput: '',
  maxOddsInput: '',
};

export const SLATE_FILTER_STORAGE_KEY = 'matchslip:slate-filters:v1';

const MARKET_TYPE_VALUES: readonly string[] = ['all', ...MARKET_TYPE_FILTERS];

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly string[],
  fallback: T
): T {
  return typeof value === 'string' && allowed.includes(value)
    ? (value as T)
    : fallback;
}

function oneOfNumber(
  value: unknown,
  allowed: readonly number[],
  fallback: number
): number {
  return typeof value === 'number' && allowed.includes(value)
    ? value
    : fallback;
}

function oddsText(value: unknown): string {
  return typeof value === 'string' && /^\d{0,4}([.,]\d{0,3})?$/.test(value)
    ? value
    : '';
}

function selectionKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const known = new Set(SELECTION_FILTER_KEYS);
  return [...new Set(value.filter((key): key is string => typeof key === 'string' && known.has(key)))];
}

/** Validates an unknown value (parsed JSON, another tab's write) into a state. */
export function parseSlateFilterState(raw: unknown): SlateFilterState {
  if (!raw || typeof raw !== 'object') return DEFAULT_SLATE_FILTER_STATE;
  const record = raw as Record<string, unknown>;

  return {
    angle: oneOf<AngleFilter>(record.angle, ANGLE_FILTERS, 'all'),
    marketType: oneOf<MarketTypeFilter>(
      record.marketType,
      MARKET_TYPE_VALUES,
      'all'
    ),
    marketSelections: selectionKeys(record.marketSelections),
    minProbability: oneOfNumber(
      record.minProbability,
      PROBABILITY_THRESHOLDS,
      0
    ),
    minModelEdge: oneOfNumber(record.minModelEdge, MODEL_EDGE_THRESHOLDS, 0),
    kickoffWindowHours: oneOfNumber(
      record.kickoffWindowHours,
      KICKOFF_WINDOWS,
      0
    ),
    minOddsInput: oddsText(record.minOddsInput),
    maxOddsInput: oddsText(record.maxOddsInput),
  };
}

/** localStorage, or null when the browser blocks it (private mode, SSR, tests). */
function availableStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadSlateFilterState(
  storage: Storage | null = availableStorage()
): SlateFilterState {
  if (!storage) return DEFAULT_SLATE_FILTER_STATE;

  try {
    const raw = storage.getItem(SLATE_FILTER_STORAGE_KEY);
    if (!raw) return DEFAULT_SLATE_FILTER_STATE;
    return parseSlateFilterState(JSON.parse(raw));
  } catch {
    return DEFAULT_SLATE_FILTER_STATE;
  }
}

export function saveSlateFilterState(
  state: SlateFilterState,
  storage: Storage | null = availableStorage()
): void {
  if (!storage) return;

  try {
    storage.setItem(SLATE_FILTER_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota or private mode: the in-memory filters still work this session.
  }
}
