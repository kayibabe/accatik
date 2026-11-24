import test from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, apiUrl, type ApiDependencies } from './api.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function dependencies(responses: Response[]): {
  deps: ApiDependencies;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let index = 0;
  return {
    deps: {
      fetchFn: async (input, init) => {
        calls.push({ url: String(input), init });
        return responses[Math.min(index++, responses.length - 1)];
      },
    },
    calls,
  };
}

test('apiUrl keeps local requests relative to the current origin', () => {
  assert.equal(apiUrl('/api/fixtures/today'), '/api/fixtures/today');
  assert.equal(apiUrl('api/health'), '/api/health');
});

test('apiFetch returns the parsed body without attaching credentials', async () => {
  const { deps, calls } = dependencies([jsonResponse({ ok: true })]);

  const result = await apiFetch<{ ok: boolean }>('/api/health', undefined, deps);

  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/health');
  assert.equal(new Headers(calls[0].init?.headers).get('authorization'), null);
});

test('apiFetch forwards method, body and abort signal', async () => {
  const controller = new AbortController();
  const { deps, calls } = dependencies([jsonResponse({ saved: true })]);
  const body = JSON.stringify({ tickets: [] });

  await apiFetch(
    '/api/tickets',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    },
    deps
  );

  assert.equal(calls[0].init?.method, 'POST');
  assert.equal(calls[0].init?.body, body);
  assert.equal(calls[0].init?.signal, controller.signal);
});

test('API errors keep their server message and are not retried', async () => {
  const { deps, calls } = dependencies([
    jsonResponse({ error: 'Unknown API endpoint.' }, 404),
    jsonResponse({ ok: true }),
  ]);

  await assert.rejects(
    () => apiFetch('/api/missing', undefined, deps),
    (err: unknown) => {
      assert.equal(err instanceof Error && err.message, 'Unknown API endpoint.');
      return true;
    }
  );
  assert.equal(calls.length, 1);
});

test('a non-JSON response produces an actionable local-server error', async () => {
  const { deps } = dependencies([
    new Response('<h1>Not found</h1>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    }),
  ]);

  await assert.rejects(
    () => apiFetch('/api/health', undefined, deps),
    /Check that the local server is running/i
  );
});
