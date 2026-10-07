/**
 * Operator pass: fill in `published_series.summary` for publications made
 * before the column existed, so the public indexes (`/p/{ws}/index.json`, the
 * `/p/` directory) carry their race dates and counts.
 *
 * A summary describes what was *published*, never the live series, so each
 * row is summarised from the most faithful record of its publication there
 * is, in this order:
 *
 *   1. Its published data file — the public export the pages were rendered
 *      beside, from the same snapshot.
 *   2. For an as-published archive (ADR-010), its stored result tables, which
 *      are exactly what the pages render.
 *   3. The live series, but only while it is unchanged since the publish
 *      (`series.version` still equals `published_version`) — then live and
 *      published are the same data.
 *
 * Anything else (an orphan with no data file, a series edited since) is left
 * null and reported; the scorer's next publish fills it in.
 *
 * Without `--apply` nothing is written: the pass reports what it would do.
 *
 *   pnpm publication-summaries:prod                     # report only
 *   pnpm publication-summaries:prod --workspace hyc     # one workspace
 *   pnpm publication-summaries:prod --apply             # write them
 */

import { and, eq, isNull } from 'drizzle-orm';

import { exportReposFor } from '@/lib/api-handlers/publish';
import { readPublishedHtml } from '@/lib/blob-storage';
import { getDb, getDbClient } from '@/lib/db/client';
import { organization } from '@/lib/db/schema/auth';
import {
  asPublishedResults,
  competitors,
  fleets,
  publishedSeries,
  series,
} from '@/lib/db/schema/series';
import { purgePublishedCache } from '@/lib/published-cache';
import {
  summariseArchive,
  summarisePublicExport,
  summariseSnapshot,
} from '@/lib/publication-summary';
import type { PublicSeriesExport } from '@/lib/public-export';
import { loadSeriesSnapshot } from '@/lib/series-snapshot';
import type { PublicationSummary } from '@/lib/types';

interface Row {
  id: string;
  slug: string;
  workspaceId: string;
  workspaceSlug: string;
  dataBlobUrl: string | null;
  publishedVersion: number;
  seriesId: string | null;
  seriesName: string | null;
  seriesVersion: number | null;
  asPublished: boolean | null;
  startDate: string | null;
  endDate: string | null;
}

type Outcome =
  | { kind: 'summary'; source: 'data file' | 'archive' | 'live series'; summary: PublicationSummary }
  | { kind: 'skip'; reason: string };

async function fromArchive(row: Row): Promise<PublicationSummary> {
  const seriesId = row.seriesId!;
  const [tables, boats] = await Promise.all([
    getDb()
      .select({
        name: fleets.name,
        displayOrder: fleets.displayOrder,
        displayOnly: asPublishedResults.displayOnly,
        results: asPublishedResults.results,
      })
      .from(asPublishedResults)
      .innerJoin(fleets, eq(asPublishedResults.fleetId, fleets.id))
      .where(eq(asPublishedResults.seriesId, seriesId)),
    getDb()
      .select({ id: competitors.id })
      .from(competitors)
      .where(eq(competitors.seriesId, seriesId)),
  ]);
  return summariseArchive({
    fleets: tables.sort((a, b) => a.displayOrder - b.displayOrder),
    boats: boats.length,
    startDate: row.startDate,
    endDate: row.endDate,
  });
}

async function fromLiveSeries(row: Row): Promise<PublicationSummary | null> {
  const repos = exportReposFor(row.workspaceId);
  const snapshot = await loadSeriesSnapshot(repos, row.seriesId!);
  if (!snapshot) return null;
  // The pages publish sailed races only — those with a finish-sheet row.
  const sailed = new Set(snapshot.finishes.map((f) => f.raceId));
  const split = await repos.splitFleets?.get(row.seriesId!);
  return summariseSnapshot(
    { ...snapshot, races: snapshot.races.filter((r) => sailed.has(r.id)) },
    !!split && split.rounds.length > 0,
  );
}

async function summarise(row: Row): Promise<Outcome> {
  if (row.dataBlobUrl) {
    const json = await readPublishedHtml(row.dataBlobUrl);
    if (json !== null) {
      const exp = JSON.parse(json) as PublicSeriesExport;
      return { kind: 'summary', source: 'data file', summary: summarisePublicExport(exp) };
    }
  }
  if (row.seriesId === null) return { kind: 'skip', reason: 'orphaned, no data file' };
  if (row.asPublished) {
    return { kind: 'summary', source: 'archive', summary: await fromArchive(row) };
  }
  if (row.seriesVersion !== row.publishedVersion) {
    return { kind: 'skip', reason: 'series edited since publishing' };
  }
  const summary = await fromLiveSeries(row);
  return summary
    ? { kind: 'summary', source: 'live series', summary }
    : { kind: 'skip', reason: 'series not found' };
}

export async function runCli(argv: string[]): Promise<number> {
  const apply = argv.includes('--apply');
  const wsAt = argv.indexOf('--workspace');
  const workspaceSlug = wsAt === -1 ? null : argv[wsAt + 1];

  const rows: Row[] = await getDb()
    .select({
      id: publishedSeries.id,
      slug: publishedSeries.slug,
      workspaceId: publishedSeries.workspaceId,
      workspaceSlug: organization.slug,
      dataBlobUrl: publishedSeries.dataBlobUrl,
      publishedVersion: publishedSeries.publishedVersion,
      seriesId: publishedSeries.seriesId,
      seriesName: series.name,
      seriesVersion: series.version,
      asPublished: series.asPublished,
      startDate: series.startDate,
      endDate: series.endDate,
    })
    .from(publishedSeries)
    .innerJoin(organization, eq(publishedSeries.workspaceId, organization.id))
    .leftJoin(series, eq(publishedSeries.seriesId, series.id))
    .where(
      and(
        isNull(publishedSeries.summary),
        workspaceSlug ? eq(organization.slug, workspaceSlug) : undefined,
      ),
    );

  const touched = new Set<string>();
  let filled = 0;
  let skipped = 0;
  for (const row of rows) {
    const name = `${row.workspaceSlug}/${row.slug}${row.seriesName ? ` (${row.seriesName})` : ''}`;
    const outcome = await summarise(row);
    if (outcome.kind === 'skip') {
      skipped++;
      console.log(`${name}  SKIP  ${outcome.reason}`);
      continue;
    }
    const { summary } = outcome;
    console.log(
      `${name}  ${apply ? 'FILLED' : 'WOULD FILL'}  from ${outcome.source}: ` +
        `${summary.races} races, ${summary.boats} boats, ` +
        `${summary.firstRaceDate ?? '—'} → ${summary.lastRaceDate ?? '—'}`,
    );
    if (apply) {
      await getDb()
        .update(publishedSeries)
        .set({ summary })
        .where(eq(publishedSeries.id, row.id));
      touched.add(row.workspaceId);
    }
    filled++;
  }
  for (const workspaceId of touched) await purgePublishedCache(workspaceId);

  console.log(
    `\n${rows.length} publication${rows.length === 1 ? '' : 's'} without a summary: ` +
      `${apply ? 'filled' : 'would fill'} ${filled}, skipped ${skipped}`,
  );
  return 0;
}

// "main module" check. `tsx scripts/backfill-publication-summaries.ts` runs
// this file directly; importing it from a test does not.
const isMain = require.main === module;
if (isMain) {
  void (async () => {
    let code = 1;
    try {
      code = await runCli(process.argv.slice(2));
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
    }
    await getDbClient().end();
    process.exit(code);
  })();
}
