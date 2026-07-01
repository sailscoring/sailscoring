import { SailscoringClient } from '../client';
import { resolveConfig } from '../config';

/**
 * `sailscoring series unpublish <seriesId…>` — remove a series' published
 * pages (the whole publication, all fleets/sub-series). A series with no
 * publication is a no-op. Scoped to the active workspace (`--workspace`).
 */
export async function unpublishCommand(
  seriesIds: string[],
  flags: Record<string, string>,
): Promise<number> {
  if (seriesIds.length === 0) {
    console.error('unpublish: at least one <seriesId> is required');
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

  let failed = 0;
  for (const seriesId of seriesIds) {
    try {
      await client.unpublishSeries(seriesId);
      console.log(`  ✓ ${seriesId} unpublished`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${seriesId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`\n${seriesIds.length - failed} unpublished, ${failed} failed (${seriesIds.length} total)`);
  return failed > 0 ? 1 : 0;
}
