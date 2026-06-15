import { SailscoringClient } from '../client';
import { resolveConfig } from '../config';
import { parsePairs } from '../flags';
import { runImport } from '../import-runner';
import { runPublish } from '../publish-runner';
import { findOrCreateCategory, runPerSeries } from '../series-ops';
import { printPublishLine, summarisePublish } from './publish';
import { printOpLine, summariseOp } from './categorise';

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

  // Optional post-phases, in order: publish → categorise → archive. Categorise
  // must precede archive (moving an archived series is blocked). Each runs on
  // the just-imported series; the exit code is non-zero if any phase failed.
  const publishSlug =
    flags['publish-slug'] && flags['publish-slug'] !== 'true'
      ? flags['publish-slug']
      : undefined;
  const wantPublish = publishSlug !== undefined || flags.publish === 'true';
  const categoryName =
    flags.category && flags.category !== 'true' ? flags.category : undefined;
  const wantArchive = flags.archive === 'true';

  if (!wantPublish && !categoryName && !wantArchive) {
    return failed > 0 ? 1 : 0;
  }
  if (imported.length === 0) {
    console.error('\nnothing imported — skipping publish/categorise/archive');
    return 1;
  }

  const ids = imported.map((r) => r.id!);
  let exit = failed > 0 ? 1 : 0;

  if (wantPublish) {
    let subPaths: Record<string, string> | undefined;
    try {
      subPaths = parsePairs(flags.subpath);
    } catch (err) {
      console.error(`--subpath: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
    console.log(`\nPublishing ${ids.length} series${publishSlug ? ` to ${publishSlug}` : ''}…`);
    const published = await runPublish({
      seriesIds: ids,
      client,
      slug: publishSlug,
      subPaths,
      onResult: printPublishLine,
    });
    if (summarisePublish(published, cfg.baseUrl) !== 0) exit = 1;
  }

  if (categoryName) {
    console.log(`\nCategorising into “${categoryName}”…`);
    try {
      const categoryId = await findOrCreateCategory(client, categoryName);
      const catResults = await runPerSeries(
        ids,
        (id) => client.setSeriesCategory(id, categoryId),
        printOpLine,
      );
      if (summariseOp(catResults, `categorised into “${categoryName}”`) !== 0) exit = 1;
    } catch (err) {
      console.error(`failed to resolve category: ${err instanceof Error ? err.message : String(err)}`);
      exit = 1;
    }
  }

  if (wantArchive) {
    console.log('\nArchiving…');
    const archiveResults = await runPerSeries(
      ids,
      (id) => client.setSeriesArchived(id, true),
      printOpLine,
    );
    if (summariseOp(archiveResults, 'archived') !== 0) exit = 1;
  }

  return exit;
}
