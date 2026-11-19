import test from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, SessionExpiredError, type ApiDependencies } from './api.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function dependencies(options: {
  tokens: Array<string | null>;
  responses: Response[];
}): {
  deps: ApiDependencies;
  authHeaders: Array<string | null>;
  counters: { forced: number; cleared: number };
} {
  let index = 0;
  let tokenIndex = 0;
  const authHeaders: Array<string | null> = [];
  const counters = { forced: 0, cleared: 0 };
  const deps: ApiDependencies = {
    getJwt: async (force = false) => {
      if (force) counters.forced += 1;
      return options.tokens[Math.min(tokenIndex++, options.tokens.length - 1)];
    },
    clearJwt: () => {
      counters.cleared += 1;
    },
    fetchFn: async (_input, init) => {
      const headers = new Headers(init?.headers);
      authHeaders.push(headers.get('authorization'));
      return options.responses[Math.min(index++, options.responses.length - 1)];
    },
  };
  return { deps, authHeaders, counters };
}

test('apiFetch attaches the JWT and returns the parsed body', async () => {
  const { deps, authHeaders } = dependencies({
    tokens: ['jwt-1'],
    responses: [jsonResponse({ role: 'admin' })],
  });

  const result = await apiFetch<{ role: string }>('/api/account/me', undefined, deps);

  assert.deepEqual(result, { role: 'admin' });
  assert.deepEqual(authHeaders, ['Bearer jwt-1']);
});

test('a stale JWT is refreshed and the request retried once', async () => {
  const { deps, authHeaders, counters } = dependencies({
    tokens: ['stale', 'fresh'],
    responses: [
      jsonResponse({ error: 'Sign in to continue.' }, 401),
      jsonResponse({ profile: { role: 'admin' } }),
    ],
  });

  const result = await apiFetch<{ profile: { role: string } }>(
    '/api/account/me',
    undefined,
    deps
  );

  assert.deepEqual(result, { profile: { role: 'admin' } });
  assert.deepEqual(authHeaders, ['Bearer stale', 'Bearer fresh']);
  assert.equal(counters.forced, 1);
  assert.equal(counters.cleared, 1);
});

test('a missing session produces an actionable error instead of "Sign in to continue."', async () => {
  const { deps } = dependencies({
    tokens: [null, null],
    responses: [jsonResponse({ error: 'Sign in to continue.' }, 401)],
  });

  await assert.rejects(
    () => apiFetch('/api/account/me', undefined, deps),
    (err: unknown) => {
      assert.ok(err instanceof SessionExpiredError);
      assert.match(err.message, /sign in again/i);
      return true;
    }
  );
});

test('a second 401 after refresh is reported as an expired session', async () => {
  const { deps } = dependencies({
    tokens: ['stale', 'fresh'],
    responses: [
      jsonResponse({ error: 'Sign in to continue.' }, 401),
      jsonResponse({ error: 'Sign in to continue.' }, 401),
    ],
  });

  await assert.rejects(
    () => apiFetch('/api/account/me', undefined, deps),
    SessionExpiredError
  );
});

test('other API errors keep their server message and are not retried', async () => {
  const { deps, authHeaders, counters } = dependencies({
    tokens: ['jwt-1', 'jwt-2'],
    responses: [jsonResponse({ error: 'Only admins can manage roles.' }, 403)],
  });

  await assert.rejects(
    () => apiFetch('/api/admin/users', undefined, deps),
    (err: unknown) => {
      assert.equal(err instanceof Error && err.message, 'Only admins can manage roles.');
      return true;
    }
  );
  assert.deepEqual(authHeaders, ['Bearer jwt-1']);
  assert.equal(counters.forced, 0);
});
