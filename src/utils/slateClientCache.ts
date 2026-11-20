import type { DailySlateResponse } from '../types/fixtures.ts';

/**
 * Cross-reload slate cache, keyed by matchday only.
 *
 * Strategy, odds and legs are recomputed locally by `applySlateResponse`, so
 * the exact same server response is valid for every control combination. That
 * makes a date-keyed cache safe and lets a revisited matchday render with zero
 * network traffic. The durable server archive remains the source of truth.
 */

const STORAGE_KEY = 'matchslip_slate_cache_v1';
const OWNER_KEY = 'matchslip_slate_cache_owner_v1';
const TTL_MS = 1000 * 60 * 30;
const MAX_DATES = 8;

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

function isValid(dateIso: string, entry: CachedSlate | undefined): boolean {
  if (!entry || typeof entry.storedAt !== 'number') return false;
  if (Date.now() - entry.storedAt > TTL_MS) return false;
  const response = entry.response;
  return (
    Boolean(response) &&
    response.date === dateIso &&
    Array.isArray(response.fixtures) &&
    typeof response.cachedAt === 'string'
  );
}

export function readCachedSlate(dateIso: string): DailySlateResponse | null {
  const cache = readAll();
  const entry = cache[dateIso];
  if (isValid(dateIso, entry)) return entry.response;
  if (entry) {
    delete cache[dateIso];
    writeAll(cache);
  }
  return null;
}

export function writeCachedSlate(
  dateIso: string,
  response: DailySlateResponse
): void {
  const cache = readAll();
  cache[dateIso] = { storedAt: Date.now(), response };

  const dates = Object.keys(cache).sort(
    (a, b) => cache[b].storedAt - cache[a].storedAt
  );
  for (const stale of dates.slice(MAX_DATES)) delete cache[stale];
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

/** Clears one date, or the whole cache (including its owner) when no date is supplied. */
export function deleteCachedSlate(dateIso?: string): void {
  if (!dateIso) {
    const store = storage();
    store?.removeItem(STORAGE_KEY);
    store?.removeItem(OWNER_KEY);
    return;
  }
  const cache = readAll();
  if (!(dateIso in cache)) return;
  delete cache[dateIso];
  writeAll(cache);
}
