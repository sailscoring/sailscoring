import 'server-only';

import { BadRequestError, NotFoundError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { deletePublishedHtml, putPublishedHtml } from '@/lib/blob-storage';
import { mapWithConcurrency } from '@/lib/concurrency';
import { createRepos } from '@/lib/postgres-repository';
import { captureRevision, sealOpenRevisions } from '@/lib/revision-log';
import {
  contentHash,
  deriveSeriesSlug,
  kebab,
  publicationSubPath,
  publishedBlobKey,
} from '@/lib/publishing';
import {
  deletePublished,
  getPublishedById,
  getPublishedBySeries,
  getPublishedGroupByWorkspaceSlug,
  getSeriesName,
  listPublishedForWorkspace,
  savePublished,
} from '@/lib/published-repository';
import { producesPage, resolvePublishingGroups } from '@/lib/publishing-groups';
import { buildFleetHtmlFiles } from '@/lib/results-export';
import type { ExportRepos } from '@/lib/public-export';
import type {
  PublicationStatus,
  PublishResult,
  PublishedListItem,
  PublishedSeries,
  PublishedSeriesPage,
} from '@/lib/types';
import type { PublishInput } from '@/lib/validation/publish';

const MAX_SLUG_LENGTH = 60;

// Pages upload (and superseded blobs delete) concurrently rather than one
// round-trip at a time — a 40+ page season otherwise takes tens of seconds.
// Capped well under Vercel Blob's per-second advanced-operation budget (Pro:
// 75/s) so several scorers publishing at once share the limit comfortably; on
// the Hobby plan (15/s) a large or concurrent publish can still 429, which is
// why production publishing assumes Pro (see DEPLOY.md).
const PUBLISH_BLOB_CONCURRENCY = 16;

/** A slug or sub-path: lowercase alphanumerics in hyphen-separated runs, no
 *  leading/trailing/double hyphens, capped length. Shared by the series slug
 *  and the per-fleet sub-path overrides — same character set, same limit. */
function isValidSlugSegment(value: string): boolean {
  return value.length <= MAX_SLUG_LENGTH && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function appBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
}

function toResult(
  workspaceSlug: string,
  published: PublishedSeries,
): PublishResult {
  const base = `${appBase()}/p/${workspaceSlug}/${published.slug}`;
  return {
    slug: published.slug,
    publishedAt: published.publishedAt,
    publishedVersion: published.publishedVersion,
    pages: published.pages.map((p) => ({
      fleetName: p.fleetName,
      ...(p.subSeriesName ? { subSeriesName: p.subSeriesName } : {}),
      url: `${base}/${p.subPath}`,
    })),
  };
}

/** Display names of the other publications sharing a slug, for the
 *  `slug-shared` confirmation. An orphan (its series deleted) has no live name,
 *  so it reads as a leftover snapshot. */
async function contributorNames(others: PublishedSeries[]): Promise<string[]> {
  const names: string[] = [];
  for (const p of others) {
    const name = p.seriesId ? await getSeriesName(p.seriesId) : null;
    names.push(name ?? '(deleted series)');
  }
  return names;
}

function exportReposFor(workspaceId: string): ExportRepos {
  const repos = createRepos({ workspaceId });
  return {
    seriesRepo: repos.series,
    competitorRepo: repos.competitors,
    raceRepo: repos.races,
    fleetRepo: repos.fleets,
    subSeriesRepo: repos.subSeries,
    finishRepo: repos.finishes,
    raceStartRepo: repos.raceStarts,
    raceRatingOverrideRepo: repos.raceRatingOverrides,
    logoRepo: repos.logos,
  };
}

/**
 * Publish a series' current results (ADR-008 Phase 9/10). Renders each fleet to
 * static HTML, stores it under `/p/{workspaceSlug}/{slug}/{subPath}`, and
 * records it in `published_series`. Explicit, point-in-time: re-publishing
 * overwrites; editing the series afterwards does not.
 *
 * A slug is a *shared namespace*: several series can publish into the same
 * `(workspace, slug)` and the public read path unions their fleet pages (e.g.
 * "Lambay Races Cruisers" + "Lambay Races One Designs" → `/p/{ws}/2026-lambay-races`).
 *
 * - **First publish:** the slug is `deriveSeriesSlug(name)` unless the caller
 *   supplied one. If other series (or an orphaned snapshot) already publish at
 *   that slug, the caller must confirm with `join: true`; otherwise it's
 *   rejected with `slug-shared` (carrying the existing contributor names).
 * - **Re-publish:** the slug is frozen — any supplied slug is ignored. Unchanged
 *   content (same hash) is a no-op.
 *
 * Either way, each contributor's fleet sub-paths must stay unique within the
 * slug (so every fleet URL resolves to one publication); a clash is rejected
 * with `subpath-collision` naming the offending fleet.
 *
 * `input.fleets` selects which fleets to publish/update now (omit for all); it
 * is not "the publication is exactly this set" — a fleet left out is skipped, so
 * an already-published one keeps its current live page (Unpublish removes pages).
 * `input.subPaths` overrides a not-yet-published fleet's URL sub-path (a
 * published fleet's path is frozen like the slug); a bad override is rejected
 * with `invalid-subpath`.
 */
export async function publishSeries(
  workspace: WorkspaceContext,
  seriesId: string,
  input: PublishInput,
): Promise<PublishResult> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const series = await repos.series.get(seriesId);
  if (!series) throw new NotFoundError('series');

  const existing = await getPublishedBySeries(seriesId);

  // Resolve the slug up front — it depends only on the series name, the existing
  // publication, and the requested slug, not on the rendered HTML. Doing it
  // before the build lets each fleet page carry a `← {series}` breadcrumb up to
  // its series index `/p/{ws}/{slug}` (the slug is frozen, so the link is stable
  // across re-publishes and doesn't perturb the content hash).
  let id: string;
  let slug: string;
  if (existing) {
    // Re-publish: slug is frozen.
    id = existing.id;
    slug = existing.slug;
  } else {
    // First publish: derive or accept a slug.
    const requested = input.slug?.trim();
    slug = requested ? requested : deriveSeriesSlug(series.name);
    if (!isValidSlugSegment(slug)) {
      throw new BadRequestError('invalid slug', { code: 'invalid-slug' });
    }
    id = crypto.randomUUID();
  }

  const allFiles = await buildFleetHtmlFiles(
    exportReposFor(workspace.workspaceId),
    seriesId,
    `${appBase()}/p/${workspace.workspaceSlug}/${slug}`,
  );
  if (!allFiles) throw new NotFoundError('series has no publishable results');

  // Selective publishing: `fleets` is the set to publish/update *now* (omit for
  // all). It is not "the publication is exactly this set" — a fleet left out is
  // simply skipped this round, so an already-published one keeps its current
  // live page untouched (work-in-progress on one fleet shouldn't disturb the
  // others, or quietly retract them). Removing a page is what Unpublish is for
  // — with the one exception of pages retracted by suppression below.
  const ticked = input.fleets ? new Set(input.fleets) : null;
  const toBuild = ticked
    ? allFiles.filter((f) => ticked.has(f.fleetName))
    : allFiles;
  const carriedAll = ticked
    ? (existing?.pages ?? []).filter((p) => !ticked.has(p.fleetName))
    : [];

  // Pages are identified by (sub-series, fleet) — a series with blocks
  // publishes one page per block per fleet; a blockless one per fleet.
  const pageKey = (p: { fleetName: string; subSeriesName?: string }): string =>
    `${p.subSeriesName ?? ''}\u0000${p.fleetName}`;

  // With individual fleet pages switched off (#255), the published output is
  // exactly the combined pages. The build above emits no standalone fleet
  // files; here, a *previously published* fleet page is retracted — removed
  // from the publication and its blob deleted — rather than carried, which
  // would leave it permanently stale with no per-page unpublish to remove
  // it. The guard: a view's fleet pages only retract once a combined page is
  // live in that view after this publish (built now, or carried from a
  // previous one) — pages never come down before something replaces the
  // view's output, e.g. when a freshly-defined group is still unticked. On a
  // block series both sides carry the block: a (block, fleet) page retracts
  // only when a (same block, group) page is live — groups apply within each
  // block, never across them.
  const fleetRows = await repos.fleets.listBySeries(seriesId);
  let retracted: PublishedSeriesPage[] = [];
  if (series.publishIndividualFleetPages === false) {
    const liveKeys = new Set([...toBuild.map(pageKey), ...carriedAll.map(pageKey)]);
    const groupNames = resolvePublishingGroups(series.publishingGroups, fleetRows)
      .filter(producesPage)
      .map((r) => r.group.name.trim());
    const fleetNames = new Set(fleetRows.map((f) => f.name));
    retracted = (existing?.pages ?? []).filter(
      (p) =>
        fleetNames.has(p.fleetName) &&
        groupNames.some((g) =>
          liveKeys.has(
            pageKey({
              fleetName: g,
              ...(p.subSeriesName ? { subSeriesName: p.subSeriesName } : {}),
            }),
          ),
        ),
    );
  }

  // Pages for fleets we're not rebuilding carry over verbatim — same sub-path,
  // same (content-addressed) blob. Retracted pages never carry.
  const retractedUrls = new Set(retracted.map((p) => p.blobUrl));
  const carried = carriedAll.filter((p) => !retractedUrls.has(p.blobUrl));

  if (toBuild.length === 0 && carried.length === 0) {
    throw new BadRequestError('no fleets selected to publish', {
      code: 'no-fleets-selected',
    });
  }

  // Hash over exactly what this publish yields: freshly-rendered pages for the
  // built fleets, plus each carried page's blob URL as a stable proxy for its
  // unchanged content. Identical input ⇒ same hash ⇒ no-op.
  const hash = await contentHash([
    ...toBuild.map((f) => f.html),
    ...carried.map((p) => p.blobUrl),
  ]);

  // Blobs the previous publication held that we're about to replace; deleted
  // after the row points at the new (content-addressed) objects. Carried pages
  // keep their blob, so only the rebuilt fleets' old blobs are superseded —
  // plus any page retracted by suppression, whose blob has no successor.
  let supersededPages: PublishedSeriesPage[] = [];
  if (existing) {
    if (existing.contentHash === hash) return toResult(workspace.workspaceSlug, existing);
    supersededPages = ticked
      ? existing.pages.filter((p) => ticked.has(p.fleetName))
      : existing.pages;
    const supersededUrls = new Set(supersededPages.map((p) => p.blobUrl));
    supersededPages.push(...retracted.filter((p) => !supersededUrls.has(p.blobUrl)));
  }

  // Other publications sharing this slug (the slug is a shared namespace), with
  // this series' own row excluded. Drives the join confirmation and the
  // sub-path collision guard — both apply to first publish and re-publish.
  const others = (
    await getPublishedGroupByWorkspaceSlug(workspace.workspaceId, slug)
  ).filter((p) => p.seriesId !== seriesId);

  // First publish into an occupied slug needs explicit confirmation, so two
  // unrelated events never merge by accident.
  if (!existing && others.length > 0 && !input.join) {
    throw new BadRequestError('slug already in use by other series', {
      code: 'slug-shared',
      sharedWith: await contributorNames(others),
    });
  }

  // Sub-paths are frozen per page: a fleet that was already published keeps its
  // existing path, so a publication's URLs never shift when another series later
  // joins (or leaves) the slug — or when the scorer overrides a sibling's path.
  // Resolution order: frozen (immutable once published) → caller override (only
  // for a not-yet-frozen fleet) → derived default. Only genuinely new fleets get
  // a fresh path, and only those accept an override. Sub-series pages live one
  // segment down — `kebab(block)/{leaf}` — so each block reads as its own
  // little series under the slug.
  const frozen = new Map(
    (existing?.pages ?? []).map((p) => [pageKey(p), p.subPath]),
  );
  const shared = others.length > 0;
  const seriesSlug = deriveSeriesSlug(series.name);
  const overrides = input.subPaths ?? {};
  // The lone default page is overridden via `defaultSubPath` (keyed by
  // `isDefault`), since its fleet name can be synthetic and unknown to the
  // client; named fleets use `subPaths[fleetName]`.
  const defaultOverride = input.defaultSubPath?.trim();
  const subPathFor = (file: { fleetName: string; isDefault: boolean; subSeriesName?: string }): string => {
    const existingPath = frozen.get(pageKey(file));
    if (existingPath !== undefined) return existingPath;
    const override = file.isDefault ? defaultOverride : overrides[file.fleetName]?.trim();
    let leaf: string;
    if (override) {
      if (!isValidSlugSegment(override)) {
        throw new BadRequestError('invalid fleet sub-path', {
          code: 'invalid-subpath',
          fleetName: file.fleetName,
        });
      }
      leaf = override;
    } else {
      leaf = publicationSubPath(file.fleetName, file.isDefault, seriesSlug, shared);
    }
    return file.subSeriesName ? `${kebab(file.subSeriesName)}/${leaf}` : leaf;
  };

  // Resolve each built page's path once, then guard uniqueness on two fronts:
  // no two of this series' own live pages may share a path (overrides — and
  // carried pages — make that possible), and none may collide with another
  // contributor publishing into the same slug. Carried pages already occupy
  // their paths, so seed `mine` with them.
  const taken = new Set(others.flatMap((p) => p.pages.map((pg) => pg.subPath)));
  const subPaths = new Map<string, string>();
  const mine = new Set<string>(carried.map((p) => p.subPath));
  for (const file of toBuild) {
    const subPath = subPathFor(file);
    if (taken.has(subPath) || mine.has(subPath)) {
      throw new BadRequestError('fleet URL collides with another fleet', {
        code: 'subpath-collision',
        fleetName: file.fleetName,
      });
    }
    mine.add(subPath);
    subPaths.set(pageKey(file), subPath);
  }

  const built = await mapWithConcurrency(
    toBuild,
    PUBLISH_BLOB_CONCURRENCY,
    async (file) => {
      const subPath = subPaths.get(pageKey(file))!;
      const key = publishedBlobKey(workspace.workspaceSlug, slug, subPath, hash);
      const blobUrl = await putPublishedHtml(key, file.html);
      const page: PublishedSeriesPage = {
        fleetName: file.fleetName,
        ...(file.subSeriesName ? { subSeriesName: file.subSeriesName } : {}),
        subPath,
        blobUrl,
      };
      return [pageKey(file), page] as const;
    },
  );
  const builtByKey = new Map(built);

  // Merge built and carried pages, ordered as built (block order, then the
  // series' fleet order); any carried page whose (block, fleet) no longer
  // exists — a deleted fleet's leftover page, or a page from before the
  // series gained blocks — is kept at the end rather than silently dropped.
  const carriedByKey = new Map(carried.map((p) => [pageKey(p), p]));
  const pages: PublishedSeriesPage[] = [];
  for (const file of allFiles) {
    const page = builtByKey.get(pageKey(file)) ?? carriedByKey.get(pageKey(file));
    if (page) pages.push(page);
  }
  const known = new Set(allFiles.map((f) => pageKey(f)));
  for (const page of carried) {
    if (!known.has(pageKey(page))) pages.push(page);
  }

  const published: PublishedSeries = {
    id,
    workspaceId: workspace.workspaceId,
    seriesId,
    slug,
    pages,
    contentHash: hash,
    publishedAt: Date.now(),
    publishedVersion: series.version ?? 1,
  };
  await savePublished(published);

  // Now that the row resolves to the fresh blobs, drop the superseded ones.
  // Content-addressed keys differ by hash, so none of these are still in use.
  // Best-effort: a failed delete leaks a blob but never serves stale results.
  await mapWithConcurrency(supersededPages, PUBLISH_BLOB_CONCURRENCY, (page) =>
    deletePublishedHtml(page.blobUrl),
  );

  // Revision milestone (#166): seal the open session and pin a `publish`
  // revision capturing exactly what went public — a clean "restore to what I
  // published" point and an audit anchor. Best-effort; never fails the publish.
  const actor = { workspaceId: workspace.workspaceId, userId: workspace.userId };
  await sealOpenRevisions(workspace.workspaceId, seriesId);
  await captureRevision(actor, seriesId, {
    kind: 'publish',
    label: `Published to /p/${workspace.workspaceSlug}/${slug}`,
  });

  return toResult(workspace.workspaceSlug, published);
}

/**
 * The publish dialog's view of a series on open: the workspace slug (for the
 * URL preview), the default slug for first publish, and the current publication
 * if any. Workspace-scoped — a series the caller can't see is a 404.
 */
export async function getPublication(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<PublicationStatus> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const series = await repos.series.get(seriesId);
  if (!series) throw new NotFoundError('series');
  const existing = await getPublishedBySeries(seriesId);
  return {
    workspaceSlug: workspace.workspaceSlug,
    suggestedSlug: deriveSeriesSlug(series.name),
    published: existing ? toResult(workspace.workspaceSlug, existing) : null,
  };
}

/**
 * Every publication in the workspace for the management page (#164), newest
 * first, each with its public series-index URL. Includes orphans — snapshots
 * whose series was deleted — which this page is the only place to manage.
 */
export async function listPublished(
  workspace: WorkspaceContext,
): Promise<PublishedListItem[]> {
  const rows = await listPublishedForWorkspace(workspace.workspaceId);
  return rows.map((r) => ({
    ...r,
    url: `${appBase()}/p/${workspace.workspaceSlug}/${r.slug}`,
  }));
}

/**
 * Take a publication down: delete its stored HTML blobs, then drop the row. The
 * public page 404s and the `(workspace, slug)` frees for reuse. The two listing
 * pages (#162) are rendered live from `published_series`, so there is no index
 * blob to regenerate here.
 */
async function unpublish(published: PublishedSeries): Promise<void> {
  for (const page of published.pages) {
    await deletePublishedHtml(page.blobUrl);
  }
  await deletePublished(published.id);
}

/** Unpublish by publication id — the management page's canonical path, the only
 *  one that can reach an orphan. Scoped to the caller's workspace. */
export async function unpublishById(
  workspace: WorkspaceContext,
  id: string,
): Promise<void> {
  const published = await getPublishedById(id);
  if (!published || published.workspaceId !== workspace.workspaceId) {
    throw new NotFoundError('publication');
  }
  await unpublish(published);
}

/** Unpublish a live series' publication — the publish dialog's convenience
 *  path. A series with no publication is a no-op (already unpublished). */
export async function unpublishBySeries(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<void> {
  const published = await getPublishedBySeries(seriesId);
  if (!published) return;
  if (published.workspaceId !== workspace.workspaceId) {
    throw new NotFoundError('publication');
  }
  await unpublish(published);
}
