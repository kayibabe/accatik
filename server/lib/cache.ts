import type { NextFunction, Request, Response } from 'express';

export interface TtlCache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V, ttlMs?: number): void;
  delete(key: string): void;
  clear(): void;
  readonly size: number;
}

/**
 * Small in-memory TTL cache with expiry pruning and a hard entry cap, so long
 * uptime can't grow the process without bound.
 */
export function createTtlCache<V>(defaultTtlMs: number, maxEntries = 200): TtlCache<V> {
  const store = new Map<string, { value: V; expiresAt: number }>();

  const prune = (now: number) => {
    for (const [key, entry] of store) {
      if (entry.expiresAt <= now) store.delete(key);
    }
  };

  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value, ttlMs = defaultTtlMs) {
      const now = Date.now();
      if (store.size >= maxEntries) prune(now);
      while (store.size >= maxEntries) {
        const oldest = store.keys().next();
        if (oldest.done) break;
        store.delete(oldest.value);
      }
      store.set(key, { value, expiresAt: now + ttlMs });
    },
    delete(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    get size() {
      return store.size;
    },
  };
}

/**
 * Coalesces concurrent identical work (e.g. two browser tabs loading the same
 * date) into one upstream call. This is what keeps a 30-request slate build
 * from being paid for twice.
 */
export function createSingleFlight<T>() {
  const inFlight = new Map<string, Promise<T>>();

  return {
    run(key: string, task: () => Promise<T>): Promise<T> {
      const existing = inFlight.get(key);
      if (existing) return existing;

      const promise = task().finally(() => {
        inFlight.delete(key);
      });
      inFlight.set(key, promise);
      return promise;
    },
  };
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  message?: string;
}

/**
 * Dependency-free sliding-window limiter keyed by client IP. Keeps a single
 * client from draining the API-Football quota.
 */
export function createRateLimiter(options: RateLimitOptions) {
  const hits = new Map<string, number[]>();

  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();
    const windowStart = now - options.windowMs;
    const key = req.ip || req.socket.remoteAddress || 'unknown';

    const recent = (hits.get(key) ?? []).filter((ts) => ts > windowStart);

    if (recent.length >= options.max) {
      const retryAfterSec = Math.max(
        1,
        Math.ceil(((recent[0] ?? now) + options.windowMs - now) / 1000)
      );
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: options.message ?? 'Too many requests. Please try again shortly.',
      });
      return;
    }

    recent.push(now);
    hits.set(key, recent);

    // Opportunistic cleanup so idle clients don't accumulate forever.
    if (hits.size > 5000) {
      for (const [ip, timestamps] of hits) {
        if (!timestamps.some((ts) => ts > windowStart)) hits.delete(ip);
      }
    }

    next();
  };
}
