import { SailscoringClient } from '../client';
import { resolveConfig } from '../config';
import { parsePairs } from '../flags';
import { runImport } from '../import-runner';
import { runPublish } from '../publish-runner';
import { printPublishLine, summarisePublish } from './publish';

/**
 * `sailscoring import <files…>` — bulk-import `.sailscoring` files into the
 * active workspace. Reuses the saved token (or `SAILSCORING_TOKEN`); pick a
 * workspace with `--workspace` (slug or id), otherwise the token's default
 * workspace applies. Resumable: a failed file is reported but doesn't stop the
 * rest, and a re-run replays already-imported files (stable idempotency key).
 */
export async function importCommand(
  files: string[],
  flags: Record<string, string>,
): Promise<number> {
  if (files.length === 0) {
    console.error('import: at least one <file> is required');
    return 1;
  }

  const cfg = resolveConfig({ baseUrl: flags['base-url'] });
  if (!cfg.token) {
    console.error('not logged in — run `sailscoring auth login` (or set SAILSCORING_TOKEN)');
    return 1;
  }

  const workspace =
    flags.workspace && flags.workspace !== 'true' ? flags.workspace : undefined;
  const concurrency =
    flags.concurrency && flags.concurrency !== 'true'
      ? Number(flags.concurrency)
      : undefined;
  if (concurrency !== undefined && !Number.isFinite(concurrency)) {
    console.error('--concurrency must be a number');
    return 1;
  }

  const client = new SailscoringClient({
    baseUrl: cfg.baseUrl,
    token: cfg.token,
    workspace,
  });

  const results = await runImport({
    files,
    client,
    concurrency,
    onResult: (r) => {
      if (r.status === 'imported') {
        console.log(`  ✓ ${r.file} → ${r.id}`);
      } else {
        console.error(`  ✗ ${r.file}: ${r.error}`);
      }
    },
  });

  const imported = results.filter((r) => r.status === 'imported');
  const failed = results.length - imported.length;
  console.log(
    `\n${imported.length} imported, ${failed} failed (${results.length} total) → ${cfg.baseUrl}`,
  );

  // Optional publish phase: --publish-slug co-publishes every imported series
  // under one slug (IODAI); --publish gives each its own derived slug.
  const publishSlug =
    flags['publish-slug'] && flags['publish-slug'] !== 'true'
      ? flags['publish-slug']
      : undefined;
  const wantPublish = publishSlug !== undefined || flags.publish === 'true';
  if (!wantPublish) return failed > 0 ? 1 : 0;

  if (imported.length === 0) {
    console.error('\nnothing imported — skipping publish');
    return 1;
  }

  let subPaths: Record<string, string> | undefined;
  try {
    subPaths = parsePairs(flags.subpath);
  } catch (err) {
    console.error(`--subpath: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  console.log(`\nPublishing ${imported.length} series${publishSlug ? ` to ${publishSlug}` : ''}…`);
  const published = await runPublish({
    seriesIds: imported.map((r) => r.id!),
    client,
    slug: publishSlug,
    subPaths,
    onResult: printPublishLine,
  });
  const publishExit = summarisePublish(published, cfg.baseUrl);
  return failed > 0 || publishExit !== 0 ? 1 : 0;
}
