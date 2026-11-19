import { Account, Client, ID } from 'appwrite';
import type { AppUser } from '../types/user.ts';

/**
 * Browser-side Appwrite Auth client.
 *
 * Endpoint and project ID are public values; the API key and session secret
 * never live in the bundle. API calls send a short-lived JWT which the
 * function verifies before trusting any user identity.
 */
const endpoint =
  String(import.meta.env.VITE_APPWRITE_ENDPOINT || '').trim() ||
  'https://fra.cloud.appwrite.io/v1';
const project =
  String(import.meta.env.VITE_APPWRITE_PROJECT_ID || '').trim() ||
  '6afee9de002e7fecc9ae';

export const appwriteClient = new Client().setEndpoint(endpoint).setProject(project);
export const account = new Account(appwriteClient);

let jwtCache: { token: string; expiresAt: number } | null = null;

export function clearJwt(): void {
  jwtCache = null;
}

export async function getJwt(): Promise<string | null> {
  if (jwtCache && jwtCache.expiresAt > Date.now() + 60_000) {
    return jwtCache.token;
  }
  try {
    await account.get();
  } catch {
    jwtCache = null;
    return null;
  }
  try {
    const { jwt } = await account.createJWT();
    jwtCache = { token: jwt, expiresAt: Date.now() + 14 * 60 * 1000 };
    return jwt;
  } catch {
    jwtCache = null;
    return null;
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
  await account.createEmailPasswordSession({ email: email.trim(), password });
  clearJwt();
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
  await account.createEmailPasswordSession({ email: email.trim(), password });
  clearJwt();
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
