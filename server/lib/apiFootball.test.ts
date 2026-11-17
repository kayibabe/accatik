import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveApiFootballBaseUrl } from './apiFootball.ts';

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
