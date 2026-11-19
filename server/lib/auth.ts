import { createHash } from 'node:crypto';
import { Account, Client, Databases, ID } from 'node-appwrite';
import type { AppUser, UserProfile } from '../../src/types/user.ts';
import { createTtlCache } from './cache.ts';

/**
 * Server-side identity.
 *
 * The browser supplies only a short-lived Appwrite JWT. The function verifies
 * it with the Appwrite API, derives the user ID from the verified account, and
 * loads the role from the profiles collection. Nothing the client sends in a
 * body, query or `x-appwrite-user-id` header is treated as identity.
 */
export interface AuthContext {
  user: AppUser;
  profile: UserProfile;
  databases: Databases;
  jwt: string;
}

export const APPWRITE_DATABASE_ID = 'accatik';

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

export function appwriteEndpoint(): string {
  return env(
    'APPWRITE_FUNCTION_API_ENDPOINT',
    env('VITE_APPWRITE_ENDPOINT', 'https://fra.cloud.appwrite.io/v1')
  );
}

export function appwriteProjectId(): string {
  return env('APPWRITE_FUNCTION_PROJECT_ID', env('VITE_APPWRITE_PROJECT_ID', '6afee9de002e7fecc9ae'));
}

function headerValue(
  headers: Record<string, unknown> | undefined,
  name: string
): string | undefined {
  if (!headers) return undefined;
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

function bootstrapAdmins(): Set<string> {
  return new Set(
    env('BOOTSTRAP_ADMIN_EMAILS', '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

function toAppUser(account: {
  $id: string;
  email: string;
  name: string;
  emailVerification: boolean;
}): AppUser {
  return {
    id: account.$id,
    email: account.email,
    name: account.name || account.email,
    emailVerified: Boolean(account.emailVerification),
  };
}

function toProfile(document: Record<string, unknown>): UserProfile {
  const role = document.role;
  return {
    userId: String(document.userId ?? ''),
    role: role === 'pro' || role === 'admin' ? role : 'free',
    displayName: String(document.displayName ?? ''),
    localMigrated: Boolean(document.localMigrated),
    createdAt: String(document.createdAt ?? ''),
    updatedAt: String(document.updatedAt ?? ''),
  };
}

/** Stable Appwrite document ID for a ticket, without embedding the user ID. */
export function ticketDocumentId(userId: string, ticketKey: string): string {
  return createHash('sha256')
    .update(`${userId}|${ticketKey}`)
    .digest('hex')
    .slice(0, 32);
}

export function writeAudit(
  databases: Databases,
  actorUserId: string,
  action: string,
  reason: string,
  targetUserId?: string,
  meta?: Record<string, unknown>
): Promise<unknown> {
  return databases.createDocument({
    databaseId: APPWRITE_DATABASE_ID,
    collectionId: 'audit_log',
    documentId: ID.unique(),
    data: {
      actorUserId,
      action,
      targetUserId: targetUserId ?? '',
      reason: reason.slice(0, 256),
      metaJson: meta ? JSON.stringify(meta) : '',
      createdAt: new Date().toISOString(),
    } as never,
  });
}

async function ensureProfile(
  databases: Databases,
  user: AppUser
): Promise<UserProfile> {
  try {
    const document = await databases.getDocument({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId: 'profiles',
      documentId: user.id,
    });
    return toProfile(document as Record<string, unknown>);
  } catch {
    const now = new Date().toISOString();
    const role = bootstrapAdmins().has(user.email.toLowerCase())
      ? 'admin'
      : 'free';
    try {
      const document = await databases.createDocument({
        databaseId: APPWRITE_DATABASE_ID,
        collectionId: 'profiles',
        documentId: user.id,
        data: {
          userId: user.id,
          role,
          displayName: user.name,
          localMigrated: false,
          createdAt: now,
          updatedAt: now,
        },
      });
      return toProfile(document as Record<string, unknown>);
    } catch {
      // Another concurrent request created it first; read that copy.
      const document = await databases.getDocument({
        databaseId: APPWRITE_DATABASE_ID,
        collectionId: 'profiles',
        documentId: user.id,
      });
      return toProfile(document as Record<string, unknown>);
    }
  }
}

interface VerifiedIdentity {
  user: AppUser;
  profile: UserProfile;
}

/**
 * The three calls a login makes (/account/me, /tickets, /preferences) all carry
 * the same JWT. Re-verifying it and reloading the profile for each one costs two
 * Appwrite round trips apiece, so cache the verified identity briefly. Only the
 * identity is cached: the Databases client is rebuilt with this request's key.
 */
const identityCache = createTtlCache<VerifiedIdentity>(60_000, 200);

/**
 * Resolves a verified user from request headers, or null for a public request.
 * The privileged client uses the function's ephemeral Appwrite key; local
 * development may supply APPWRITE_API_KEY through an uncommitted .env file.
 */
export async function resolveAuth(
  headers: Record<string, unknown> | undefined
): Promise<AuthContext | null> {
  const jwt =
    headerValue(headers, 'x-appwrite-user-jwt') ??
    /^Bearer\s+(.+)$/i.exec(headerValue(headers, 'authorization') ?? '')?.[1];
  if (!jwt) return null;

  const apiKey =
    headerValue(headers, 'x-appwrite-key') ?? process.env.APPWRITE_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Appwrite API credentials are not configured for the API function.'
    );
  }

  const cacheKey = createHash('sha256').update(jwt).digest('hex');
  const privilegedClient = new Client()
    .setEndpoint(appwriteEndpoint())
    .setProject(appwriteProjectId())
    .setKey(apiKey);
  const databases = new Databases(privilegedClient);

  const cached = identityCache.get(cacheKey);
  if (cached) return { ...cached, databases, jwt };

  const userClient = new Client()
    .setEndpoint(appwriteEndpoint())
    .setProject(appwriteProjectId())
    .setJWT(jwt);
  const account = await new Account(userClient).get();
  const user = toAppUser(account);
  const profile = await ensureProfile(databases, user);

  identityCache.set(cacheKey, { user, profile });
  return { user, profile, databases, jwt };
}
