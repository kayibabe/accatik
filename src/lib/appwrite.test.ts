import assert from 'node:assert/strict';
import test from 'node:test';
import { account, isActiveSessionError, signIn } from './appwrite.ts';

test('recognises Appwrite active-session failures by code, type and legacy message', () => {
  assert.equal(isActiveSessionError({ code: 15101 }), true);
  assert.equal(isActiveSessionError({ type: 'user_session_already_exists' }), true);
  assert.equal(isActiveSessionError({ type: 'user_session_active' }), true);
  assert.equal(
    isActiveSessionError(
      new Error('Creation of a session is prohibited when a session is active.')
    ),
    true
  );
  assert.equal(isActiveSessionError({ code: 15100, message: 'Invalid credentials' }), false);
  assert.equal(isActiveSessionError(null), false);
});

test('sign-in clears a stale session and retries once', async () => {
  const calls: string[] = [];
  const originals = {
    createDevice: account.createDevice,
    createEmailPasswordSession: account.createEmailPasswordSession,
    deleteSession: account.deleteSession,
    get: account.get,
  };
  let firstAttempt = true;

  try {
    account.createDevice = async () => ({}) as never;
    account.deleteSession = async () => {
      calls.push('delete');
      return {} as never;
    };
    account.createEmailPasswordSession = async (params) => {
      const email = typeof params === 'string' ? params : params.email;
      calls.push(`create:${email}`);
      if (firstAttempt) {
        firstAttempt = false;
        throw Object.assign(
          new Error('Creation of a session is prohibited when a session is active.'),
          { code: 15101, type: 'user_session_already_exists' }
        );
      }
      return {} as never;
    };
    account.get = async () =>
      ({
        $id: 'user-1',
        email: 'cmhango@gmail.com',
        name: 'Cromwell',
        emailVerification: true,
      }) as never;

    const user = await signIn({ email: ' cmhango@gmail.com ', password: 'correct horse' });

    assert.equal(user.email, 'cmhango@gmail.com');
    assert.deepEqual(calls, [
      'create:cmhango@gmail.com',
      'delete',
      'create:cmhango@gmail.com',
    ]);
  } finally {
    Object.assign(account, originals);
  }
});

test('sign-in reports a clear message when the session conflict persists', async () => {
  const originals = {
    createDevice: account.createDevice,
    createEmailPasswordSession: account.createEmailPasswordSession,
    deleteSession: account.deleteSession,
  };

  try {
    account.createDevice = async () => ({}) as never;
    account.deleteSession = async () => ({}) as never;
    account.createEmailPasswordSession = async () => {
      throw Object.assign(new Error('session already active'), {
        type: 'user_session_already_exists',
      });
    };

    await assert.rejects(
      signIn({ email: 'cmhango@gmail.com', password: 'correct horse' }),
      /Sign out first, then sign in again/
    );
  } finally {
    Object.assign(account, originals);
  }
});
