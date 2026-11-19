import { Account, Client, ID } from 'appwrite';
import type { AppUser } from '../types/user.ts';

/**
 * Browser-side Appwrite Auth client.
 *
 * Endpoint and project ID are public values; the API key and session secret
 * never live in the bundle. API calls send a short-lived JWT which the
 * function verifies before trusting any user identity.
 */
const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
const endpoint =
  String(env.VITE_APPWRITE_ENDPOINT || '').trim() ||
  'https://fra.cloud.appwrite.io/v1';
const project =
  String(env.VITE_APPWRITE_PROJECT_ID || '').trim() ||
  '6afee9de002e7fecc9ae';

export const appwriteClient = new Client().setEndpoint(endpoint).setProject(project);
export const account = new Account(appwriteClient);

let jwtCache: { token: string; expiresAt: number } | null = null;
let jwtInFlight: Promise<string | null> | null = null;

export function clearJwt(): void {
  jwtCache = null;
}

interface AppwriteFailure {
  code?: number;
  type?: string;
  message?: string;
}

/** Appwrite refuses a second session when the browser still has an active one. */
export function isActiveSessionError(error: unknown): boolean {
  const failure = (error ?? {}) as AppwriteFailure;
  return (
    failure.code === 15101 ||
    failure.type === 'user_session_already_exists' ||
    failure.type === 'user_session_active' ||
    /session is (?:already )?active/i.test(failure.message ?? '')
  );
}

let deviceSetup: Promise<void> | null = null;

/**
 * Appwrite Cloud expects a device for a browser to replace its own session.
 * Creating one is idempotent, so it is safe to call on every sign-in attempt.
 */
export function ensureAuthDevice(): Promise<void> {
  if (!deviceSetup) {
    deviceSetup = account
      .createDevice()
      .then(() => undefined)
      .catch((error: unknown) => {
        deviceSetup = null;
        // Projects with account switching disabled reject this call. The
        // sign-in retry clears the stale session instead.
        console.warn('[auth] Could not register an Appwrite device:', error);
      });
  }
  return deviceSetup;
}

async function discardCurrentSession(): Promise<void> {
  try {
    await account.deleteSession({ sessionId: 'current' });
  } catch {
    // No usable session to discard.
  }
  clearJwt();
}

/** Opens a session, recovering from a stale one left behind by a previous sign-in. */
async function openEmailPasswordSession(email: string, password: string): Promise<void> {
  const normalized = email.trim();
  await ensureAuthDevice();
  try {
    await account.createEmailPasswordSession({ email: normalized, password });
  } catch (error) {
    if (!isActiveSessionError(error)) throw error;
    // An invalid session cookie can survive a failed `account.get()`. Removing
    // it is the only way back when account switching is disabled.
    await discardCurrentSession();
    deviceSetup = null;
    await ensureAuthDevice();
    try {
      await account.createEmailPasswordSession({ email: normalized, password });
    } catch (retryError) {
      if (isActiveSessionError(retryError)) {
        throw new Error(
          'A session is already active in this browser. Sign out first, then sign in again.'
        );
      }
      throw retryError;
    }
  }
  clearJwt();
}

async function createJwt(): Promise<string | null> {
  try {
    await account.get();
  } catch {
    jwtCache = null;
    return null;
  }
  try {
    const { jwt } = await account.createJWT();
    // Appwrite JWTs live for 15 minutes. Keep a one-minute safety margin so
    // a token is never handed to the API close to its expiry.
    jwtCache = { token: jwt, expiresAt: Date.now() + 14 * 60 * 1000 };
    return jwt;
  } catch (err) {
    jwtCache = null;
    // This used to fail silently, leaving the API call without a token and
    // surfacing as the misleading "Sign in to continue." message.
    console.warn('[auth] Could not create an Appwrite JWT:', err);
    return null;
  }
}

/**
 * Returns a short-lived JWT for the API, or null when there is no usable
 * session. `force` bypasses the cache after a 401 so the caller can retry
 * with a freshly minted token.
 */
export async function getJwt(force = false): Promise<string | null> {
  if (force) return createJwt();
  if (jwtCache && jwtCache.expiresAt > Date.now() + 60_000) {
    return jwtCache.token;
  }
  if (jwtInFlight) return jwtInFlight;
  const pending = createJwt();
  jwtInFlight = pending;
  try {
    return await pending;
  } finally {
    if (jwtInFlight === pending) jwtInFlight = null;
  }
}

export function toAppUser(value: {
  $id: string;
  email: string;
  name: string;
  emailVerification: boolean;
}): AppUser {
  return {
    id: value.$id,
    email: value.email,
    name: value.name || value.email,
    emailVerified: Boolean(value.emailVerification),
  };
}

export async function currentUser(): Promise<AppUser | null> {
  try {
    return toAppUser(await account.get());
  } catch {
    clearJwt();
    return null;
  }
}

export interface Credentials {
  email: string;
  password: string;
  name?: string;
}

export function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'Use at least 8 characters.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return 'Include at least one letter and one number.';
  }
  return null;
}

export interface SignUpResult {
  user: AppUser;
  /** False when the verification email could not be dispatched. */
  verificationSent: boolean;
}

export async function signUp({ email, password, name }: Credentials): Promise<SignUpResult> {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);

  await account.create({
    userId: ID.unique(),
    email: email.trim(),
    password,
    name: (name || email.split('@')[0]).trim().slice(0, 100),
  });
  await openEmailPasswordSession(email, password);
  const user = await currentUser();
  if (!user) throw new Error('Account created, but sign-in failed. Please sign in.');

  let verificationSent = false;
  if (!user.emailVerified) {
    try {
      await sendVerification();
      verificationSent = true;
    } catch {
      // Account creation still succeeded; the UI offers a resend action.
      console.warn('Sign-up verification email could not be sent; resend is available.');
    }
  }
  return { user, verificationSent };
}

export async function signIn({ email, password }: Credentials): Promise<AppUser> {
  await openEmailPasswordSession(email, password);
  const user = await currentUser();
  if (!user) throw new Error('Sign-in failed. Please try again.');
  return user;
}

export async function signOut(): Promise<void> {
  try {
    await account.deleteSession({ sessionId: 'current' });
  } catch {
    // Already signed out.
  }
  clearJwt();
}

export async function sendVerification(): Promise<void> {
  await account.createVerification({
    url: `${window.location.origin}/verify`,
  });
}

export async function completeVerification(userId: string, secret: string): Promise<void> {
  await account.updateVerification({ userId, secret });
  clearJwt();
}

export async function requestPasswordReset(email: string): Promise<void> {
  await account.createRecovery({
    email: email.trim(),
    url: `${window.location.origin}/reset`,
  });
}

export async function completePasswordReset(
  userId: string,
  secret: string,
  password: string
): Promise<void> {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  await account.updateRecovery({ userId, secret, password });
  clearJwt();
}
