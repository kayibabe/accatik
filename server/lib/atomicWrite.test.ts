import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renameWithRetry, writeJsonAtomic } from './atomicWrite.ts';

test('concurrent writes to one target use distinct temp files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matchslip-atomic-'));
  const target = path.join(dir, 'records.json');

  try {
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        writeJsonAtomic(target, { index })
      )
    );

    const parsed = JSON.parse(await fs.readFile(target, 'utf8')) as {
      index: number;
    };
    assert.ok(
      Number.isInteger(parsed.index) && parsed.index >= 0 && parsed.index < 12
    );
    assert.deepEqual(
      (await fs.readdir(dir)).filter((entry) => entry.endsWith('.tmp')),
      []
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a transient Windows rename lock is retried before the write fails', async () => {
  const pauses: number[] = [];
  let calls = 0;

  await renameWithRetry(
    async () => {
      calls += 1;
      if (calls < 3) {
        throw Object.assign(new Error('locked'), { code: 'EPERM' });
      }
    },
    'temp',
    'target',
    async (ms) => {
      pauses.push(ms);
    }
  );

  assert.equal(calls, 3);
  assert.deepEqual(pauses, [20, 40]);
});

test('a non-transient rename failure is not retried', async () => {
  let calls = 0;

  await assert.rejects(
    renameWithRetry(
      async () => {
        calls += 1;
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      },
      'temp',
      'target',
      async () => {
        throw new Error('should not pause');
      }
    ),
    /missing/
  );
  assert.equal(calls, 1);
});

test('a persistent lock stops after a bounded number of attempts', async () => {
  let calls = 0;

  await assert.rejects(
    renameWithRetry(
      async () => {
        calls += 1;
        throw Object.assign(new Error('locked'), { code: 'EBUSY' });
      },
      'temp',
      'target',
      async () => undefined
    ),
    /locked/
  );
  assert.equal(calls, 5);
});
