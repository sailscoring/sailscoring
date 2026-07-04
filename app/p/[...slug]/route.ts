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
  renderSeriesIndexHtml,
  renderWorkspaceIndexHtml,
  type SeriesIndexGroup,
} from '@/lib/published-index';
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
  // `/p/{ws}/competitor/{identityId}` — the public competitor timeline (#212).
  if (segments.length === 3 && segments[1] === 'competitor') {
    return careerArc(req, segments[0], segments[2]);
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

  // ETag from listing metadata so repeat views revalidate without re-rendering.
  // Includes the placement fields (category / archive / order / year) so
  // re-categorising, archiving, or reordering a series busts the cached page,
  // plus the competitors-link flag so it appears the first time one is added.
  const etag = `"${await contentHash([
    `logo:${workspace.logo}`,
    `competitors:${competitorsLink}`,
    ...items.map(
      (i) =>
        `${i.slug}:${i.publishedAt}:${i.fleetCount}:${i.title}:${i.archived}:${i.categoryName ?? ''}:${i.categoryOrder}:${i.seriesOrder}:${i.year ?? ''}`,
    ),
  ])}"`;
  const cached = notModified(req, etag);
  if (cached) return cached;
  const html = renderWorkspaceIndexHtml(workspaceSlug, workspace.name, items, workspace.logo, {
    competitorsLink,
  });
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
  // The arc only carries published series; a competitor with nothing published
  // isn't public — don't reveal them by name (matches the index dropping them).
  if (identity.entries.length === 0) return NOT_FOUND;

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

  // Published = public: the index reflects only series with a live publication,
  // so an unpublished series never contributes a row, sail number, or year.
  const competitors = toCompetitorIndexEntries(
    await listIdentitiesWithArcs(workspace.id),
    await listPublishedSeriesIds(workspace.id),
  );
  if (competitors.length === 0) return NOT_FOUND;

  // ETag over each row's identity (slug, name, sails, year span, count) so a
  // rename, split, or newly linked series busts the cached index.
  const etag = `"${await contentHash([
    `logo:${workspace.logo}`,
    ...competitors.map(
      (c) =>
        `${c.slug}:${c.name}:${c.sailNumbers.join(',')}:${c.firstYear}-${c.lastYear}:${c.seriesCount}`,
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
  return htmlResponse(html, etag);
}
