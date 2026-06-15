import { SailscoringClient } from '../client';
import { resolveConfig } from '../config';
import { runImport } from '../import-runner';

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

  const imported = results.filter((r) => r.status === 'imported').length;
  const failed = results.length - imported;
  console.log(
    `\n${imported} imported, ${failed} failed (${results.length} total) → ${cfg.baseUrl}`,
  );
  return failed > 0 ? 1 : 0;
}
