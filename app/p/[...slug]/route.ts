import type { NextRequest } from 'next/server';

import { readPublishedHtml } from '@/lib/blob-storage';
import { getCareerArc } from '@/lib/career-arc';
import { renderCareerArcHtml } from '@/lib/career-arc-render';
import {
  findIdentityIdByRef,
  listIdentitiesWithArcs,
  workspaceHasCompetitors,
  workspaceHasIdentityFeature,
} from '@/lib/competitor-identity-repository';
import {
  renderCompetitorIndexHtml,
  toCompetitorIndexEntries,
} from '@/lib/published-competitor-index';
import { contentHash, humanizeSlug } from '@/lib/publishing';
import {
  renderAsPublishedRankingHtml,
  renderRankingHtml,
} from '@/lib/ranking-render';
import {
  computeRankingStandings,
  filterRankingConfigSeries,
  getAsPublishedRankingBySlug,
  getPublishedRankingBySlug,
  listAsPublishedRankings,
  listPublishedRankings,
} from '@/lib/ranking-standings';
import { and, eq, inArray } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { workspaceOwnFeatureOn } from '@/lib/workspace-features';
import { getDb } from '@/lib/db/client';
import {
  renderRankingIndexHtml,
  renderSeriesIndexHtml,
  renderWorkspaceIndexHtml,
  type SeriesIndexGroup,
} from '@/lib/published-index';
import {
  injectAfterBodyTag,
  renderFleetNav,
} from '@/lib/published-fleet-nav';
import {
  getPublishedGroupByWorkspaceSlug,
  getSeriesName,
  getWorkspaceBySlug,
  listPublishedByWorkspace,
  listPublishedSeriesIds,
} from '@/lib/published-repository';

export const dynamic = 'force-dynamic';

const NOT_FOUND = new Response('Not found', {
  status: 404,
  headers: { 'content-type': 'text/plain; charset=utf-8' },
});

// Always-fresh: cache, but revalidate every request against the ETag. A
// re-publish changes the ETag (the publication's content hash), so a reload
// shows the new results immediately rather than a stale cached copy (#162).
const CACHE_CONTROL = 'public, no-cache';

/** 304 when the caller's `If-None-Match` already has this version, else null.
 *  Checked before rendering/reading so an unchanged page costs nothing. */
function notModified(req: NextRequest, etag: string): Response | null {
  if (req.headers.get('if-none-match') !== etag) return null;
  return new Response(null, {
    status: 304,
    headers: { etag, 'cache-control': CACHE_CONTROL },
  });
}

function htmlResponse(html: string, etag: string): Response {
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': CACHE_CONTROL,
      etag,
    },
  });
}

/**
 * Public, unauthenticated results pages and listings (ADR-008 Phase 9/10, the
 * bilge replacement — #153, #162). Path shapes:
 *
 *   /p/{ws}                     → workspace index: every published series (rendered live)
 *   /p/{ws}/{series}            → series index: that publication's fleet pages (rendered live)
 *   /p/{ws}/{series}/{subPath}  → a fleet's standings HTML (`standings` or `kebab(fleet)`;
 *                                 sub-series pages add a block segment, `{block}/{fleet}`)
 *
 * The read path is a thin always-fresh function rather than a static blob
 * rewrite: re-publish freshness matters more than shaving the function/DB hit
 * (see #162 / the project decision note). Fleet HTML is read from storage by
 * the locator in the publication's DB row; each re-publish writes a fresh
 * content-addressed blob (see `publishedBlobKey`), so the row always points at
 * the current object — no overwrite-propagation lag. The two listings are
 * rendered on the fly, so there is no index blob to regenerate on publish.
 * `proxy.ts` excludes `/p/` from the login gate.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> },
): Promise<Response> {
  const { slug: segments } = await params;
  if (segments.length < 1 || segments.length > 4) return NOT_FOUND;

  if (segments.length === 1) return workspaceIndex(req, segments[0]);
  // `/p/{ws}/competitors` — the public competitor index (#217). Checked before
  // the length-2 series branch so the reserved word wins over a same-named slug.
  if (segments.length === 2 && segments[1] === 'competitors') {
    return competitorIndex(req, segments[0]);
  }
  // `/p/{ws}/rankings` — the public ranking index; reserved like
  // `competitors`, so it wins over a same-named series slug.
  if (segments.length === 2 && segments[1] === 'rankings') {
    return rankingIndex(req, segments[0]);
  }
  // `/p/{ws}/competitor/{identityId}` — the public competitor timeline (#212).
  if (segments.length === 3 && segments[1] === 'competitor') {
    return careerArc(req, segments[0], segments[2]);
  }
  // `/p/{ws}/ranking/{slug}` — a public cross-series ladder (#209).
  if (segments.length === 3 && segments[1] === 'ranking') {
    return rankingPage(req, segments[0], segments[2]);
  }
  if (segments.length === 2) return seriesIndex(req, segments[0], segments[1]);
  // Page sub-paths are one segment per fleet page, two for a sub-series page
  // (`{kebab(block)}/{fleet}`); the stored subPath carries the slash.
  return fleetPage(req, segments[0], segments[1], segments.slice(2).join('/'));
}

/** `/p/{ws}` — the public workspace listing. */
async function workspaceIndex(
  req: NextRequest,
  workspaceSlug: string,
): Promise<Response> {
  const workspace = await getWorkspaceBySlug(workspaceSlug);
  if (!workspace) return NOT_FOUND;

  const items = await listPublishedByWorkspace(workspace.id);
  // Don't reveal that a workspace exists if it has published nothing.
  if (items.length === 0) return NOT_FOUND;

  // Surface the competitor index when the feature is on and there's at least
  // one competitor to browse (so the link never lands on a 404).
  const competitorsLink =
    (await workspaceHasIdentityFeature(workspace.id)) &&
    (await workspaceHasCompetitors(workspace.id));

  // Public season ladders (#209) and as-published historical rankings
  // (#309): one forward link to the ranking index when any exist — the
  // series results stay the page's focus.
  const rankingsOn = await workspaceOwnFeatureOn(getDb(), workspace.id, 'rankings');
  const rankingsLink =
    rankingsOn &&
    ((await listPublishedRankings(workspace.id)).length > 0 ||
      (await listAsPublishedRankings(workspace.id)).length > 0);

  // ETag from listing metadata so repeat views revalidate without re-rendering.
  // Includes the placement fields (category / archive / order / year) so
  // re-categorising, archiving, or reordering a series busts the cached page,
  // plus the competitors-link flag so it appears the first time one is added,
  // and the ranking links so publishing/renaming a ladder shows up. Each
  // item's page list feeds the quick-jump picker (#320), so it contributes too.
  const etag = `"${await contentHash([
    `logo:${workspace.logo}`,
    `competitors:${competitorsLink}`,
    `rankings:${rankingsLink}`,
    ...items.map(
      (i) =>
        `${i.slug}:${i.publishedAt}:${i.fleetCount}:${i.title}:${i.archived}:${i.categoryName ?? ''}:${i.categoryOrder}:${i.seriesOrder}:${i.year ?? ''}:${i.pages
          .map((p) => `${p.subPath}~${p.subSeriesName ?? ''}~${p.fleetName}`)
          .join('|')}`,
    ),
  ])}"`;
  const cached = notModified(req, etag);
  if (cached) return cached;
  const html = renderWorkspaceIndexHtml(workspaceSlug, workspace.name, items, workspace.logo, {
    competitorsLink,
    rankingsLink,
  });
  return htmlResponse(html, etag);
}

/** `/p/{ws}/rankings` — the public ranking index (#209/#309): computed
 *  ladders first, then the as-published historical record by season. */
async function rankingIndex(
  req: NextRequest,
  workspaceSlug: string,
): Promise<Response> {
  const workspace = await getWorkspaceBySlug(workspaceSlug);
  if (!workspace) return NOT_FOUND;
  if (!(await workspaceOwnFeatureOn(getDb(), workspace.id, 'rankings'))) {
    return NOT_FOUND;
  }
  const entries = [
    ...(await listPublishedRankings(workspace.id)),
    ...(await listAsPublishedRankings(workspace.id)).map((r) => ({
      name: r.name,
      slug: r.slug,
    })),
  ];
  if (entries.length === 0) return NOT_FOUND;

  const etag = `"${await contentHash([
    `logo:${workspace.logo}`,
    ...entries.map((r) => `${r.slug}:${r.name}`),
  ])}"`;
  const cached = notModified(req, etag);
  if (cached) return cached;
  const html = renderRankingIndexHtml(
    workspaceSlug,
    workspace.name,
    entries,
    workspace.logo,
  );
  return htmlResponse(html, etag);
}

/** `/p/{ws}/ranking/{slug}` — a public cross-series season ladder (#209).
 *  Gated on the workspace's `rankings` feature and the ranking's own public
 *  toggle. Public = published: computed over the config's published series
 *  only, with the basis named in the footer. */
async function rankingPage(
  req: NextRequest,
  workspaceSlug: string,
  rankingSlug: string,
): Promise<Response> {
  const workspace = await getWorkspaceBySlug(workspaceSlug);
  if (!workspace) return NOT_FOUND;
  if (!(await workspaceOwnFeatureOn(getDb(), workspace.id, 'rankings'))) {
    return NOT_FOUND;
  }

  const ranking = await getPublishedRankingBySlug(workspace.id, rankingSlug);
  if (!ranking) {
    return asPublishedRankingPage(req, workspace, workspaceSlug, rankingSlug);
  }

  const publishedIds = await listPublishedSeriesIds(workspace.id);
  const publicConfig = filterRankingConfigSeries(ranking.config, publishedIds);
  const standings = await computeRankingStandings(workspace.id, publicConfig);
  const competitorLinks = await workspaceHasIdentityFeature(workspace.id);

  // ETag over the computed rows and the basis, so a re-score, a re-publish of
  // a contributing series, or a rename busts the cache while a repeat view
  // revalidates without re-rendering.
  const etag = `"${await contentHash([
    `logo:${workspace.logo}`,
    `name:${ranking.name}`,
    `links:${competitorLinks}`,
    // The config drives filters, place recomputation, and (via adjustments)
    // tooltip notes that don't surface in the row lines below.
    `config:${JSON.stringify(publicConfig)}`,
    ...standings.includedSeries.map((s) => `series:${s.id}:${s.name}`),
    ...standings.result.rows.map(
      (r) =>
        `${r.identityId}:${r.rank}:${r.total}:${r.gross}:${r.label}:${r.buckets
          .map((b) =>
            b.places.map((p) => `${p.place}${p.counted ? '' : 'd'}`).join(','),
          )
          .join('|')}`,
    ),
  ])}"`;
  const cached = notModified(req, etag);
  if (cached) return cached;

  const html = renderRankingHtml(
    workspaceSlug,
    workspace.name,
    ranking.name,
    publicConfig,
    standings,
    { competitorLinks, logoUrl: workspace.logo },
  );
  return htmlResponse(html, etag);
}

/** The as-published fall-through for `/p/{ws}/ranking/{slug}` (#309): a
 *  historical season ranking stored exactly as the association published
 *  it. Always public — the archive pushes only what was already public. */
async function asPublishedRankingPage(
  req: NextRequest,
  workspace: { id: string; name: string; logo: string },
  workspaceSlug: string,
  rankingSlug: string,
): Promise<Response> {
  const record = await getAsPublishedRankingBySlug(workspace.id, rankingSlug);
  if (!record) return NOT_FOUND;

  const competitorLinks = await workspaceHasIdentityFeature(workspace.id);
  // Only link sailors whose identity actually exists in the workspace —
  // a slug the manifest hasn't (yet) created must not 404.
  const rowSlugs = [
    ...new Set(
      record.table.rows
        .map((r) => r.identity)
        .filter((s): s is string => s !== null),
    ),
  ];
  const present =
    competitorLinks && rowSlugs.length > 0
      ? await getDb()
          .select({ slug: schema.competitorIdentities.slug })
          .from(schema.competitorIdentities)
          .where(
            and(
              eq(schema.competitorIdentities.workspaceId, workspace.id),
              inArray(schema.competitorIdentities.slug, rowSlugs),
            ),
          )
      : [];
  const linkable = new Set(
    present.map((r) => r.slug).filter((s): s is string => s !== null),
  );

  const etag = `"${await contentHash([
    `logo:${workspace.logo}`,
    `links:${competitorLinks}`,
    `hash:${record.hash}`,
    `linkable:${[...linkable].sort().join(',')}`,
  ])}"`;
  const cached = notModified(req, etag);
  if (cached) return cached;

  const html = renderAsPublishedRankingHtml(
    workspaceSlug,
    workspace.name,
    record,
    linkable,
    { competitorLinks, logoUrl: workspace.logo },
  );
  return htmlResponse(html, etag);
}

/** `/p/{ws}/competitor/{ref}` — a recurring competitor's timeline across every
 *  series they entered (#212/#217). `ref` is the vanity slug (or, for
 *  back-compat, a raw identity UUID). Gated on the workspace having the
 *  `competitor-identity` feature, so it's invisible where it isn't enabled. */
async function careerArc(
  req: NextRequest,
  workspaceSlug: string,
  ref: string,
): Promise<Response> {
  const workspace = await getWorkspaceBySlug(workspaceSlug);
  if (!workspace) return NOT_FOUND;
  if (!(await workspaceHasIdentityFeature(workspace.id))) return NOT_FOUND;

  const identityId = await findIdentityIdByRef(workspace.id, ref);
  if (!identityId) return NOT_FOUND;
  const identity = await getCareerArc(workspace.id, identityId);
  if (!identity) return NOT_FOUND;
  // The arc only carries published series and as-published rankings; a
  // competitor with nothing public isn't public — don't reveal them by name
  // (matches the index dropping them). A ranking-only sailor IS public: the
  // association already published that ranking.
  if (identity.entries.length === 0 && identity.rankingEntries.length === 0) {
    return NOT_FOUND;
  }

  // ETag over the arc's content so a rename, split, a new linked series, a
  // re-score (which changes a rank), or (un)publishing a contributing series
  // (which changes a deep-link) busts the cache, while a repeat view
  // revalidates without re-rendering.
  const etag = `"${await contentHash([
    `logo:${workspace.logo}`,
    `label:${identity.label}`,
    ...identity.entries.map(
      (e) =>
        `${e.competitorId}:${e.seriesName}:${e.year}:${e.sailNumber}:${e.rank}/${e.fleetSize}:${e.publishedSlug ?? ''}`,
    ),
    ...identity.rankingEntries.map(
      (r) => `ranking:${r.rankingId}:${r.rankLabel}:${r.rankedCount}:${r.name}`,
    ),
  ])}"`;
  const cached = notModified(req, etag);
  if (cached) return cached;

  const html = renderCareerArcHtml(
    workspaceSlug,
    workspace.name,
    identity,
    workspace.logo,
  );
  return htmlResponse(html, etag);
}

/** `/p/{ws}/competitors` — the browsable, searchable index of every recurring
 *  competitor in the workspace (#217). Same gate as the timeline; 404s when the
 *  workspace has no competitors so the page never reveals an empty roster. */
async function competitorIndex(
  req: NextRequest,
  workspaceSlug: string,
): Promise<Response> {
  const workspace = await getWorkspaceBySlug(workspaceSlug);
  if (!workspace) return NOT_FOUND;
  if (!(await workspaceHasIdentityFeature(workspace.id))) return NOT_FOUND;

  // Published = public: the index reflects only series with a live
  // publication, so an unpublished series never contributes a row, sail
  // number, or year. As-published rankings (#309) count alongside: each
  // identity's ranked seasons extend its span and add a rankings count.
  const rankingRows = await getDb()
    .select({
      season: schema.asPublishedRankings.season,
      table: schema.asPublishedRankings.table,
    })
    .from(schema.asPublishedRankings)
    .where(eq(schema.asPublishedRankings.workspaceId, workspace.id));
  const rankingSeasonsBySlug = new Map<string, number[]>();
  for (const r of rankingRows) {
    for (const row of r.table.rows) {
      if (!row.identity) continue;
      const seasons = rankingSeasonsBySlug.get(row.identity) ?? [];
      seasons.push(r.season);
      rankingSeasonsBySlug.set(row.identity, seasons);
    }
  }
  const competitors = toCompetitorIndexEntries(
    await listIdentitiesWithArcs(workspace.id),
    await listPublishedSeriesIds(workspace.id),
    rankingSeasonsBySlug,
  );
  if (competitors.length === 0) return NOT_FOUND;

  // ETag over each row's identity (slug, name, sails, year span, counts) so a
  // rename, split, a newly linked series, or a new ranking busts the index.
  const etag = `"${await contentHash([
    `logo:${workspace.logo}`,
    ...competitors.map(
      (c) =>
        `${c.slug}:${c.name}:${c.sailNumbers.join(',')}:${c.firstYear}-${c.lastYear}:${c.seriesCount}:${c.rankingCount}`,
    ),
  ])}"`;
  const cached = notModified(req, etag);
  if (cached) return cached;

  const html = renderCompetitorIndexHtml(
    workspaceSlug,
    workspace.name,
    competitors,
    workspace.logo,
  );
  return htmlResponse(html, etag);
}

/** `/p/{ws}/{series}` — the fleet listing for a slug. A slug is a shared
 *  namespace, so this unions the fleet pages of every series publishing into it
 *  (sub-headed per series when there's more than one). */
async function seriesIndex(
  req: NextRequest,
  workspaceSlug: string,
  seriesSlug: string,
): Promise<Response> {
  const workspace = await getWorkspaceBySlug(workspaceSlug);
  if (!workspace) return NOT_FOUND;

  const group = await getPublishedGroupByWorkspaceSlug(workspace.id, seriesSlug);
  if (group.length === 0) return NOT_FOUND;

  // The listing changes only when a contributor re-publishes, so the members'
  // content hashes compose a sound ETag — plus the workspace logo, which the
  // hero shows.
  const etag = `"${await contentHash([
    `logo:${workspace.logo}`,
    ...group.map((p) => p.contentHash),
  ])}"`;
  const cached = notModified(req, etag);
  if (cached) return cached;

  const groups: SeriesIndexGroup[] = await Promise.all(
    group.map(async (p) => ({
      seriesName:
        (p.seriesId ? await getSeriesName(p.seriesId) : null) ?? seriesSlug,
      pages: p.pages.map((pg) => ({
        fleetName: pg.fleetName,
        ...(pg.subSeriesName ? { subSeriesName: pg.subSeriesName } : {}),
        ...(pg.isPrizes ? { isPrizes: true } : {}),
        subPath: pg.subPath,
      })),
    })),
  );
  const title =
    groups.length === 1 ? groups[0].seriesName : humanizeSlug(seriesSlug);
  const html = renderSeriesIndexHtml(
    workspaceSlug,
    workspace.name,
    seriesSlug,
    title,
    groups,
    workspace.logo,
  );
  return htmlResponse(html, etag);
}

/** `/p/{ws}/{series}/{subPath}` — a single fleet's results HTML. The fleet may
 *  belong to any series publishing into the slug; we read the owning
 *  publication's blob. */
async function fleetPage(
  req: NextRequest,
  workspaceSlug: string,
  seriesSlug: string,
  subPath: string,
): Promise<Response> {
  const workspace = await getWorkspaceBySlug(workspaceSlug);
  if (!workspace) return NOT_FOUND;

  const group = await getPublishedGroupByWorkspaceSlug(workspace.id, seriesSlug);
  const owner = group.find((p) => p.pages.some((pg) => pg.subPath === subPath));
  const page = owner?.pages.find((pg) => pg.subPath === subPath);
  if (!owner || !page) return NOT_FOUND;

  const etag = `"${owner.contentHash}"`;
  const cached = notModified(req, etag);
  if (cached) return cached;

  const html = await readPublishedHtml(page.blobUrl);
  if (html === null) return NOT_FOUND;
  // Sideways navigation between the owning publication's pages (#320),
  // injected at serve time so the stored blob stays exactly the published
  // artifact. The ETag needs no extension: the switcher derives from
  // `owner.pages`, and any change to that set changes `contentHash`.
  const nav = renderFleetNav(
    owner.pages,
    subPath,
    `/p/${workspaceSlug}/${seriesSlug}`,
  );
  return htmlResponse(nav ? injectAfterBodyTag(html, nav) : html, etag);
}
