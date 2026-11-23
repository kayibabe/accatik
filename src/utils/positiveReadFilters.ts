import type {
  FeaturedPickSource,
  PositiveReadCombo,
  PositiveReadMatch,
  PositiveReadMatchesResponse,
  PositiveReadPick,
  RoiBand,
} from '../types/analytics.ts';

/**
 * Drill-down state for the daily positive-read feed.
 *
 * The study already returns every dimension we need (section, band, market,
 * sample size, ROI), so filtering stays client-side and the archived/live
 * endpoint is untouched. Selections are mirrored to localStorage so a reload
 * does not silently widen the feed again.
 */
export type PositiveReadSmallSampleMode = 'all' | 'exclude' | 'only';

/**
 * Evidence gate. Observed is the raw positive set the table's Positive toggle
 * shows; Qualified adds the interval and sample bar; Confirmed adds survival of
 * a prior-cutoff study.
 */
export type PositiveReadQualityMode = 'all' | 'qualified' | 'confirmed';

export interface PositiveReadFilterState {
  section: 'all' | FeaturedPickSource;
  band: 'all' | RoiBand;
  marketKey: 'all' | string;
  smallSample: PositiveReadSmallSampleMode;
  quality: PositiveReadQualityMode;
  /** Minimum inception-to-date ROI in percentage points; null means no floor. */
  minRoi: number | null;
  /** Free text over team, competition and country; not part of combo selection. */
  query: string;
}

export const DEFAULT_POSITIVE_READ_FILTERS: PositiveReadFilterState = {
  section: 'all',
  band: 'all',
  marketKey: 'all',
  smallSample: 'all',
  quality: 'all',
  minRoi: null,
  query: '',
};

export const POSITIVE_READ_FILTER_STORAGE_KEY =
  'matchslip:positive-read-filters:v1';

export const POSITIVE_READ_BAND_VALUES: readonly RoiBand[] = [
  'High',
  'Solid',
  'Moderate',
  'Speculative',
];

const SECTION_VALUES: readonly string[] = ['all', 'angle', 'cover', 'note'];
const BAND_VALUES: readonly string[] = ['all', ...POSITIVE_READ_BAND_VALUES];
const SAMPLE_VALUES: readonly string[] = ['all', 'exclude', 'only'];
const QUALITY_VALUES: readonly string[] = ['all', 'qualified', 'confirmed'];

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly string[],
  fallback: T
): T {
  return typeof value === 'string' && allowed.includes(value)
    ? (value as T)
    : fallback;
}

function roiFloor(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 10000
    ? Math.round(value * 10) / 10
    : null;
}

function shortText(value: unknown): string {
  return typeof value === 'string' && value.length <= 120
    ? value.trim()
    : '';
}

/** Validates an unknown value (parsed JSON, another tab's write) into a state. */
export function parsePositiveReadFilters(raw: unknown): PositiveReadFilterState {
  if (!raw || typeof raw !== 'object') return DEFAULT_POSITIVE_READ_FILTERS;
  const record = raw as Record<string, unknown>;

  return {
    section: oneOf<'all' | FeaturedPickSource>(
      record.section,
      SECTION_VALUES,
      'all'
    ),
    band: oneOf<'all' | RoiBand>(record.band, BAND_VALUES, 'all'),
    marketKey: shortText(record.marketKey) || 'all',
    smallSample: oneOf<PositiveReadSmallSampleMode>(
      record.smallSample,
      SAMPLE_VALUES,
      'all'
    ),
    quality: oneOf<PositiveReadQualityMode>(
      record.quality,
      QUALITY_VALUES,
      'all'
    ),
    minRoi: roiFloor(record.minRoi),
    query: shortText(record.query),
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

export function loadPositiveReadFilters(
  storage: Storage | null = availableStorage()
): PositiveReadFilterState {
  if (!storage) return DEFAULT_POSITIVE_READ_FILTERS;

  try {
    const raw = storage.getItem(POSITIVE_READ_FILTER_STORAGE_KEY);
    if (!raw) return DEFAULT_POSITIVE_READ_FILTERS;
    return parsePositiveReadFilters(JSON.parse(raw));
  } catch {
    return DEFAULT_POSITIVE_READ_FILTERS;
  }
}

export function savePositiveReadFilters(
  state: PositiveReadFilterState,
  storage: Storage | null = availableStorage()
): void {
  if (!storage) return;

  try {
    storage.setItem(POSITIVE_READ_FILTER_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota or private mode: the in-memory drill-down still works this session.
  }
}

export function samePositiveReadFilters(
  a: PositiveReadFilterState,
  b: PositiveReadFilterState
): boolean {
  return (
    a.section === b.section &&
    a.band === b.band &&
    a.marketKey === b.marketKey &&
    a.smallSample === b.smallSample &&
    a.quality === b.quality &&
    a.minRoi === b.minRoi &&
    a.query === b.query
  );
}

export function activePositiveReadFilterCount(
  state: PositiveReadFilterState
): number {
  return (
    (state.section !== 'all' ? 1 : 0) +
    (state.band !== 'all' ? 1 : 0) +
    (state.marketKey !== 'all' ? 1 : 0) +
    (state.smallSample !== 'all' ? 1 : 0) +
    (state.quality !== 'all' ? 1 : 0) +
    (state.minRoi !== null ? 1 : 0) +
    (state.query.trim() ? 1 : 0)
  );
}

type ComboDimension =
  | 'section'
  | 'band'
  | 'marketKey'
  | 'sample'
  | 'quality'
  | 'roi';

/** One predicate for chips, facet counts and the match list. */
export function matchesPositiveReadCombo(
  combo: PositiveReadCombo,
  state: PositiveReadFilterState,
  ignore?: ComboDimension
): boolean {
  if (
    ignore !== 'section' &&
    state.section !== 'all' &&
    combo.section !== state.section
  ) {
    return false;
  }
  if (
    ignore !== 'band' &&
    state.band !== 'all' &&
    combo.band !== state.band
  ) {
    return false;
  }
  if (
    ignore !== 'marketKey' &&
    state.marketKey !== 'all' &&
    combo.marketKey !== state.marketKey
  ) {
    return false;
  }
  if (ignore !== 'sample') {
    if (state.smallSample === 'exclude' && combo.smallSample) return false;
    if (state.smallSample === 'only' && !combo.smallSample) return false;
  }
  if (ignore !== 'quality') {
    if (state.quality === 'qualified' && !combo.qualified) return false;
    if (state.quality === 'confirmed' && !combo.confirmed) return false;
  }
  if (
    ignore !== 'roi' &&
    state.minRoi !== null &&
    (combo.roi === null || combo.roi < state.minRoi)
  ) {
    return false;
  }
  return true;
}

/** The strongest badge a positive combo has earned, strongest first. */
export type PositiveReadTier =
  | 'confirmed'
  | 'qualified'
  | 'observed'
  | 'small-sample';

export function positiveReadTier(combo: PositiveReadCombo): PositiveReadTier {
  if (combo.confirmed) return 'confirmed';
  if (combo.qualified) return 'qualified';
  return combo.smallSample ? 'small-sample' : 'observed';
}

export interface PositiveReadOption<Id extends string = string> {
  id: Id;
  label: string;
  count: number;
}

export interface PositiveReadOptions {
  sections: PositiveReadOption<'all' | FeaturedPickSource>[];
  bands: PositiveReadOption<'all' | RoiBand>[];
  markets: PositiveReadOption<string>[];
  quality: PositiveReadOption<PositiveReadQualityMode>[];
}

/**
 * Faceted option counts: each dimension is counted with the other dimensions
 * applied, so the UI can show how many rows a choice would add without an
 * option collapsing to zero because of its own current selection.
 */
export function derivePositiveReadOptions(
  combos: readonly PositiveReadCombo[],
  state: PositiveReadFilterState
): PositiveReadOptions {
  const sections = new Map<FeaturedPickSource, { label: string; count: number }>();
  const bands = new Map<RoiBand, number>();
  const markets = new Map<string, { label: string; count: number }>();
  let allSections = 0;
  let allBands = 0;
  let allMarkets = 0;
  let anyQuality = 0;
  let qualified = 0;
  let confirmed = 0;

  for (const combo of combos) {
    if (matchesPositiveReadCombo(combo, state, 'section')) {
      allSections += 1;
      const current = sections.get(combo.section);
      sections.set(combo.section, {
        label: combo.sectionLabel,
        count: (current?.count ?? 0) + 1,
      });
    }
    if (matchesPositiveReadCombo(combo, state, 'band')) {
      allBands += 1;
      bands.set(combo.band, (bands.get(combo.band) ?? 0) + 1);
    }
    if (matchesPositiveReadCombo(combo, state, 'marketKey')) {
      allMarkets += 1;
      const current = markets.get(combo.marketKey);
      markets.set(combo.marketKey, {
        label: combo.marketLabel,
        count: (current?.count ?? 0) + 1,
      });
    }
    if (matchesPositiveReadCombo(combo, state, 'quality')) {
      anyQuality += 1;
      if (combo.qualified) qualified += 1;
      if (combo.confirmed) confirmed += 1;
    }
  }

  // Keep the current choice visible even when other filters leave it at zero.
  if (state.section !== 'all' && !sections.has(state.section)) {
    sections.set(state.section, { label: sectionLabel(state.section), count: 0 });
  }
  if (state.band !== 'all' && !bands.has(state.band)) {
    bands.set(state.band, 0);
  }
  if (state.marketKey !== 'all' && !markets.has(state.marketKey)) {
    markets.set(state.marketKey, { label: state.marketKey, count: 0 });
  }

  return {
    sections: [
      { id: 'all', label: 'All sections', count: allSections },
      ...[...sections.entries()]
        .map(([id, item]) => ({ id, label: item.label, count: item.count }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ],
    bands: [
      { id: 'all', label: 'All bands', count: allBands },
      ...POSITIVE_READ_BAND_VALUES.filter((band) => bands.has(band)).map(
        (band) => ({ id: band, label: band, count: bands.get(band) ?? 0 })
      ),
      ...[...bands.keys()]
        .filter((band) => !POSITIVE_READ_BAND_VALUES.includes(band))
        .map((band) => ({ id: band, label: band, count: bands.get(band) ?? 0 })),
    ],
    markets: [
      { id: 'all', label: 'All markets', count: allMarkets },
      ...[...markets.entries()]
        .map(([id, item]) => ({ id, label: item.label, count: item.count }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ],
    quality: [
      { id: 'all', label: 'Any evidence', count: anyQuality },
      { id: 'qualified', label: 'Qualified', count: qualified },
      { id: 'confirmed', label: 'Confirmed', count: confirmed },
    ],
  };
}

function sectionLabel(section: FeaturedPickSource): string {
  if (section === 'angle') return 'Model angle';
  if (section === 'cover') return 'Alternative cover';
  return 'Research note';
}

/**
 * Drops saved dimensions that no longer have a row in the feed.
 *
 * Validate the saved *combination* (not just each value in isolation), then
 * re-check after every reset. Sample size, quality and ROI are ignored here:
 * they are gates the user can loosen, whereas a section/band/market that no
 * longer exists in the study has nothing to loosen to. Clearing a section or
 * band also clears the market, mirroring the UI cascade.
 */
export function reconcilePositiveReadFilters(
  state: PositiveReadFilterState,
  combos: readonly PositiveReadCombo[]
): PositiveReadFilterState {
  const hasVisibleCombo = (candidate: PositiveReadFilterState) =>
    combos.some((combo) =>
      matchesPositiveReadCombo(combo, {
        ...candidate,
        smallSample: 'all',
        quality: 'all',
        minRoi: null,
      })
    );

  let next = { ...state };
  if (next.section !== 'all' && !hasVisibleCombo(next)) {
    next = { ...next, section: 'all', marketKey: 'all' };
  }
  if (next.band !== 'all' && !hasVisibleCombo(next)) {
    next = { ...next, band: 'all', marketKey: 'all' };
  }
  if (next.marketKey !== 'all' && !hasVisibleCombo(next)) {
    next = { ...next, marketKey: 'all' };
  }
  return next;
}

function matchesMatchQuery(match: PositiveReadMatch, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [match.homeTeam, match.awayTeam, match.competition, match.country].some(
    (value) => value.toLowerCase().includes(needle)
  );
}

export interface FilteredPositiveReads {
  combos: PositiveReadCombo[];
  matches: PositiveReadMatch[];
  /** Pending picks from the visible matches only, ready for the slip. */
  eligiblePicks: PositiveReadPick[];
}

/**
 * Applies the drill-down once, keeping each match's combos and picks aligned by
 * `comboKey` so a Build-page slip can never contain a market that is not on the
 * card the user clicked.
 */
export function applyPositiveReadFilters(
  data: PositiveReadMatchesResponse,
  state: PositiveReadFilterState
): FilteredPositiveReads {
  const combos = data.combos.filter((combo) =>
    matchesPositiveReadCombo(combo, state)
  );

  const matches: PositiveReadMatch[] = [];
  const eligiblePicks: PositiveReadPick[] = [];
  for (const match of data.matches) {
    const matchCombos = match.combos.filter((combo) =>
      matchesPositiveReadCombo(combo, state)
    );
    if (matchCombos.length === 0) continue;
    if (!matchesMatchQuery(match, state.query)) continue;

    const keys = new Set(matchCombos.map((combo) => combo.key));
    const matchPicks = match.picks.filter((pick) => keys.has(pick.comboKey));
    matches.push({ ...match, combos: matchCombos, picks: matchPicks });
    eligiblePicks.push(
      ...matchPicks.filter((pick) => pick.status === 'Pending')
    );
  }

  return { combos, matches, eligiblePicks };
}

export interface PositiveReadComboGroup {
  sectionLabel: string;
  combos: PositiveReadCombo[];
}

/** Section headings for the flat parameter chips, in study order. */
export function groupPositiveReadCombos(
  combos: readonly PositiveReadCombo[]
): PositiveReadComboGroup[] {
  const groups: PositiveReadComboGroup[] = [];
  for (const combo of combos) {
    let group = groups.find((item) => item.sectionLabel === combo.sectionLabel);
    if (!group) {
      group = { sectionLabel: combo.sectionLabel, combos: [] };
      groups.push(group);
    }
    group.combos.push(combo);
  }
  return groups;
}
