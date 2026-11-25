import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchApiFootball,
  getApiFootballLimits,
  resolveApiFootballBaseUrl,
  resolveApiFootballKey,
} from './apiFootball.ts';

const KEY_ENV_NAMES = [
  'API_FOOTBALL_KEY',
  'API_FOOTBALL_API_KEY',
  'APIFOOTBALL_KEY',
  'FOOTBALL_API_KEY',
  'APISPORTS_KEY',
  'X_APISPORTS_KEY',
  'RAPIDAPI_KEY',
  'VITE_API_FOOTBALL_KEY',
];

function withoutKeyEnv(run: () => void): void {
  const saved = KEY_ENV_NAMES.map((name) => [name, process.env[name]] as const);
  for (const name of KEY_ENV_NAMES) delete process.env[name];
  try {
    run();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const BASE_URL_ENV_NAMES = [
  'API_FOOTBALL_BASE_URL',
  'API_FOOTBALL_API_URL',
  'APIFOOTBALL_BASE_URL',
  'VITE_API_FOOTBALL_BASE_URL',
];

function withoutBaseUrlEnv(run: () => void): void {
  const saved = BASE_URL_ENV_NAMES.map((name) => [name, process.env[name]] as const);
  for (const name of BASE_URL_ENV_NAMES) delete process.env[name];
  try {
    run();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('no base URL configured falls back to the built-in hosts', () => {
  withoutBaseUrlEnv(() => {
    assert.equal(resolveApiFootballBaseUrl(), undefined);
  });
});

test('a configured base URL is used and trailing slashes are dropped', () => {
  withoutBaseUrlEnv(() => {
    process.env.API_FOOTBALL_BASE_URL = 'https://gateway.example.com/api/v3//';
    assert.equal(
      resolveApiFootballBaseUrl(),
      'https://gateway.example.com/api/v3'
    );
  });
});

test('aliases are honoured when the canonical name is absent', () => {
  withoutBaseUrlEnv(() => {
    process.env.VITE_API_FOOTBALL_BASE_URL = 'http://localhost:8080/api-football';
    assert.equal(
      resolveApiFootballBaseUrl(),
      'http://localhost:8080/api-football'
    );
  });
});

test('the canonical name wins over an alias', () => {
  withoutBaseUrlEnv(() => {
    process.env.API_FOOTBALL_API_URL = 'https://alias.example.com';
    process.env.API_FOOTBALL_BASE_URL = 'https://canonical.example.com';
    assert.equal(resolveApiFootballBaseUrl(), 'https://canonical.example.com');
  });
});

test('blank values are ignored', () => {
  withoutBaseUrlEnv(() => {
    process.env.API_FOOTBALL_BASE_URL = '   ';
    assert.equal(resolveApiFootballBaseUrl(), undefined);
  });
});

test('a relative base URL fails loudly instead of hitting the wrong host', () => {
  withoutBaseUrlEnv(() => {
    process.env.API_FOOTBALL_BASE_URL = 'v3.football.api-sports.io';
    assert.throws(
      () => resolveApiFootballBaseUrl(),
      /not a valid absolute URL/
    );
  });
});

test('a non-http base URL is rejected', () => {
  withoutBaseUrlEnv(() => {
    process.env.API_FOOTBALL_BASE_URL = 'ftp://gateway.example.com';
    assert.throws(
      () => resolveApiFootballBaseUrl(),
      /must start with http:\/\/ or https:\/\//
    );
  });
});

test('the canonical API key name wins over an alias', () => {
  withoutKeyEnv(() => {
    process.env.APIFOOTBALL_KEY = 'alias-key';
    process.env.API_FOOTBALL_KEY = 'canonical-key';
    assert.equal(resolveApiFootballKey(), 'canonical-key');
  });
});

test('a VITE_* variable is never used as the API key', () => {
  withoutKeyEnv(() => {
    process.env.VITE_API_FOOTBALL_KEY = 'client-exposed-key';
    assert.equal(resolveApiFootballKey(), undefined);
  });
});

test('blank API key values are ignored', () => {
  withoutKeyEnv(() => {
    process.env.API_FOOTBALL_KEY = '   ';
    process.env.RAPIDAPI_KEY = 'rapid-key';
    assert.equal(resolveApiFootballKey(), 'rapid-key');
  });
});

test('upstream quota headers are captured for /health without an extra request', async () => {
  const envNames = [...new Set([...KEY_ENV_NAMES, ...BASE_URL_ENV_NAMES])];
  const savedEnv = envNames.map(
    (name) => [name, process.env[name]] as const
  );
  const originalFetch = globalThis.fetch;
  let requests = 0;
  let quotaHeaders: Record<string, string> = {
    'x-ratelimit-requests-limit': '100',
    'x-ratelimit-requests-remaining': '7',
    'x-ratelimit-requests-reset': String(
      Math.floor(Date.now() / 1000) + 60
    ),
  };

  try {
    for (const name of envNames) delete process.env[name];
    process.env.API_FOOTBALL_KEY = 'unit-test-key';
    process.env.API_FOOTBALL_BASE_URL = 'https://gateway.example.com';
    globalThis.fetch = (async () => {
      requests += 1;
      return new Response(JSON.stringify({ response: [] }), {
        status: 200,
        headers: new Headers(quotaHeaders),
      });
    }) as typeof fetch;

    await fetchApiFootball('/status', {});
    const limited = getApiFootballLimits();
    assert.ok(limited);
    assert.equal(limited.requestsLimit, 100);
    assert.equal(limited.requestsRemaining, 7);
    assert.equal(limited.planHint, 'free-or-limited');
    assert.ok(limited.requestsResetAt?.includes('T'));

    quotaHeaders = {
      'x-ratelimit-requests-limit': '3000',
      'x-ratelimit-requests-remaining': '2900',
    };
    await fetchApiFootball('/status', {});
    const metered = getApiFootballLimits();
    assert.ok(metered);
    assert.equal(metered.requestsLimit, 3000);
    assert.equal(metered.requestsRemaining, 2900);
    assert.equal(metered.planHint, 'metered');
    assert.equal(metered.requestsResetAt, null);
    assert.equal(requests, 2, 'quota visibility must not call upstream by itself');
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of savedEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('a transient network failure is retried before the slate fails', async () => {
  const envNames = [...new Set([...KEY_ENV_NAMES, ...BASE_URL_ENV_NAMES])];
  const savedEnv = envNames.map((name) => [name, process.env[name]] as const);
  const originalFetch = globalThis.fetch;
  let calls = 0;

  try {
    for (const name of envNames) delete process.env[name];
    process.env.API_FOOTBALL_KEY = 'unit-test-key';
    process.env.API_FOOTBALL_BASE_URL = 'https://gateway.example.com';
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls < 3) throw new TypeError('fetch failed');
      return new Response(JSON.stringify({ response: [{ ok: true }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const result = await fetchApiFootball('/status', {});
    assert.equal(calls, 3);
    assert.deepEqual(result.response, [{ ok: true }]);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of savedEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
