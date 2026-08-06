import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/**
 * ADR-009 M3 — bulk-import orchestration, kept pure (no argv, no process) so
 * it can be driven against the real import endpoint in tests. Each file is
 * imported under a stable `Idempotency-Key` (sha256 of its contents), so a
 * re-run replays rather than duplicating, and a failure mid-batch is
 * resumable: failures are collected, never abort the batch.
 */

export interface ImportResult {
  file: string;
  status: 'imported' | 'failed';
  id?: string;
  /** `replace` mode only: false when the run updated a series already there. */
  created?: boolean;
  error?: string;
}

interface ImportClient {
  importSeries(content: string, opts: { idempotencyKey: string }): Promise<{ id: string }>;
  putSeriesFile?(
    seriesId: string,
    content: string,
    opts: { idempotencyKey: string },
  ): Promise<{ id: string; created: boolean }>;
}

export interface RunImportOptions {
  files: string[];
  client: ImportClient;
  /** Max files imported in parallel. Defaults to 4. */
  concurrency?: number;
  /** Called as each file settles — for progress output. */
  onResult?: (result: ImportResult) => void;
  /**
   * Upsert each file at the series id it carries, rather than minting a new
   * series per import. The re-runnable mode: a second run over an updated file
   * replaces that series instead of adding a second copy of it.
   */
  replace?: boolean;
}

export async function runImport(opts: RunImportOptions): Promise<ImportResult[]> {
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const results: ImportResult[] = new Array(opts.files.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= opts.files.length) return;
      const file = opts.files[i];
      try {
        const content = await readFile(file, 'utf8');
        const idempotencyKey = createHash('sha256').update(content).digest('hex');
        if (opts.replace) {
          if (!opts.client.putSeriesFile) throw new Error('client cannot replace series');
          const seriesId = (JSON.parse(content) as { seriesId?: unknown }).seriesId;
          if (typeof seriesId !== 'string' || !seriesId) {
            throw new Error('file carries no seriesId to replace at');
          }
          const res = await opts.client.putSeriesFile(seriesId, content, { idempotencyKey });
          results[i] = { file, status: 'imported', id: res.id, created: res.created };
        } else {
          const { id } = await opts.client.importSeries(content, { idempotencyKey });
          results[i] = { file, status: 'imported', id };
        }
      } catch (err) {
        results[i] = {
          file,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        };
      }
      opts.onResult?.(results[i]);
    }
  };

  const workers = Math.min(concurrency, opts.files.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}
