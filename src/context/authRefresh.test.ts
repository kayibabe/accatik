import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveProfileFailure } from './authRefresh.ts';
import { SessionExpiredError } from '../utils/api.ts';

test('a profile 401 with a live Appwrite session keeps the user signed in', () => {
  const action = resolveProfileFailure(new SessionExpiredError(), true);

  assert.equal(action.kind, 'keep-user');
  assert.match(action.notice, /session is still active/i);
});

test('a profile 401 with no Appwrite session signs the user out', () => {
  const action = resolveProfileFailure(new SessionExpiredError(), false);

  assert.equal(action.kind, 'clear-user');
  assert.match(action.notice, /sign in again/i);
});

test('other profile failures keep the verified session and report a retryable error', () => {
  const action = resolveProfileFailure(new Error('Function unavailable'), true);

  assert.equal(action.kind, 'keep-user');
  assert.match(action.notice, /account details could not be loaded/i);
});
