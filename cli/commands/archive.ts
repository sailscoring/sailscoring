import { SailscoringClient } from '../client';
import { resolveConfig } from '../config';
import { runPerSeries } from '../series-ops';
import { printOpLine, summariseOp } from './categorise';

/**
 * `sailscoring archive <seriesId…> [--unarchive]` — archive (or unarchive)
 * series. Archiving makes a series read-only; the publish step and any
 * categorisation should happen first.
 */
export async function archiveCommand(
  seriesIds: string[],
  flags: Record<string, string>,
): Promise<number> {
  if (seriesIds.length === 0) {
    console.error('archive: at least one <seriesId> is required');
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

  const archived = flags.unarchive !== 'true';
  const results = await runPerSeries(
    seriesIds,
    (id) => client.setSeriesArchived(id, archived),
    printOpLine,
  );
  return summariseOp(results, archived ? 'archived' : 'unarchived');
}
