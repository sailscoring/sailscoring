/**
 * Operator pass: write the published results API's view (ADR-015) for
 * publications made before the API, so their `index.json` entries link it.
 *
 * The view says what the pages say, so each publication is built from the
 * most faithful record of what its pages show:
 *
 *   1. For an as-published archive (ADR-010), its stored result tables,
 *      which are exactly what the pages render.
 *   2. The live series, but only while it is unchanged since the publish
 *      (`series.version` still equals `published_version`): then the live
 *      series is what every page was built from. Only the publication's live
 *      pages contribute, so a page it never published stays out.
 *
 * Anything else (a series edited since, an orphan) is skipped and reported;
 * the scorer's next publish writes its view. The data file is no source: a
 * view built from it would name the competitors by ids minted on import, and
 * the series' next publish would change every one of them.
 *
 * Without `--apply` nothing is written: the pass reports what it would do.
 *
 *   pnpm published-views:prod                     # report only
 *   pnpm published-views:prod --workspace hyc     # one workspace
 *   pnpm published-views:prod --apply             # write them
 */

import { and, eq } from 'drizzle-orm';

import { exportReposFor } from '@/lib/api-handlers/publish';
import { getDb, getDbClient } from '@/lib/db/client';
import { organization } from '@/lib/db/schema/auth';
import { asPublishedResults, competitors, fleets, publishedSeries, series } from '@/lib/db/schema/series';
import { archivePageView, archiveSection } from '@/lib/public-api/archive-view';
import { publicationFacts } from '@/lib/public-api/facts';
import { publishedPageKey, type PageContribution } from '@/lib/public-api/published-view';
import { writePublishedView } from '@/lib/public-api/store';
import { purgePublishedCache } from '@/lib/published-cache';
import { buildFleetHtmlFiles } from '@/lib/results-export';
import type { PublicationSummary, PublishedSeriesPage } from '@/lib/types';
import { workspaceContextFor } from '@/scripts/republish';

interface Row {
  id: string;
  slug: string;
  workspaceId: string;
  workspaceSlug: string;
  pages: PublishedSeriesPage[];
  dataSubPath: string | null;
  summary: PublicationSummary | null;
  publishedAt: Date;
  publishedVersion: number;
  seriesId: string | null;
  seriesName: string | null;
  seriesVersion: number | null;
  asPublished: boolean | null;
  resultsStatus: string | null;
}

type Outcome =
  | { kind: 'view'; source: 'archive' | 'live series'; contributions: PageContribution[] }
  | { kind: 'skip'; reason: string };

async function fromArchive(row: Row): Promise<PageContribution[]> {
  const seriesId = row.seriesId!;
  const [tables, boats] = await Promise.all([
    getDb()
      .select({ name: fleets.name, displayOrder: fleets.displayOrder, results: asPublishedResults.results })
      .from(asPublishedResults)
      .innerJoin(fleets, eq(asPublishedResults.fleetId, fleets.id))
      .where(eq(asPublishedResults.seriesId, seriesId)),
    getDb()
      .select({ id: competitors.id, sailNumber: competitors.sailNumber, names: competitors.names })
      .from(competitors)
      .where(eq(competitors.seriesId, seriesId)),
  ]);
  const byId = new Map(boats.map((b) => [b.id, { sailNumber: b.sailNumber, name: b.names[0] ?? '' }]));
  const sections = tables
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((t) => archiveSection(t.name, t.results, byId));
  // An archive publishes all of itself every time, so its whole view hangs
  // off one live page; the next ingest rebuilds it page by page.
  return [{ pageKey: publishedPageKey(row.pages[0]!), view: archivePageView(sections) }];
}

async function fromLiveSeries(row: Row): Promise<PageContribution[] | null> {
  const ctx = await workspaceContextFor(getDb(), row.workspaceId, row.workspaceSlug);
  if (!ctx) return null;
  const build = await buildFleetHtmlFiles(exportReposFor(row.workspaceId), row.seriesId!, undefined, {
    includePrizes: ctx.features.includes('prizes'),
    includeEntryList: ctx.features.includes('entry-list'),
    includeTrackData: ctx.features.includes('racesense-import'),
  });
  if (!build) return null;
  const live = new Set(row.pages.map(publishedPageKey));
  return build.files.flatMap((f) =>
    f.view && live.has(publishedPageKey(f)) ? [{ pageKey: publishedPageKey(f), view: f.view }] : [],
  );
}

async function plan(row: Row): Promise<Outcome> {
  if (row.seriesId === null) return { kind: 'skip', reason: 'orphaned' };
  if (row.pages.length === 0) return { kind: 'skip', reason: 'no pages' };
  if (row.asPublished) return { kind: 'view', source: 'archive', contributions: await fromArchive(row) };
  if (row.seriesVersion !== row.publishedVersion) {
    return { kind: 'skip', reason: 'series edited since publishing' };
  }
  const contributions = await fromLiveSeries(row);
  return contributions
    ? { kind: 'view', source: 'live series', contributions }
    : { kind: 'skip', reason: 'series not buildable' };
}

export async function runCli(argv: string[]): Promise<number> {
  const apply = argv.includes('--apply');
  // A view names competitors by ids hashed under the instance's key and links
  // by absolute URL. Written under any other key, or with no origin, every id
  // and link would change at the series' next publish.
  if (apply && (!process.env.COMPETITOR_ID_KEY?.trim() || !process.env.NEXT_PUBLIC_APP_URL?.trim())) {
    console.error(
      'refusing to write: COMPETITOR_ID_KEY and NEXT_PUBLIC_APP_URL must be set, to the deployment\'s own values',
    );
    return 1;
  }
  const wsAt = argv.indexOf('--workspace');
  const workspaceSlug = wsAt === -1 ? null : argv[wsAt + 1];

  const rows: Row[] = await getDb()
    .select({
      id: publishedSeries.id,
      slug: publishedSeries.slug,
      workspaceId: publishedSeries.workspaceId,
      workspaceSlug: organization.slug,
      pages: publishedSeries.pages,
      dataSubPath: publishedSeries.dataSubPath,
      summary: publishedSeries.summary,
      publishedAt: publishedSeries.publishedAt,
      publishedVersion: publishedSeries.publishedVersion,
      seriesId: publishedSeries.seriesId,
      seriesName: series.name,
      seriesVersion: series.version,
      asPublished: series.asPublished,
      resultsStatus: series.resultsStatus,
    })
    .from(publishedSeries)
    .innerJoin(organization, eq(publishedSeries.workspaceId, organization.id))
    .leftJoin(series, eq(publishedSeries.seriesId, series.id))
    .where(
      and(
        eq(publishedSeries.apiView, false),
        workspaceSlug ? eq(organization.slug, workspaceSlug) : undefined,
      ),
    );

  const touched = new Set<string>();
  let written = 0;
  let skipped = 0;
  for (const row of rows) {
    const name = `${row.workspaceSlug}/${row.slug}${row.seriesName ? ` (${row.seriesName})` : ''}`;
    let outcome: Outcome;
    try {
      outcome = await plan(row);
    } catch (err) {
      outcome = { kind: 'skip', reason: `build failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (outcome.kind === 'skip') {
      skipped++;
      console.log(`${name}  SKIP  ${outcome.reason}`);
      continue;
    }
    console.log(
      `${name}  ${apply ? 'WRITTEN' : 'WOULD WRITE'}  from ${outcome.source}: ${outcome.contributions.length} page view(s)`,
    );
    if (apply) {
      const publishedAt = row.publishedAt.getTime();
      await writePublishedView({
        publicationId: row.id,
        workspaceSlug: row.workspaceSlug,
        seriesId: row.seriesId!,
        contributions: outcome.contributions,
        livePages: new Set(row.pages.map(publishedPageKey)),
        facts: await publicationFacts({
          workspaceSlug: row.workspaceSlug,
          slug: row.slug,
          seriesId: row.seriesId,
          name: row.seriesName ?? row.slug,
          kind: row.asPublished ? 'archive' : row.summary?.splitFleet ? 'championship' : 'series',
          status: row.asPublished ? null : row.resultsStatus === 'final' ? 'final' : 'provisional',
          pages: row.pages,
          dataSubPath: row.dataSubPath,
          summary: row.summary,
          publishedAt,
        }),
        publishedAt,
      });
      await getDb().update(publishedSeries).set({ apiView: true }).where(eq(publishedSeries.id, row.id));
      touched.add(row.workspaceId);
    }
    written++;
  }
  // The workspace indexes now link the views written.
  for (const workspaceId of touched) await purgePublishedCache(workspaceId);

  console.log(
    `\n${rows.length} publication${rows.length === 1 ? '' : 's'} without a published view: ` +
      `${apply ? 'wrote' : 'would write'} ${written}, skipped ${skipped}`,
  );
  return 0;
}

// "main module" check. `tsx scripts/backfill-published-views.ts` runs this
// file directly; importing it from a test does not.
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
