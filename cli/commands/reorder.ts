import { SailscoringClient } from '../client';
import { resolveConfig } from '../config';

/**
 * `sailscoring series reorder <seriesId…>` — rewrite the workspace's series
 * `displayOrder` to match the given id sequence. Ids omitted keep their order,
 * so pass the full set for a clean total order. This drives both the in-app
 * series-list order and the order of contributing series on a shared-slug
 * published index page (`/p/{ws}/{slug}`).
 */
export async function reorderCommand(
  seriesIds: string[],
  flags: Record<string, string>,
): Promise<number> {
  if (seriesIds.length === 0) {
    console.error('reorder: at least one <seriesId> is required');
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

  try {
    await client.reorderSeries(seriesIds);
  } catch (err) {
    console.error(`reorder failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  console.log(`reordered ${seriesIds.length} series`);
  return 0;
}
