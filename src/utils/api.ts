import { clearJwt, getJwt } from '../lib/appwrite.ts';

/**
 * Browser API client.
 *
 * Locally the app calls the Express server through Vite's relative `/api`
 * routes. On Appwrite the static site calls the deployed Function domain via
 * `VITE_API_BASE_URL`, which Vite embeds at build time. A short-lived Appwrite
 * JWT is attached when the user is signed in.
 */
function apiBaseUrl(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  const configured = String(env.VITE_API_BASE_URL || '')
    .trim()
    .replace(/\/+$/, '');

  // Accept either the function origin or an origin that already ends in /api.
  return configured.endsWith('/api')
    ? configured.slice(0, -4).replace(/\/+$/, '')
    : configured;
}

export function apiUrl(path: string): string {
  const base = apiBaseUrl();
  if (!base) return path;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function errorFromBody(data: unknown, status: number): string {
  if (data && typeof data === 'object' && 'error' in data) {
    const message = (data as { error: unknown }).error;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return `The API request failed with HTTP ${status}.`;
}

/** A protected call failed after refreshing the JWT; the session must be re-established. */
export class SessionExpiredError extends Error {
  constructor() {
    super('Your session has expired. Please sign in again.');
    this.name = 'SessionExpiredError';
  }
}

/** Injectable so JWT refresh and the 401 retry can be tested in isolation. */
export interface ApiDependencies {
  getJwt: (force?: boolean) => Promise<string | null>;
  clearJwt: () => void;
  fetchFn?: typeof fetch;
}

const defaultDependencies: ApiDependencies = { getJwt, clearJwt };

async function send(
  path: string,
  init: RequestInit | undefined,
  jwt: string | null,
  deps: ApiDependencies
): Promise<Response> {
  const headers = new Headers(init?.headers || {});
  if (jwt) headers.set('Authorization', `Bearer ${jwt}`);
  try {
    const doFetch = deps.fetchFn ?? fetch;
    return await doFetch(apiUrl(path), { ...init, headers });
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Network error.';
    throw new Error(`Could not reach the API. ${detail}`);
  }
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
  deps: ApiDependencies = defaultDependencies
): Promise<T> {
  let response = await send(path, init, await deps.getJwt(), deps);

  // A cached JWT can be invalidated by a sign-out or a replacement session.
  // Discard it and retry once with a new one before blaming the user.
  if (response.status === 401) {
    deps.clearJwt();
    const freshJwt = await deps.getJwt(true);
    if (!freshJwt) throw new SessionExpiredError();
    response = await send(path, init, freshJwt, deps);
    if (response.status === 401) throw new SessionExpiredError();
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(
      `The API returned a non-JSON response (HTTP ${response.status}). Check that the backend Function is deployed and configured.`
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error('The API returned invalid JSON.');
  }

  if (!response.ok) {
    throw new Error(errorFromBody(data, response.status));
  }

  return data as T;
}
