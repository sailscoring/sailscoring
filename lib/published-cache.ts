import 'server-only';
import { dangerouslyDeleteByTag } from '@vercel/functions';

/**
 * CDN cache invalidation for the public `/p/` pages.
 *
 * Every public page of a workspace carries one tag, so any change to a
 * publication drops all of that workspace's cached pages at once. Per-page
 * tagging would be tighter, but the navigation cascade (ADR-011) means a
 * publish can change *any* page in the workspace — the season tree and folder
 * listings a page renders are drawn from every other publication — so
 * whole-workspace is the honest granularity.
 */

/** The tag covering every public page of one workspace. */
export function publishedCacheTag(workspaceId: string): string {
  return `p:${workspaceId}`;
}

/**
 * The tag covering the public directory of workspaces (`/p/` and its JSON
 * twin). The directory draws on every listed workspace's publications, so any
 * publication change anywhere can change it — every purge below drops it too.
 * A workspace id is a random token, so no workspace tag can equal it.
 */
export const DIRECTORY_CACHE_TAG = 'p:directory';

/**
 * Drop a workspace's public pages from the CDN.
 *
 * Deliberately `dangerouslyDeleteByTag` and not `invalidateByTag`. Invalidate
 * is stale-while-revalidate: the first viewer after a publish is served the
 * *old* page while the new one regenerates behind them — precisely the
 * scorer-reloads-after-publishing case the public read path exists to get
 * right (#162). Delete regenerates in the foreground, so that reload shows
 * the new results. The cache-stampede risk the name warns about is bounded
 * here: Vercel collapses concurrent misses on a cacheable path into one
 * origin request per region, so a publish-time reload burst costs one
 * regeneration, not one per viewer.
 *
 * Off Vercel there is no CDN to purge and the call would have nothing to talk
 * to, so this is a no-op in local dev, CI and e2e — where the pages are
 * uncached anyway and therefore always fresh.
 *
 * Failure is logged, not thrown. The write it follows has already succeeded,
 * and failing the publish would be worse than the staleness: `s-maxage` is
 * the floor, so an unpurged page self-corrects within a minute.
 */
export async function purgePublishedCache(workspaceId: string): Promise<void> {
  await deleteTags([publishedCacheTag(workspaceId), DIRECTORY_CACHE_TAG]);
}

/** The tag covering one publication's published results API resources
 *  (ADR-015). Separate from the workspace tag: the API's resources change
 *  only when that publication's view is written, and its read path never
 *  learns which workspace a publication belongs to. */
export function publishedApiCacheTag(publicationId: string): string {
  return `api:${publicationId}`;
}

/** Drop one publication's API resources from the CDN. Same no-op-off-Vercel
 *  and log-don't-throw contract as above. */
export async function purgePublishedApiCache(publicationId: string): Promise<void> {
  await deleteTags([publishedApiCacheTag(publicationId)]);
}

/** Drop the public directory alone — for a change to how a workspace is
 *  listed (its opt-out, its description) rather than to what it publishes.
 *  Same no-op-off-Vercel and log-don't-throw contract as above. */
export async function purgeDirectoryCache(): Promise<void> {
  await deleteTags([DIRECTORY_CACHE_TAG]);
}

async function deleteTags(tags: string[]): Promise<void> {
  if (!process.env.VERCEL) return;
  try {
    await dangerouslyDeleteByTag(tags);
  } catch (err) {
    console.error('purgePublishedCache failed (non-fatal):', err);
  }
}
