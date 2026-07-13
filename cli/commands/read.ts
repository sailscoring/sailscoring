import { SailscoringClient } from '../client';
import { resolveConfig } from '../config';
import { printJson, printTable, render, resolveFormat } from '../output';

/**
 * ADR-009 M4 — read commands. Every read shares the same shape: build a client,
 * fetch, and render via the output helper (`--json` for the raw API shape, else
 * an aligned table over the listed columns). Child resources are scoped by
 * `--series`.
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

function flag(flags: Record<string, string>, name: string): string | undefined {
  return flags[name] && flags[name] !== 'true' ? flags[name] : undefined;
}

async function read(
  flags: Record<string, string>,
  fetchFn: (client: SailscoringClient) => Promise<unknown>,
  columns?: string[],
): Promise<number> {
  const client = clientFor(flags);
  if (!client) return 1;
  try {
    render(flags, await fetchFn(client), columns);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

/** Resolve `--series`, printing an error and returning null when absent. */
function seriesScope(flags: Record<string, string>): string | null {
  const s = flag(flags, 'series');
  if (!s) {
    console.error('--series <id> is required');
    return null;
  }
  return s;
}

export const whoamiCommand = (flags: Record<string, string>): Promise<number> =>
  read(flags, (c) => c.whoami(), ['email', 'workspaceSlug', 'role', 'features']);

export const seriesListCommand = (flags: Record<string, string>): Promise<number> =>
  read(flags, (c) => c.listSeries(), ['id', 'name', 'startDate', 'archived']);

export async function seriesGetCommand(
  positional: string[],
  flags: Record<string, string>,
): Promise<number> {
  const id = positional[0];
  if (!id) {
    console.error('series get: <seriesId> is required');
    return 1;
  }
  return read(flags, (c) => c.getSeries(id), [
    'id', 'name', 'venue', 'startDate', 'endDate', 'archived',
  ]);
}

export async function competitorListCommand(flags: Record<string, string>): Promise<number> {
  const sid = seriesScope(flags);
  if (!sid) return 1;
  return read(flags, (c) => c.listCompetitors(sid), ['id', 'sailNumber', 'name', 'club']);
}

export async function raceListCommand(flags: Record<string, string>): Promise<number> {
  const sid = seriesScope(flags);
  if (!sid) return 1;
  return read(flags, (c) => c.listRaces(sid), ['id', 'raceNumber', 'date']);
}

export async function fleetListCommand(flags: Record<string, string>): Promise<number> {
  const sid = seriesScope(flags);
  if (!sid) return 1;
  return read(flags, (c) => c.listFleets(sid), ['id', 'name', 'scoringSystem', 'displayOrder']);
}

export async function subSeriesListCommand(flags: Record<string, string>): Promise<number> {
  const sid = seriesScope(flags);
  if (!sid) return 1;
  return read(flags, (c) => c.listSubSeries(sid), ['id', 'name']);
}

export const categoryListCommand = (flags: Record<string, string>): Promise<number> =>
  read(flags, (c) => c.listCategories(), ['id', 'name']);

/** Cross-series competitor identities (#212): one row per recurring
 *  competitor. `--json` emits the full arcs; the table view is the snapshot
 *  shape the archive migration diffs (slug per timeline URL). Requires the
 *  workspace's competitor-reconcile feature (the server gate). */
export async function identityListCommand(
  flags: Record<string, string>,
): Promise<number> {
  const client = clientFor(flags);
  if (!client) return 1;
  try {
    const { items } = await client.listIdentities();
    if (resolveFormat(flags) === 'json') {
      printJson(items);
      return 0;
    }
    const rows = items.map((i) => ({
      slug: i.slug ?? '',
      label: i.label,
      club: i.club ?? '',
      series: i.entries.length,
      span:
        i.firstYear != null && i.lastYear != null
          ? i.firstYear === i.lastYear
            ? String(i.firstYear)
            : `${i.firstYear}-${i.lastYear}`
          : '',
      managedBy: i.managedBy,
    }));
    printTable(rows, ['slug', 'label', 'club', 'series', 'span', 'managedBy']);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

export const publishedListCommand = (flags: Record<string, string>): Promise<number> =>
  read(flags, (c) => c.listPublished(), ['slug', 'url']);

export async function publishedGetCommand(
  positional: string[],
  flags: Record<string, string>,
): Promise<number> {
  const id = positional[0];
  if (!id) {
    console.error('published get: <seriesId> is required');
    return 1;
  }
  // Publication status is nested (slug + per-fleet URLs); render as JSON.
  return read(flags, (c) => c.getPublication(id));
}

export const activityListCommand = (flags: Record<string, string>): Promise<number> =>
  read(flags, (c) => c.listActivity(flag(flags, 'series')), ['action', 'summary']);

interface StandingsBlock {
  fleetName: string;
  rows: { rank: number; sailNumber: string; name: string; netPoints: number }[];
}

export async function standingsGetCommand(
  positional: string[],
  flags: Record<string, string>,
): Promise<number> {
  const id = positional[0];
  if (!id) {
    console.error('standings get: <seriesId> is required');
    return 1;
  }
  const client = clientFor(flags);
  if (!client) return 1;
  try {
    const data = (await client.getStandings(id)) as { standings?: StandingsBlock[] };
    const fleet = flag(flags, 'fleet');
    let blocks = data.standings ?? [];
    if (fleet) {
      blocks = blocks.filter((b) => b.fleetName.toLowerCase() === fleet.toLowerCase());
    }
    if (resolveFormat(flags) === 'json') {
      printJson(fleet ? blocks : data);
      return 0;
    }
    const rows = blocks.flatMap((b) =>
      b.rows.map((r) => ({
        fleet: b.fleetName,
        rank: r.rank,
        sailNumber: r.sailNumber,
        name: r.name,
        net: r.netPoints,
      })),
    );
    printTable(rows, ['fleet', 'rank', 'sailNumber', 'name', 'net']);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
