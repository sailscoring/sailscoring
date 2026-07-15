import { readFileSync } from 'node:fs';

import { SailscoringClient, type RankingItem } from '../client';
import { resolveConfig } from '../config';
import { printJson, printTable, render, resolveFormat } from '../output';

/**
 * Workspace cross-series rankings (#209) over the API. Reads mirror the
 * other read commands; `set` is the scripting workhorse — it replaces a
 * ranking's config from a JSON file (buckets, filters, adjustments), which
 * is how the archive pipelines replicate historical season rankings.
 */

function clientFor(flags: Record<string, string>): SailscoringClient | null {
  const cfg = resolveConfig({ baseUrl: flags['base-url'] });
  if (!cfg.token) {
    console.error('not logged in — run `sailscoring auth login` (or set SAILSCORING_TOKEN)');
    return null;
  }
  return new SailscoringClient({
    baseUrl: cfg.baseUrl,
    token: cfg.token,
    workspace: flags.workspace && flags.workspace !== 'true' ? flags.workspace : undefined,
  });
}

const COLUMNS = ['id', 'name', 'slug', 'published'];

export async function rankingListCommand(
  flags: Record<string, string>,
): Promise<number> {
  const client = clientFor(flags);
  if (!client) return 1;
  try {
    render(flags, await client.listRankings(), COLUMNS);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

export async function rankingGetCommand(
  positional: string[],
  flags: Record<string, string>,
): Promise<number> {
  const id = positional[0];
  if (!id) {
    console.error('ranking get: <rankingId> is required');
    return 1;
  }
  const client = clientFor(flags);
  if (!client) return 1;
  try {
    render(flags, await client.getRanking(id), COLUMNS);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

export async function rankingCreateCommand(
  positional: string[],
  flags: Record<string, string>,
): Promise<number> {
  const name = positional.join(' ').trim();
  if (!name) {
    console.error('ranking create: <name> is required');
    return 1;
  }
  const client = clientFor(flags);
  if (!client) return 1;
  try {
    render(flags, await client.createRanking(name), COLUMNS);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

/**
 * `ranking set <id> [--config <file.json>] [--name <name>] [--slug <slug>]
 *  [--publish | --unpublish]` — read the current ranking, overlay what was
 * given, PUT the result. The config file replaces the whole config.
 */
export async function rankingSetCommand(
  positional: string[],
  flags: Record<string, string>,
): Promise<number> {
  const id = positional[0];
  if (!id) {
    console.error('ranking set: <rankingId> is required');
    return 1;
  }
  const client = clientFor(flags);
  if (!client) return 1;
  try {
    const existing: RankingItem = await client.getRanking(id);
    let config = existing.config;
    if (flags.config && flags.config !== 'true') {
      config = JSON.parse(readFileSync(flags.config, 'utf8'));
    }
    const published =
      flags.publish === 'true'
        ? true
        : flags.unpublish === 'true'
          ? false
          : existing.published;
    const updated = await client.putRanking(id, {
      name:
        flags.name && flags.name !== 'true' ? flags.name : existing.name,
      config,
      published,
      ...(flags.slug && flags.slug !== 'true' ? { slug: flags.slug } : {}),
    });
    render(flags, updated, COLUMNS);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

export async function rankingStandingsCommand(
  positional: string[],
  flags: Record<string, string>,
): Promise<number> {
  const id = positional[0];
  if (!id) {
    console.error('ranking standings: <rankingId> is required');
    return 1;
  }
  const client = clientFor(flags);
  if (!client) return 1;
  try {
    const data = (await client.rankingStandings(id)) as {
      result: {
        rows: Array<{
          rank: number;
          label: string;
          club: string | null;
          total: number;
          gross: number;
        }>;
        ineligible: Array<{ label: string }>;
      };
      unmatchedCount: number;
      unflaggedCount: number;
    };
    if (resolveFormat(flags) === 'json') {
      printJson(data);
      return 0;
    }
    printTable(
      data.result.rows as unknown as Record<string, unknown>[],
      ['rank', 'label', 'club', 'gross', 'total'],
    );
    if (data.result.ineligible.length > 0) {
      console.log(
        `not yet ranked: ${data.result.ineligible.map((i) => i.label).join(', ')}`,
      );
    }
    if (data.unmatchedCount > 0) {
      console.log(`unmatched entries: ${data.unmatchedCount}`);
    }
    if (data.unflaggedCount > 0) {
      console.log(`sailors with no nationality: ${data.unflaggedCount}`);
    }
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
