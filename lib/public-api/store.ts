import 'server-only';

import { createHash, createHmac } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';

import { deletePublishedObject, putPublishedHtml, readPublishedObject } from '../blob-storage';
import { mapWithConcurrency } from '../concurrency';
import { getDb } from '../db/client';
import { competitorIdentities, competitorIdentityLinks } from '../db/schema/series';
import { instanceTimeZone } from '../instance-time-zone';
import { purgePublishedApiCache } from '../published-cache';
import { getWorkspaceBySlug } from '../published-repository';
import {
  applyPublish,
  competitorIdsOf,
  viewResources,
  type PageContribution,
  type PublicationFacts,
  type PublishedViewState,
} from './published-view';

/**
 * Where the published results API's resources are stored, and how a publish
 * writes them (ADR-015).
 *
 * Each resource is a JSON object at a fixed key derived from its URL — the
 * publication resource at `api/v1/{id}/publication.json`, standings at
 * `api/v1/{id}/standings.json`, and so on — overwritten in place, so the read
 * route finds it from the URL alone and never touches the database. Beside
 * them sits the stored view: the parts each live page last supplied, the
 * publication's facts, and a hash per resource, so a publish rewrites only
 * what changed and an unpublish knows what to remove.
 */

const ROOT = 'api/v1';

/** The storage key of the resource at `path` below a publication (`''` is
 *  the publication itself). */
export function publishedResourceKey(publicationId: string, path: string): string {
  return `${ROOT}/${publicationId}/${path === '' ? 'publication' : path}.json`;
}

function viewKey(publicationId: string): string {
  return `${ROOT}/${publicationId}/_view.json`;
}

const JSON_TYPE = 'application/json; charset=utf-8';
const WRITE_CONCURRENCY = 16;

interface StoredView {
  version: 1;
  view: PublishedViewState;
  facts: PublicationFacts;
  /** Resource path → content hash of what is stored there. */
  hashes: Record<string, string>;
}

async function readStoredView(publicationId: string): Promise<StoredView | null> {
  const text = await readPublishedObject(viewKey(publicationId));
  if (!text) return null;
  const stored = JSON.parse(text) as StoredView;
  return stored.version === 1 ? stored : null;
}

/** The base every URL of one publication's API hangs off. */
export function publicationApiBase(publicationId: string): string {
  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
  return `${origin}/api/public/v1/publications/${publicationId}`;
}

/**
 * The key competitor ids are hashed under. Per instance: `COMPETITOR_ID_KEY`,
 * else one derived from the auth secret so an instance that has not set it
 * still gets ids nobody outside can reverse. Rotating it changes every id at
 * once, which an id's promise — consistent within a series — allows.
 */
function idKey(): string {
  const configured = process.env.COMPETITOR_ID_KEY?.trim();
  if (configured) return configured;
  const secret = process.env.BETTER_AUTH_SECRET ?? 'sailscoring-development';
  return createHmac('sha256', secret).update('published-results-api:competitor-id').digest('hex');
}

/**
 * A competitor's public id: a keyed hash of the series and the competitor's
 * internal id. The series is in the hash, so one sailor's ids in two series
 * are unrelated; following a sailor across series is the identity slug's job.
 */
export function publicCompetitorId(seriesId: string, competitorId: string): string {
  return createHmac('sha256', idKey()).update(`${seriesId}:${competitorId}`).digest('hex').slice(0, 20);
}

/** Identity slugs for the given competitors, where the workspace publishes
 *  competitor pages — its own feature, as the timeline route checks it. */
async function identitySlugs(
  workspaceSlug: string,
  competitorIds: string[],
): Promise<Map<string, string>> {
  if (competitorIds.length === 0) return new Map();
  const workspace = await getWorkspaceBySlug(workspaceSlug);
  if (!workspace?.features.includes('competitor-identity')) return new Map();
  const rows = await getDb()
    .select({ competitorId: competitorIdentityLinks.competitorId, slug: competitorIdentities.slug })
    .from(competitorIdentityLinks)
    .innerJoin(competitorIdentities, eq(competitorIdentities.id, competitorIdentityLinks.identityId))
    .where(
      and(
        eq(competitorIdentities.workspaceId, workspace.id),
        inArray(competitorIdentityLinks.competitorId, competitorIds),
      ),
    );
  return new Map(rows.flatMap((r) => (r.slug ? [[r.competitorId, r.slug] as const] : [])));
}

function hashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Write a publication's published view after a publish.
 *
 * `contributions` are the pages this publish rendered; `livePages` every page
 * the publication holds once it lands. Pages not rendered keep their parts.
 * `facts` restates the publication itself; omitted (a page retraction, which
 * renders nothing), the stored facts stand. Only resources whose content
 * changed are written, and resources no live page shows any more are
 * deleted.
 */
export async function writePublishedView(args: {
  publicationId: string;
  workspaceSlug: string;
  seriesId: string;
  contributions: PageContribution[];
  livePages: ReadonlySet<string>;
  facts?: PublicationFacts;
  publishedAt: number;
}): Promise<void> {
  const { publicationId, workspaceSlug, seriesId, contributions, livePages, publishedAt } = args;
  const stored = await readStoredView(publicationId);
  const facts = args.facts ?? stored?.facts;
  if (!facts) return;

  const internalIds = [...new Set(contributions.flatMap((c) => competitorIdsOf(c.view)))];
  const slugs = await identitySlugs(workspaceSlug, internalIds);
  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
  const apiBase = publicationApiBase(publicationId);
  const ctx = {
    apiBase,
    competitor(internalId: string) {
      const slug = slugs.get(internalId);
      return {
        id: publicCompetitorId(seriesId, internalId),
        ...(slug
          ? { identity: { slug, url: `${origin}/p/${workspaceSlug}/competitor/${slug}` } }
          : {}),
      };
    },
  };

  const view = applyPublish(stored?.view ?? null, contributions, livePages, publishedAt, ctx);
  const resources = viewResources(view, { id: publicationId, facts }, instanceTimeZone(), apiBase);

  const previous = stored?.hashes ?? {};
  const hashes: Record<string, string> = {};
  const writes: Array<{ path: string; json: string }> = [];
  for (const [path, body] of resources) {
    const json = JSON.stringify(body);
    hashes[path] = hashOf(json);
    if (previous[path] !== hashes[path]) writes.push({ path, json });
  }
  await mapWithConcurrency(writes, WRITE_CONCURRENCY, ({ path, json }) =>
    putPublishedHtml(publishedResourceKey(publicationId, path), json, JSON_TYPE),
  );
  const removed = Object.keys(previous).filter((path) => !(path in hashes));
  await mapWithConcurrency(removed, WRITE_CONCURRENCY, (path) =>
    deletePublishedObject(publishedResourceKey(publicationId, path)),
  );
  const next: StoredView = { version: 1, view, facts, hashes };
  await putPublishedHtml(viewKey(publicationId), JSON.stringify(next), JSON_TYPE);
  if (writes.length > 0 || removed.length > 0) await purgePublishedApiCache(publicationId);
}

/** Remove every API resource of a publication, and its stored view. */
export async function deletePublishedView(publicationId: string): Promise<void> {
  const stored = await readStoredView(publicationId);
  const paths = Object.keys(stored?.hashes ?? {});
  await mapWithConcurrency(paths, WRITE_CONCURRENCY, (path) =>
    deletePublishedObject(publishedResourceKey(publicationId, path)),
  );
  await deletePublishedObject(viewKey(publicationId));
  if (paths.length > 0) await purgePublishedApiCache(publicationId);
}
