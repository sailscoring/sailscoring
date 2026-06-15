import { SailscoringClient } from '../client';
import { resolveConfig } from '../config';
import { parseList, parsePairs } from '../flags';
import { runPublish, type PublishResultLine } from '../publish-runner';

/**
 * `sailscoring publish [--slug <slug>] <seriesId…>` — publish series standings.
 * With `--slug`, the given series co-publish into one shared namespace (the
 * IODAI case: several series' fleets under a single `/p/{ws}/{slug}`); without
 * it, each series publishes under its own derived slug. `--subpath f=p,…`
 * resolves fleet URL collisions within a shared slug; `--fleets a,b` limits
 * which fleets publish.
 */
export async function publishCommand(
  seriesIds: string[],
  flags: Record<string, string>,
): Promise<number> {
  if (seriesIds.length === 0) {
    console.error('publish: at least one <seriesId> is required');
    return 1;
  }

  const cfg = resolveConfig({ baseUrl: flags['base-url'] });
  if (!cfg.token) {
    console.error('not logged in — run `sailscoring auth login` (or set SAILSCORING_TOKEN)');
    return 1;
  }

  let subPaths: Record<string, string> | undefined;
  try {
    subPaths = parsePairs(flags.subpath);
  } catch (err) {
    console.error(`--subpath: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const client = new SailscoringClient({
    baseUrl: cfg.baseUrl,
    token: cfg.token,
    workspace: flags.workspace && flags.workspace !== 'true' ? flags.workspace : undefined,
  });

  const results = await runPublish({
    seriesIds,
    client,
    slug: flags.slug && flags.slug !== 'true' ? flags.slug : undefined,
    fleets: parseList(flags.fleets),
    subPaths,
    defaultSubPath:
      flags['default-subpath'] && flags['default-subpath'] !== 'true'
        ? flags['default-subpath']
        : undefined,
    onResult: printPublishLine,
  });

  return summarisePublish(results, cfg.baseUrl);
}

export function printPublishLine(r: PublishResultLine): void {
  if (r.status === 'published') {
    console.log(`  ✓ ${r.seriesId} → ${r.slug}`);
    for (const url of r.urls ?? []) console.log(`      ${url}`);
  } else {
    console.error(`  ✗ ${r.seriesId}: ${r.error}`);
  }
}

export function summarisePublish(
  results: PublishResultLine[],
  baseUrl: string,
): number {
  const published = results.filter((r) => r.status === 'published').length;
  const failed = results.length - published;
  console.log(
    `\n${published} published, ${failed} failed (${results.length} total) → ${baseUrl}`,
  );
  return failed > 0 ? 1 : 0;
}
