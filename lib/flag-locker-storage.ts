import 'server-only';
import { createHash } from 'node:crypto';
import { del, put } from '@vercel/blob';
import { eq } from 'drizzle-orm';

import { getDb } from './db/client';
import * as schema from './db/schema';

/**
 * Storage for flag-locker logo bytes (the per-workspace logo library). Same
 * two-backend shape as `blob-storage.ts` for published HTML, so the upload flow
 * is identical everywhere:
 *
 *   - Production (`BLOB_READ_WRITE_TOKEN` set): Vercel Blob, public access. The
 *     locator is the absolute blob URL.
 *   - Local dev / CI / e2e (no token): the `logo_blobs` Postgres table, bytes
 *     base64-encoded in a text column. The locator is `db:{key}`.
 *
 * `flag_locker_logos.locator` stores whichever locator was used; `readLogo`
 * dispatches on its shape. Keys are content-addressed (`logoBlobKey`), so a
 * locator always names an immutable object.
 */

const DB_PREFIX = 'db:';

function blobTokenConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/** SHA-256 of the asset bytes, hex. Feeds the content-addressed blob key and
 *  the manifest-style provenance the canonical tier records (§5). */
export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Store `bytes` at `key`, overwriting any previous content. Returns a locator. */
export async function putLogo(
  key: string,
  bytes: Buffer,
  contentType: string,
): Promise<string> {
  if (blobTokenConfigured()) {
    const blob = await put(key, bytes, {
      access: 'public',
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return blob.url;
  }

  await getDb()
    .insert(schema.logoBlobs)
    .values({
      key,
      data: bytes.toString('base64'),
      contentType,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.logoBlobs.key,
      set: {
        data: bytes.toString('base64'),
        contentType,
        updatedAt: new Date(),
      },
    });
  return `${DB_PREFIX}${key}`;
}

/**
 * Public, unauthenticated lookup of a logo's stored bytes-locator by id, for
 * the `/logos/{id}` indirection route. Not workspace-scoped: a logo referenced
 * from a published page must resolve for anonymous viewers, and logos aren't
 * secret. Returns enough to serve and to set an ETag (`sha256`).
 */
export async function getPublicLogo(
  id: string,
): Promise<{ locator: string; contentType: string; sha256: string } | null> {
  const [row] = await getDb()
    .select({
      locator: schema.flagLockerLogos.locator,
      contentType: schema.flagLockerLogos.contentType,
      sha256: schema.flagLockerLogos.sha256,
    })
    .from(schema.flagLockerLogos)
    .where(eq(schema.flagLockerLogos.id, id))
    .limit(1);
  return row ?? null;
}

/** Read the bytes for a locator returned by `putLogo`, or null. */
export async function readLogo(locator: string): Promise<Buffer | null> {
  if (locator.startsWith(DB_PREFIX)) {
    const key = locator.slice(DB_PREFIX.length);
    const [row] = await getDb()
      .select({ data: schema.logoBlobs.data })
      .from(schema.logoBlobs)
      .where(eq(schema.logoBlobs.key, key))
      .limit(1);
    return row ? Buffer.from(row.data, 'base64') : null;
  }

  const res = await fetch(locator, { cache: 'no-store' });
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Delete the bytes for a locator returned by `putLogo`. Idempotent — `del`
 * no-ops on a missing object. Skipped when the same bytes are still referenced
 * elsewhere is the caller's concern; here we just remove the object the locator
 * names.
 */
export async function deleteLogo(locator: string): Promise<void> {
  if (locator.startsWith(DB_PREFIX)) {
    const key = locator.slice(DB_PREFIX.length);
    await getDb().delete(schema.logoBlobs).where(eq(schema.logoBlobs.key, key));
    return;
  }
  await del(locator);
}
