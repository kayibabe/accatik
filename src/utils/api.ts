/**
 * Browser API client.
 *
 * The app is local-only: every request goes to the Express server through the
 * same origin's relative `/api` routes (proxied by Vite during development).
 */
export function apiUrl(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function errorFromBody(data: unknown, status: number): string {
  if (data && typeof data === 'object' && 'error' in data) {
    const message = (data as { error: unknown }).error;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return `The API request failed with HTTP ${status}.`;
}

/** Injectable so the request shape and errors can be tested in isolation. */
export interface ApiDependencies {
  fetchFn?: typeof fetch;
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
  deps: ApiDependencies = {}
): Promise<T> {
  let response: Response;
  try {
    const doFetch = deps.fetchFn ?? fetch;
    response = await doFetch(apiUrl(path), init);
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Network error.';
    throw new Error(`Could not reach the API. ${detail}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(
      `The API returned a non-JSON response (HTTP ${response.status}). Check that the local server is running.`
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
