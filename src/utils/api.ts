import { getJwt } from '../lib/appwrite.ts';

/**
 * Browser API client.
 *
 * Locally the app calls the Express server through Vite's relative `/api`
 * routes. On Appwrite the static site calls the deployed Function domain via
 * `VITE_API_BASE_URL`, which Vite embeds at build time. A short-lived Appwrite
 * JWT is attached when the user is signed in.
 */
function apiBaseUrl(): string {
  const configured = String(import.meta.env.VITE_API_BASE_URL || '')
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

export async function apiFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const headers = new Headers(init?.headers || {});
  const jwt = await getJwt();
  if (jwt) headers.set('Authorization', `Bearer ${jwt}`);

  let response: Response;
  try {
    response = await fetch(apiUrl(path), { ...init, headers });
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Network error.';
    throw new Error(`Could not reach the API. ${detail}`);
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
