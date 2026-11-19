import { ID, Query, type Databases } from 'node-appwrite';
import type { SavedTicket } from '../src/types/fixtures.ts';
import type {
  AccountResponse,
  UserPreferences,
  UserProfile,
  UserRole,
} from '../src/types/user.ts';
import type { ApiResult } from './api.ts';
import {
  APPWRITE_DATABASE_ID,
  ticketDocumentId,
  writeAudit,
  type AuthContext,
} from './lib/auth.ts';

/**
 * Authenticated, per-user API handlers.
 *
 * Every handler receives an AuthContext whose user ID came from a verified
 * Appwrite JWT. All Appwrite queries are scoped to that ID, and no handler
 * accepts an owner ID from the client.
 */

interface ErrorBody {
  error: string;
}

const ok = <T>(body: T): ApiResult<T> => ({ status: 200, body });
const fail = (status: number, error: string): ApiResult<ErrorBody> => ({
  status,
  body: { error },
});

function requireAuth(auth: AuthContext | null): ErrorBody | null {
  if (auth) return null;
  return { error: 'Sign in to continue.' };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanText(value: unknown, max: number, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, max);
}

function ticketKeyFor(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
  if (cleaned) return cleaned;
  return ID.unique();
}

/** Accepts browser-shaped tickets but never trusts an owner field. */
function normalizeTicket(value: unknown): SavedTicket | null {
  const source = asRecord(value);
  if (!Array.isArray(source.legs) || source.legs.length === 0) return null;

  const dateIso =
    typeof source.dateIso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(source.dateIso)
      ? source.dateIso
      : undefined;

  const rawId = ticketKeyFor(source.id);
  const stake = Number(source.stake);
  const totalOdds = Number(source.totalOdds);

  return {
    id: rawId,
    name: cleanText(source.name, 200, 'Saved Acca'),
    createdAt:
      typeof source.createdAt === 'string' && source.createdAt
        ? source.createdAt
        : new Date().toISOString(),
    date: cleanText(source.date, 80, dateIso ?? ''),
    dateIso,
    stake: Number.isFinite(stake) && stake > 0 ? stake : 1,
    totalOdds: Number.isFinite(totalOdds) ? totalOdds : 0,
    legs: source.legs as SavedTicket['legs'],
  };
}

async function upsertTicket(
  databases: Databases,
  userId: string,
  ticket: SavedTicket
): Promise<void> {
  const ticketKey = ticketKeyFor(ticket.id);
  const documentId = ticketDocumentId(userId, ticketKey);
  const data = {
    userId,
    ticketKey,
    name: ticket.name,
    payloadJson: JSON.stringify(ticket),
    dateIso: ticket.dateIso ?? '',
    createdAt: ticket.createdAt,
    updatedAt: new Date().toISOString(),
  };

  try {
    await databases.createDocument({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId: 'saved_tickets',
      documentId,
      data,
    });
  } catch {
    await databases.updateDocument({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId: 'saved_tickets',
      documentId,
      data,
    });
  }
}

function ticketsFromDocuments(documents: Record<string, unknown>[]): SavedTicket[] {
  return documents.flatMap((document) => {
    try {
      const ticket = JSON.parse(String(document.payloadJson ?? 'null'));
      return ticket && typeof ticket === 'object' ? [ticket as SavedTicket] : [];
    } catch {
      return [];
    }
  });
}

export function getMe(auth: AuthContext | null): ApiResult<AccountResponse | ErrorBody> {
  const missing = requireAuth(auth);
  if (missing) return fail(401, missing.error);
  return ok({ user: auth!.user, profile: auth!.profile });
}

export async function migrateLocalTickets(
  auth: AuthContext | null,
  body: unknown
): Promise<ApiResult<{ imported: number; profile: UserProfile } | ErrorBody>> {
  const missing = requireAuth(auth);
  if (missing) return fail(401, missing.error);

  const source = asRecord(body);
  if (!Array.isArray(source.tickets)) {
    return fail(400, 'tickets must be an array.');
  }

  const tickets = source.tickets
    .map(normalizeTicket)
    .filter((ticket): ticket is SavedTicket => Boolean(ticket));
  if (tickets.length === 0) {
    return fail(400, 'No valid saved slips were supplied.');
  }

  try {
    for (const ticket of tickets) {
      await upsertTicket(auth!.databases, auth!.user.id, ticket);
    }
    const document = await auth!.databases.updateDocument({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId: 'profiles',
      documentId: auth!.user.id,
      data: { localMigrated: true, updatedAt: new Date().toISOString() },
    });
    await writeAudit(
      auth!.databases,
      auth!.user.id,
      'local_slips_imported',
      'Imported saved slips from this browser into the account.',
      undefined,
      { count: tickets.length }
    ).catch(() => undefined);

    return ok({ imported: tickets.length, profile: document as unknown as UserProfile });
  } catch (error) {
    console.error('[account] local import failed', error);
    return fail(500, 'Could not import your saved slips. Please try again.');
  }
}

export async function listTickets(
  auth: AuthContext | null
): Promise<ApiResult<{ tickets: SavedTicket[] } | ErrorBody>> {
  const missing = requireAuth(auth);
  if (missing) return fail(401, missing.error);

  try {
    const response = await auth!.databases.listDocuments({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId: 'saved_tickets',
      queries: [
        Query.equal('userId', auth!.user.id),
        Query.orderDesc('createdAt'),
        Query.limit(200),
      ],
    });
    return ok({ tickets: ticketsFromDocuments(response.documents as Record<string, unknown>[]) });
  } catch (error) {
    console.error('[tickets] list failed', error);
    return fail(500, 'Could not load your saved slips.');
  }
}

export async function saveTickets(
  auth: AuthContext | null,
  body: unknown
): Promise<ApiResult<{ saved: number } | ErrorBody>> {
  const missing = requireAuth(auth);
  if (missing) return fail(401, missing.error);

  const source = asRecord(body);
  if (!Array.isArray(source.tickets)) {
    return fail(400, 'tickets must be an array.');
  }
  const tickets = source.tickets
    .map(normalizeTicket)
    .filter((ticket): ticket is SavedTicket => Boolean(ticket));
  if (tickets.length === 0) {
    return fail(400, 'No valid saved slips were supplied.');
  }

  try {
    for (const ticket of tickets) {
      await upsertTicket(auth!.databases, auth!.user.id, ticket);
    }
    return ok({ saved: tickets.length });
  } catch (error) {
    console.error('[tickets] save failed', error);
    return fail(500, 'Could not save your slip.');
  }
}

export async function deleteTicket(
  auth: AuthContext | null,
  ticketKey: string
): Promise<ApiResult<{ deleted: boolean } | ErrorBody>> {
  const missing = requireAuth(auth);
  if (missing) return fail(401, missing.error);

  try {
    await auth!.databases.deleteDocument({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId: 'saved_tickets',
      documentId: ticketDocumentId(auth!.user.id, ticketKeyFor(ticketKey)),
    });
    return ok({ deleted: true });
  } catch {
    return ok({ deleted: false });
  }
}

export async function getPreferences(
  auth: AuthContext | null
): Promise<ApiResult<UserPreferences | ErrorBody>> {
  const missing = requireAuth(auth);
  if (missing) return fail(401, missing.error);

  try {
    const document = await auth!.databases.getDocument({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId: 'preferences',
      documentId: auth!.user.id,
    });
    return ok({
      filtersJson: String(document.filtersJson ?? ''),
      slateJson: String(document.slateJson ?? ''),
      updatedAt: String(document.updatedAt ?? ''),
    });
  } catch {
    return ok({ filtersJson: '', slateJson: '', updatedAt: '' });
  }
}

export async function putPreferences(
  auth: AuthContext | null,
  body: unknown
): Promise<ApiResult<UserPreferences | ErrorBody>> {
  const missing = requireAuth(auth);
  if (missing) return fail(401, missing.error);

  const source = asRecord(body);
  const filtersJson = cleanText(source.filtersJson, 8000);
  const slateJson = cleanText(source.slateJson, 8000);
  const now = new Date().toISOString();

  try {
    const document = await auth!.databases.updateDocument({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId: 'preferences',
      documentId: auth!.user.id,
      data: { filtersJson, slateJson, updatedAt: now },
    });
    return ok({
      filtersJson: String(document.filtersJson ?? filtersJson),
      slateJson: String(document.slateJson ?? slateJson),
      updatedAt: String(document.updatedAt ?? now),
    });
  } catch {
    const document = await auth!.databases.createDocument({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId: 'preferences',
      documentId: auth!.user.id,
      data: { userId: auth!.user.id, filtersJson, slateJson, updatedAt: now },
    });
    return ok({
      filtersJson: String(document.filtersJson ?? filtersJson),
      slateJson: String(document.slateJson ?? slateJson),
      updatedAt: String(document.updatedAt ?? now),
    });
  }
}

function requireAdmin(auth: AuthContext | null): ErrorBody | null {
  if (!auth) return { error: 'Sign in to continue.' };
  if (auth.profile.role !== 'admin') {
    return { error: 'Administrator access is required.' };
  }
  return null;
}

export async function adminListUsers(
  auth: AuthContext | null
): Promise<ApiResult<{ profiles: UserProfile[] } | ErrorBody>> {
  const forbidden = requireAdmin(auth);
  if (forbidden) return fail(forbidden.error === 'Sign in to continue.' ? 401 : 403, forbidden.error);

  try {
    const response = await auth!.databases.listDocuments({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId: 'profiles',
      queries: [Query.orderDesc('createdAt'), Query.limit(500)],
    });
    const profiles = response.documents.map((document) => ({
      userId: String(document.userId ?? ''),
      role: (document.role === 'pro' || document.role === 'admin'
        ? document.role
        : 'free') as UserRole,
      displayName: String(document.displayName ?? ''),
      localMigrated: Boolean(document.localMigrated),
      createdAt: String(document.createdAt ?? ''),
      updatedAt: String(document.updatedAt ?? ''),
    }));
    return ok({ profiles });
  } catch (error) {
    console.error('[admin] user list failed', error);
    return fail(500, 'Could not load users.');
  }
}

export async function adminSetRole(
  auth: AuthContext | null,
  body: unknown
): Promise<ApiResult<{ profile: UserProfile } | ErrorBody>> {
  const forbidden = requireAdmin(auth);
  if (forbidden) return fail(forbidden.error === 'Sign in to continue.' ? 401 : 403, forbidden.error);

  const source = asRecord(body);
  const targetUserId = cleanText(source.userId, 64);
  const role = source.role;
  const reason = cleanText(source.reason, 256);

  if (!targetUserId || (role !== 'free' && role !== 'pro' && role !== 'admin')) {
    return fail(400, 'A valid userId and role are required.');
  }
  if (reason.length < 5) {
    return fail(400, 'A short audit reason is required.');
  }

  try {
    const document = await auth!.databases.updateDocument({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId: 'profiles',
      documentId: targetUserId,
      data: { role, updatedAt: new Date().toISOString() },
    });
    await writeAudit(
      auth!.databases,
      auth!.user.id,
      'role_changed',
      reason,
      targetUserId,
      { role }
    );
    return ok({ profile: document as unknown as UserProfile });
  } catch (error) {
    console.error('[admin] role change failed', error);
    return fail(500, 'Could not change that role.');
  }
}
