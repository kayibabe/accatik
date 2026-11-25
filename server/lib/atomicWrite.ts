import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';

/**
 * Unique scratch path for an atomic replace. A pid-only suffix collides when
 * two requests in one process write the same archive at once: the loser's
 * rename then fails with ENOENT because the winner already moved the temp file.
 */
export function tempPathFor(target: string): string {
  return `${target}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
}

/**
 * Serialises read-modify-write callers per target. Unique temp names alone are
 * not enough on Windows, where two concurrent renames onto one existing file
 * fail with EPERM. Keeping one queue per file makes the last writer win cleanly.
 */
const queues = new Map<string, Promise<unknown>>();

const RENAME_ATTEMPTS = 5;
const RENAME_BACKOFF_MS = 20;

function isTransientRenameError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Windows can reject a rename with EPERM while a scanner or another process
 * briefly holds the target, even when writes are serialised in-process. Retry
 * only those transient codes; a missing temp file or bad path must fail fast.
 */
export async function renameWithRetry(
  rename: (from: string, to: string) => Promise<void>,
  from: string,
  to: string,
  pause: (ms: number) => Promise<void> = sleep
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      if (attempt >= RENAME_ATTEMPTS - 1 || !isTransientRenameError(error)) {
        throw error;
      }
      await pause(RENAME_BACKOFF_MS * (attempt + 1));
    }
  }
}

/** Writes a JSON value via a unique temp file, then atomically replaces target. */
export async function writeJsonAtomic(
  target: string,
  value: unknown
): Promise<void> {
  const previous = queues.get(target) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(async () => {
    const temp = tempPathFor(target);
    await fs.writeFile(temp, JSON.stringify(value), 'utf8');
    try {
      await renameWithRetry(fs.rename, temp, target);
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  });
  queues.set(target, run);
  try {
    await run;
  } finally {
    if (queues.get(target) === run) queues.delete(target);
  }
}
