import { Client, Databases, Query, type Models } from 'node-appwrite';
import {
  APPWRITE_DATABASE_ID,
  appwriteEndpoint,
  appwriteProjectId,
} from './auth.ts';

/**
 * Shared data-layer context for the two on-disk stores that have been moved
 * into Appwrite: the slate archive and the shadow ticket ledger.
 *
 * The Express server leaves this unset and keeps using local JSON files. The
 * Appwrite Function sets it on every request from the key Appwrite injects, so
 * the same handlers work in both environments without changing their public
 * signatures.
 */

let activeDatabases: Databases | null = null;

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

/** Uses Appwrite's per-execution key, falling back to a locally configured key. */
export function databasesFromHeaders(
  headers?: Record<string, unknown>
): Databases | null {
  const key =
    headerValue(headers, 'x-appwrite-key') ?? process.env.APPWRITE_API_KEY;
  if (!key) return null;
  return new Databases(
    new Client()
      .setEndpoint(appwriteEndpoint())
      .setProject(appwriteProjectId())
      .setKey(key)
  );
}

export function setDataDatabases(databases: Databases | null): void {
  activeDatabases = databases;
}

export function getDataDatabases(): Databases | null {
  return activeDatabases;
}

export async function listAllDocuments(
  databases: Databases,
  collectionId: string,
  queries: string[] = [],
  batchSize = 100
): Promise<Models.DefaultDocument[]> {
  const documents: Models.DefaultDocument[] = [];
  let cursor: string | undefined;
  while (true) {
    const pageQueries = [...queries, Query.limit(batchSize)];
    if (cursor) pageQueries.push(Query.cursorAfter(cursor));
    const page = await databases.listDocuments({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId,
      queries: pageQueries,
      total: false,
    });
    documents.push(...(page.documents as Models.DefaultDocument[]));
    if (page.documents.length < batchSize) break;
    cursor = page.documents[page.documents.length - 1].$id;
  }
  return documents;
}

export async function upsertDocument(
  databases: Databases,
  collectionId: string,
  documentId: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    await databases.updateDocument({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId,
      documentId,
      data,
    });
    return;
  } catch {
    // New document: create it below.
  }
  try {
    await databases.createDocument({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId,
      documentId,
      data,
    });
  } catch (error) {
    // A concurrent writer may have created it between the two calls.
    const code = (error as { code?: number }).code;
    if (code !== 409) throw error;
    await databases.updateDocument({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId,
      documentId,
      data,
    });
  }
}

export async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  handler: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await handler(item);
    }
  });
  await Promise.all(workers);
}
