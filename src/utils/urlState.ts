import { ACTIVE_TABS, type ActiveTab } from '../types/navigation.ts';
import type { SlateFilterPresetSelection } from './slateFilterPresets.ts';

/**
 * Small hand-rolled URL state layer. The app has no router dependency, so the
 * tab, date and active filter preset are encoded as query parameters and kept
 * in sync with history. This makes views refresh-safe, shareable and
 * back/forward navigable without changing the navigation model.
 */

export const URL_PARAMS = {
  tab: 'tab',
  date: 'date',
  preset: 'preset',
  section: 'section',
} as const;

export interface AppUrlState {
  tab: ActiveTab;
  date?: string;
  preset?: SlateFilterPresetSelection;
  section?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseAppUrlState(
  search: string,
  fallbackDate?: string
): AppUrlState {
  const params = new URLSearchParams(search);
  const rawTab = params.get(URL_PARAMS.tab);
  const rawDate = params.get(URL_PARAMS.date);
  const rawPreset = params.get(URL_PARAMS.preset);
  const rawSection = params.get(URL_PARAMS.section);

  return {
    tab: ACTIVE_TABS.includes(rawTab as ActiveTab) ? (rawTab as ActiveTab) : 'slate',
    date: rawDate && ISO_DATE.test(rawDate) ? rawDate : fallbackDate,
    preset:
      rawPreset && /^[a-z]+$/.test(rawPreset)
        ? (rawPreset as SlateFilterPresetSelection)
        : undefined,
    section: rawSection && /^[a-z0-9-]+$/.test(rawSection) ? rawSection : undefined,
  };
}

export function buildAppSearch(state: AppUrlState): string {
  const params = new URLSearchParams();
  params.set(URL_PARAMS.tab, state.tab);
  if (state.date && ISO_DATE.test(state.date)) {
    params.set(URL_PARAMS.date, state.date);
  }
  if (state.preset && state.preset !== 'default') {
    params.set(URL_PARAMS.preset, state.preset);
  }
  if (state.section) {
    params.set(URL_PARAMS.section, state.section);
  }
  const search = params.toString();
  return search ? `?${search}` : '';
}

/** Writes the current view state without adding a history entry per keystroke. */
export function writeAppUrl(
  state: AppUrlState,
  options: { replace?: boolean } = {}
): void {
  if (typeof window === 'undefined') return;
  const next = `${window.location.pathname}${buildAppSearch(state)}${window.location.hash}`;
  if (next === `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    return;
  }
  if (options.replace) {
    window.history.replaceState(null, '', next);
  } else {
    window.history.pushState(null, '', next);
  }
}
