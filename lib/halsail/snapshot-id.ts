import { createHash } from 'node:crypto';

/** Matches the RFC 4122 shape `z.uuid()` enforces (any version, variant
 *  8/9/a/b). The app validates `lastSnapshotId`/`snapshotHistory` at the API
 *  boundary with `z.uuid()`, so any externally-minted lineage id must satisfy
 *  this even though Postgres' `uuid` column is more lenient. */
export const RFC_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Derive a deterministic, RFC 4122 v4-shaped UUID from a content string.
 *  Stable for identical input (so an unchanged regeneration is byte-identical)
 *  while forcing the version (4) and variant (8/9/a/b) nibbles a raw hash slice
 *  would otherwise get wrong. */
export function contentHashUuid(content: string): string {
  const h = createHash('sha256').update(content).digest('hex');
  const version = '4';
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    version + h.slice(13, 16),
    variant + h.slice(17, 20),
    h.slice(20, 32),
  ].join('-');
}
