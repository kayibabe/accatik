/**
 * Runs an async handler over a list with a bounded number of workers.
 * Used by the archive scans so a wide date range cannot open hundreds of
 * concurrent file reads.
 */
export async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  handler: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        await handler(items[index], index);
      }
    }
  );
  await Promise.all(workers);
}
