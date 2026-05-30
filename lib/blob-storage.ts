import 'server-only';
import { del, put } from '@vercel/blob';
import { eq } from 'drizzle-orm';

import { getDb } from './db/client';
import * as schema from './db/schema';

/**
 * Storage for published results HTML (ADR-008 Phase 9). Two backends behind one
 * surface so the publish flow is identical everywhere:
 *
 *   - Production (`BLOB_READ_WRITE_TOKEN` set): Vercel Blob, public access. The
 *     locator is the absolute blob URL.
 *   - Local dev / CI / e2e (no token): the `published_blobs` Postgres table.
 *     The locator is `db:{key}`, read back through the same DB.
 *
 * `pages[].blobUrl` in `published_series` stores whichever locator was used;
 * `readPublishedHtml` dispatches on its shape. This keeps local development
 * free of external services (the ADR's stated goal) without the `/p/{slug}`
 * route having to know which backend produced a publication.
 */

const DB_PREFIX = 'db:';

function blobTokenConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/** Store `html` at `key`, overwriting any previous content. Returns a locator. */
export async function putPublishedHtml(
  key: string,
  html: string,
): Promise<string> {
  if (blobTokenConfigured()) {
    const blob = await put(key, html, {
      access: 'public',
      contentType: 'text/html; charset=utf-8',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return blob.url;
  }

  await getDb()
    .insert(schema.publishedBlobs)
    .values({ key, html, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.publishedBlobs.key,
      set: { html, updatedAt: new Date() },
    });
  return `${DB_PREFIX}${key}`;
}

/**
 * Read the HTML for a locator returned by `putPublishedHtml`, or null.
 *
 * No cache-busting is needed: each publish writes a content-addressed blob key
 * (see `publishedBlobKey`), so a locator always names an immutable object that
 * is never overwritten. `cache: 'no-store'` keeps Next.js from caching the
 * fetch; the `/p/...` route applies its own `Cache-Control`/ETag to the served
 * response. The Postgres fallback reads its row directly.
 */
export async function readPublishedHtml(
  locator: string,
): Promise<string | null> {
  if (locator.startsWith(DB_PREFIX)) {
    const key = locator.slice(DB_PREFIX.length);
    const [row] = await getDb()
      .select({ html: schema.publishedBlobs.html })
      .from(schema.publishedBlobs)
      .where(eq(schema.publishedBlobs.key, key))
      .limit(1);
    return row?.html ?? null;
  }

  const res = await fetch(locator, { cache: 'no-store' });
  return res.ok ? res.text() : null;
}

/**
 * Delete the stored HTML for a locator returned by `putPublishedHtml`. The
 * unpublish path (#164) calls this for each of a publication's pages before
 * dropping the row. Dispatches on the locator like `readPublishedHtml`: a
 * `db:` locator deletes the fallback row; a Blob URL is removed from the store.
 * Idempotent — `del` no-ops on a missing object.
 */
export async function deletePublishedHtml(locator: string): Promise<void> {
  if (locator.startsWith(DB_PREFIX)) {
    const key = locator.slice(DB_PREFIX.length);
    await getDb()
      .delete(schema.publishedBlobs)
      .where(eq(schema.publishedBlobs.key, key));
    return;
  }
  await del(locator);
}
