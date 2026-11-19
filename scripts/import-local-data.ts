import { promises as fs } from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { Client, Databases, Query, type Models } from 'node-appwrite';

/**
 * One-way import of the local on-disk archive into Appwrite.
 *
 * The local app keeps matchday slates and the shadow ticket ledger in JSON
 * files. The deployed Appwrite Function has no persistent filesystem, so those
 * files are copied into durable collections here. Re-running the script is
 * safe: existing document IDs are updated instead of duplicated.
 *
 * The API key needs the `databases.read`, `documents.read` and `documents.write`
 * scopes. Collections must exist before running (see appwrite.config notes).
 */

loadEnv({ path: path.resolve(process.cwd(), '.env') });

const DATABASE_ID = 'accatik';
const BATCH_SIZE = 100;

const endpoint =
  process.env.VITE_APPWRITE_ENDPOINT ?? 'https://fra.cloud.appwrite.io/v1';
const projectId =
  process.env.VITE_APPWRITE_PROJECT_ID ?? '6afee9de002e7fecc9ae';
const apiKey = process.env.APPWRITE_API_KEY;
if (!apiKey) {
  throw new Error('APPWRITE_API_KEY is required to import the local data.');
}

const databases = new Databases(
  new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey)
);

interface ImportedDocument {
  $id: string;
  data: Record<string, unknown>;
}

interface ArchivedSlate {
  dateIso: string;
  capturedAt: string;
  updatedAt: string;
  fixtures: Array<Record<string, unknown> & { id: string | number }>;
}

interface LedgerFile {
  updatedAt: string;
  tickets: Array<{
    id: string;
    dateIso: string;
    kind: string;
    status: string;
    createdAt: string;
  }>;
}

async function existingIds(collectionId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let cursor: string | undefined;
  while (true) {
    const queries = [Query.limit(BATCH_SIZE)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const response: Models.DocumentList<Models.DefaultDocument> =
      await databases.listDocuments({
        databaseId: DATABASE_ID,
        collectionId,
        queries,
        total: false,
      });
    for (const document of response.documents) ids.add(document.$id);
    if (response.documents.length < BATCH_SIZE) break;
    cursor = response.documents[response.documents.length - 1].$id;
  }
  return ids;
}

async function importCollection(
  collectionId: string,
  documents: ImportedDocument[]
): Promise<void> {
  const existing = await existingIds(collectionId);
  const create = documents.filter((doc) => !existing.has(doc.$id));
  const update = documents.filter((doc) => existing.has(doc.$id));

  for (let offset = 0; offset < create.length; offset += BATCH_SIZE) {
    const batch = create.slice(offset, offset + BATCH_SIZE);
    await databases.createDocuments({
      databaseId: DATABASE_ID,
      collectionId,
      documents: batch.map((doc) => ({ $id: doc.$id, ...doc.data })),
    });
    process.stdout.write(
      `\r  ${collectionId}: created ${Math.min(offset + BATCH_SIZE, create.length)}/${create.length}`
    );
  }
  if (create.length) process.stdout.write('\n');

  for (const doc of update) {
    await databases.updateDocument({
      databaseId: DATABASE_ID,
      collectionId,
      documentId: doc.$id,
      data: doc.data,
    });
  }

  console.log(
    `  ${collectionId}: ${create.length} created, ${update.length} updated (${documents.length} total)`
  );
}

async function main(): Promise<void> {
  const root = process.cwd();
  const ledgerPath = path.join(root, 'data', 'ledger', 'tickets.json');
  const slatesDir = path.join(root, 'data', 'slates');

  const ledger = JSON.parse(await fs.readFile(ledgerPath, 'utf8')) as LedgerFile;
  const slateFiles = (await fs.readdir(slatesDir))
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort();

  const slateDocs: ImportedDocument[] = [];
  const fixtureDocs: ImportedDocument[] = [];
  for (const file of slateFiles) {
    const slate = JSON.parse(
      await fs.readFile(path.join(slatesDir, file), 'utf8')
    ) as ArchivedSlate;
    const dateIso = slate.dateIso ?? file.replace(/\.json$/, '');
    const capturedAt = slate.capturedAt ?? new Date().toISOString();
    const updatedAt = slate.updatedAt ?? capturedAt;

    slateDocs.push({
      $id: dateIso,
      data: {
        dateIso,
        capturedAt,
        updatedAt,
        fixtureCount: slate.fixtures.length,
      },
    });
    for (const fixture of slate.fixtures) {
      const fixtureId = String(fixture.id);
      fixtureDocs.push({
        $id: `${dateIso}_${fixtureId}`,
        data: {
          dateIso,
          fixtureId,
          capturedAt,
          updatedAt,
          payloadJson: JSON.stringify(fixture),
        },
      });
    }
  }

  const ticketDocs: ImportedDocument[] = ledger.tickets.map((ticket) => ({
    $id: ticket.id,
    data: {
      ticketId: ticket.id,
      dateIso: ticket.dateIso,
      kind: ticket.kind,
      status: ticket.status,
      createdAt: ticket.createdAt,
      payloadJson: JSON.stringify(ticket),
    },
  }));

  console.log(
    `Importing ${slateDocs.length} slates, ${fixtureDocs.length} fixtures and ${ticketDocs.length} tickets into ${endpoint} (${projectId})`
  );
  await importCollection('slates', slateDocs);
  await importCollection('slate_fixtures', fixtureDocs);
  await importCollection('ledger_tickets', ticketDocs);
  await importCollection('ledger_meta', [
    { $id: 'state', data: { updatedAt: ledger.updatedAt } },
  ]);
  console.log('Import complete.');
}

main().catch((error) => {
  console.error('[import] failed', error);
  process.exitCode = 1;
});
