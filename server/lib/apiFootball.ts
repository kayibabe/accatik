const API_KEY_ENV_ALIASES = [
  'API_FOOTBALL_KEY',
  'API_FOOTBALL_API_KEY',
  'APIFOOTBALL_KEY',
  'FOOTBALL_API_KEY',
  'APISPORTS_KEY',
  'X_APISPORTS_KEY',
  'RAPIDAPI_KEY',
  // VITE_* variables are baked into the client bundle, so the server must
  // never treat one as a source for this secret.
];

export function resolveApiFootballKey(): string | undefined {
  for (const name of API_KEY_ENV_ALIASES) {
    const val = process.env[name]?.trim();
    if (val) return val;
  }
  return undefined;
}

export type ApiProvider = 'apisports' | 'rapidapi';

const BASE_URL_ENV_ALIASES = [
  'API_FOOTBALL_BASE_URL',
  'API_FOOTBALL_API_URL',
  'APIFOOTBALL_BASE_URL',
  'VITE_API_FOOTBALL_BASE_URL',
];

const PROVIDER_BASE_URLS: Record<ApiProvider, string> = {
  apisports: 'https://v3.football.api-sports.io',
  rapidapi: 'https://api-football-v1.p.rapidapi.com/v3',
};

/**
 * Optional self-hosted gateway or regional mirror in front of API-Football.
 * When set it fully replaces provider failover, so the key is only ever sent
 * to the host the operator configured.
 */
export function resolveApiFootballBaseUrl(): string | undefined {
  for (const name of BASE_URL_ENV_ALIASES) {
    const val = process.env[name]?.trim();
    if (!val) continue;

    const trimmed = val.replace(/\/+$/, '');
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new Error(
        `API_FOOTBALL_BASE_URL is not a valid absolute URL ("${trimmed}"). Expected something like https://v3.football.api-sports.io`
      );
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(
        'API_FOOTBALL_BASE_URL must start with http:// or https://.'
      );
    }
    return trimmed;
  }
  return undefined;
}

let detectedProvider: ApiProvider | null = null;

export interface ApiFootballResponse<T> {
  errors?: Record<string, string> | string[];
  paging?: { current?: number; total?: number };
  response?: T[];
}

export interface RawApiFixture {
  fixture: {
    id: number;
    date: string;
    timestamp: number;
    venue?: { name?: string | null; city?: string | null };
    status?: { short?: string; long?: string; elapsed?: number | null };
  };
  league: {
    id: number;
    name: string;
    country: string;
    round?: string;
  };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  goals?: {
    home: number | null;
    away: number | null;
  };
  score?: {
    halftime?: { home: number | null; away: number | null };
    fulltime?: { home: number | null; away: number | null };
  };
}

export interface RawApiOddsItem {
  fixture: { id: number };
  bookmakers: Array<{
    id: number;
    name: string;
    bets: Array<{
      id: number;
      name: string;
      values: Array<{
        value: string;
        odd: string;
      }>;
    }>;
  }>;
}

export interface RawApiPrediction {
  predictions?: {
    winner?: { id?: number; name?: string; comment?: string };
    advice?: string;
    percent?: { home?: string; draw?: string; away?: string };
  };
  teams?: {
    home?: { league?: { form?: string } };
    away?: { league?: { form?: string } };
  };
  comparison?: Record<string, { home?: string; away?: string }>;
  h2h?: Array<{
    teams?: { home?: { name?: string }; away?: { name?: string } };
    goals?: { home?: number | null; away?: number | null };
  }>;
}

export interface RawApiInjury {
  player?: { name?: string; reason?: string; type?: string };
  team?: { name?: string };
}

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * API-Football mixes human-readable text with a short internal code inside
 * `errors` (e.g. `{ token: 'Invalid API key…', error: '4xSe' }`). Drop the
 * code so the surfaced message stays readable.
 */
function formatApiErrors(
  errors?: Record<string, string> | string[]
): string {
  if (!errors) return '';
  if (Array.isArray(errors)) return errors.join('; ');

  const values = Object.values(errors).filter(
    (value): value is string => typeof value === 'string' && value.trim() !== ''
  );
  const readable = values.filter((value) => value.trim().length > 8);
  return (readable.length > 0 ? readable : values).join('; ');
}

/**
 * Calls API-Football v3, transparently falling back between the api-sports.io
 * host and the RapidAPI host on an auth failure, then remembering the winner.
 */
export async function fetchApiFootball<T>(
  endpoint: string,
  params: Record<string, string | number>
): Promise<ApiFootballResponse<T>> {
  const apiKey = resolveApiFootballKey();
  if (!apiKey) {
    throw new Error(
      'API_FOOTBALL_KEY is not configured. Please add your API-Football Pro key as API_FOOTBALL_KEY in Settings > Secrets, then restart or retry.'
    );
  }

  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    query.set(k, String(v));
  }

  const customBaseUrl = resolveApiFootballBaseUrl();

  const callProvider = async (baseUrl: string) => {
    const host = new URL(baseUrl).hostname;
    const isRapidApi = /(^|\.)rapidapi\.com$/i.test(host);
    const headers: Record<string, string> = isRapidApi
      ? {
          'x-rapidapi-key': apiKey,
          'x-rapidapi-host': host,
        }
      : {
          'x-apisports-key': apiKey,
        };

    let res: globalThis.Response;
    try {
      res = await fetch(`${baseUrl}${endpoint}?${query.toString()}`, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut =
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new Error(
        timedOut
          ? `API-Football did not respond within ${
              REQUEST_TIMEOUT_MS / 1000
            }s. Please try again.`
          : 'API-Football is unreachable from this server (network error). Check its outbound internet access and try again.'
      );
    }

    const json = (await res.json().catch(() => ({}))) as ApiFootballResponse<T> & {
      message?: string;
    };

    return { res, json };
  };

  type CallResult = Awaited<ReturnType<typeof callProvider>>;

  const callBuiltIn = (provider: ApiProvider): Promise<CallResult> =>
    callProvider(PROVIDER_BASE_URLS[provider]);

  let res: CallResult['res'];
  let json: CallResult['json'];

  if (customBaseUrl) {
    // An operator-configured host wins outright: no failover, so the key is
    // only ever sent to the API they nominated.
    ({ res, json } = await callProvider(customBaseUrl));
  } else {
    const primaryProvider: ApiProvider = detectedProvider ?? 'apisports';
    ({ res, json } = await callBuiltIn(primaryProvider));

    const hasAuthFailure =
      res.status === 401 ||
      res.status === 403 ||
      (json.errors &&
        !Array.isArray(json.errors) &&
        typeof json.errors === 'object' &&
        ('token' in json.errors || 'key' in json.errors));

    if (hasAuthFailure && !detectedProvider) {
      const fallback: ApiProvider =
        primaryProvider === 'apisports' ? 'rapidapi' : 'apisports';
      // A failed fallback (wrong key, no subscription, or an unreachable host)
      // still leaves the primary provider's auth error as the useful message.
      const retry = await callBuiltIn(fallback).catch(() => null);
      if (
        retry &&
        retry.res.ok &&
        (!retry.json.errors || Array.isArray(retry.json.errors))
      ) {
        detectedProvider = fallback;
        res = retry.res;
        json = retry.json;
      }
    } else if (res.ok && !hasAuthFailure) {
      detectedProvider = primaryProvider;
    }
  }

  if (!res.ok) {
    const detail =
      json?.message || formatApiErrors(json?.errors) || `HTTP ${res.status}`;
    throw new Error(`API-Football request failed: ${detail}`);
  }

  if (json.errors && !Array.isArray(json.errors) && Object.keys(json.errors).length > 0) {
    throw new Error(`API-Football error: ${formatApiErrors(json.errors)}`);
  }

  return json;
}
