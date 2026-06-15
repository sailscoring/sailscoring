import type { Category } from './client';

/**
 * ADR-009 M3.2 — shared helpers for per-series CLI operations (categorise,
 * archive). Sequential and resume-on-failure, matching the import/publish
 * runners: a failed series is reported, the rest continue.
 */

export interface OpResultLine {
  seriesId: string;
  status: 'ok' | 'failed';
  error?: string;
}

export async function runPerSeries(
  seriesIds: string[],
  op: (seriesId: string) => Promise<void>,
  onResult?: (result: OpResultLine) => void,
): Promise<OpResultLine[]> {
  const results: OpResultLine[] = [];
  for (const seriesId of seriesIds) {
    let line: OpResultLine;
    try {
      await op(seriesId);
      line = { seriesId, status: 'ok' };
    } catch (err) {
      line = {
        seriesId,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
    results.push(line);
    onResult?.(line);
  }
  return results;
}

interface CategoryClient {
  listCategories(): Promise<{ items: Category[] }>;
  createCategory(name: string): Promise<Category>;
}

/**
 * Resolve a category name to an id, creating the category if no existing one
 * matches (case-insensitive). Idempotent: a name that already exists is reused,
 * so re-running an import doesn't pile up duplicate categories.
 */
export async function findOrCreateCategory(
  client: CategoryClient,
  name: string,
): Promise<string> {
  const { items } = await client.listCategories();
  const existing = items.find(
    (c) => c.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  if (existing) return existing.id;
  const created = await client.createCategory(name);
  return created.id;
}
