import type { AccaStrategy, DailySlateResponse } from '../types/fixtures.ts';

/**
 * Cross-reload slate cache, keyed by matchday *and* the controls that shape the
 * response. DailySlateResponse carries control-derived fields (strategy,
 * minOdds, recommendedLegIds, ticketGuard), so a date-only key can hand a
 * different control combination to the UI. Revisiting a matchday with the same
 * controls still renders with zero network traffic; the durable server archive
 * remains the source of truth.
 */

const STORAGE_KEY = 'matchslip_slate_cache_v1';
const OWNER_KEY = 'matchslip_slate_cache_owner_v1';
const TTL_MS = 1000 * 60 * 30;
const MAX_DATES = 8;

export interface SlateCacheControls {
  strategy: AccaStrategy;
  minOdds: number;
  maxLegs?: number;
}

const DEFAULT_CONTROLS: Required<SlateCacheControls> = {
  strategy: 'balanced',
  minOdds: 2.8,
  maxLegs: 3,
};

function normalizeControls(controls?: SlateCacheControls): Required<SlateCacheControls> {
  return {
    strategy: controls?.strategy ?? DEFAULT_CONTROLS.strategy,
    minOdds: controls?.minOdds ?? DEFAULT_CONTROLS.minOdds,
    maxLegs: controls?.maxLegs ?? DEFAULT_CONTROLS.maxLegs,
  };
}

/** Storage key for one matchday under one set of slate controls. */
export function slateCacheKey(
  dateIso: string,
  controls?: SlateCacheControls
): string {
  const { strategy, minOdds, maxLegs } = normalizeControls(controls);
  return `${dateIso}|${strategy}|${minOdds}|${maxLegs}`;
}

interface CachedSlate {
  storedAt: number;
  response: DailySlateResponse;
}

type SlateCache = Record<string, CachedSlate>;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readAll(): SlateCache {
  const store = storage();
  if (!store) return {};
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as SlateCache)
      : {};
  } catch {
    return {};
  }
}

function writeAll(cache: SlateCache): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Storage quota: keep only the most recent entries rather than losing the
    // whole cache. A second failure simply leaves the previous value in place.
    const kept = Object.entries(cache)
      .sort((a, b) => b[1].storedAt - a[1].storedAt)
      .slice(0, 3);
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)));
    } catch {
      // Storage is unavailable; network requests still work.
    }
  }
}

function isValid(
  dateIso: string,
  controls: Required<SlateCacheControls>,
  entry: CachedSlate | undefined
): boolean {
  if (!entry || typeof entry.storedAt !== 'number') return false;
  if (Date.now() - entry.storedAt > TTL_MS) return false;
  const response = entry.response;
  return (
    Boolean(response) &&
    response.date === dateIso &&
    response.strategy === controls.strategy &&
    response.minOdds === controls.minOdds &&
    Array.isArray(response.fixtures) &&
    Array.isArray(response.recommendedLegIds) &&
    typeof response.cachedAt === 'string'
  );
}

export function readCachedSlate(
  dateIso: string,
  controls?: SlateCacheControls
): DailySlateResponse | null {
  const key = slateCacheKey(dateIso, controls);
  const cache = readAll();
  const entry = cache[key];
  if (isValid(dateIso, normalizeControls(controls), entry)) return entry.response;
  if (entry) {
    delete cache[key];
    writeAll(cache);
  }
  return null;
}

export function writeCachedSlate(
  dateIso: string,
  response: DailySlateResponse,
  controls?: SlateCacheControls
): void {
  const cache = readAll();
  cache[slateCacheKey(dateIso, controls)] = { storedAt: Date.now(), response };

  const keys = Object.keys(cache).sort(
    (a, b) => cache[b].storedAt - cache[a].storedAt
  );
  for (const stale of keys.slice(MAX_DATES)) delete cache[stale];
  writeAll(cache);
}

/** The account whose priced slates are currently stored, if any. */
export function getCachedSlateOwner(): string | null {
  try {
    return storage()?.getItem(OWNER_KEY) ?? null;
  } catch {
    return null;
  }
}

export function setCachedSlateOwner(owner: string): void {
  try {
    storage()?.setItem(OWNER_KEY, owner);
  } catch {
    // Storage unavailable; the network path remains authoritative.
  }
}

/** Clears every control variant of one date, or the whole cache (including its owner) when no date is supplied. */
export function deleteCachedSlate(dateIso?: string): void {
  if (!dateIso) {
    const store = storage();
    store?.removeItem(STORAGE_KEY);
    store?.removeItem(OWNER_KEY);
    return;
  }
  const cache = readAll();
  let removed = false;
  for (const key of Object.keys(cache)) {
    if (key === dateIso || key.startsWith(`${dateIso}|`)) {
      delete cache[key];
      removed = true;
    }
  }
  if (removed) writeAll(cache);
}
