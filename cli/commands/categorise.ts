import { SailscoringClient } from '../client';
import { resolveConfig } from '../config';
import { findOrCreateCategory, runPerSeries, type OpResultLine } from '../series-ops';

/**
 * `sailscoring categorise <seriesId…> --category <name>` — move series into a
 * category, creating it if it doesn't exist. Blocked on archived series, so
 * categorise before you archive.
 */
export async function categoriseCommand(
  seriesIds: string[],
  flags: Record<string, string>,
): Promise<number> {
  if (seriesIds.length === 0) {
    console.error('categorise: at least one <seriesId> is required');
    return 1;
  }
  const name = flags.category && flags.category !== 'true' ? flags.category : '';
  if (!name) {
    console.error('categorise: --category <name> is required');
    return 1;
  }

  const cfg = resolveConfig({ baseUrl: flags['base-url'] });
  if (!cfg.token) {
    console.error('not logged in — run `sailscoring auth login` (or set SAILSCORING_TOKEN)');
    return 1;
  }

  const client = new SailscoringClient({
    baseUrl: cfg.baseUrl,
    token: cfg.token,
    workspace: flags.workspace && flags.workspace !== 'true' ? flags.workspace : undefined,
  });

  let categoryId: string;
  try {
    categoryId = await findOrCreateCategory(client, name);
  } catch (err) {
    console.error(`failed to resolve category "${name}": ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const results = await runPerSeries(
    seriesIds,
    (id) => client.setSeriesCategory(id, categoryId),
    printOpLine,
  );
  return summariseOp(results, `categorised into “${name}”`);
}

export function printOpLine(r: OpResultLine): void {
  if (r.status === 'ok') console.log(`  ✓ ${r.seriesId}`);
  else console.error(`  ✗ ${r.seriesId}: ${r.error}`);
}

export function summariseOp(results: OpResultLine[], what: string): number {
  const ok = results.filter((r) => r.status === 'ok').length;
  const failed = results.length - ok;
  console.log(`\n${ok} ${what}, ${failed} failed (${results.length} total)`);
  return failed > 0 ? 1 : 0;
}
