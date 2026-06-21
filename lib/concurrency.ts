/**
 * Map `items` through `fn` with at most `limit` calls in flight at once,
 * preserving input order in the returned array. A bounded alternative to
 * `Promise.all(items.map(fn))` for work that hits an external per-second rate
 * limit — e.g. the per-page Vercel Blob uploads in `publishSeries`, which would
 * otherwise burst all at once against the advanced-operation budget.
 *
 * Rejections propagate like `Promise.all`: the first failure rejects the whole
 * call (any in-flight work still settles, it just isn't awaited).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  const workers = Array.from(
    { length: Math.min(Math.max(limit, 1), items.length) },
    worker,
  );
  await Promise.all(workers);
  return results;
}
