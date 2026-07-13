/**
 * Deterministic ids for archive ingest documents (ADR-010, #283).
 *
 * Every id in an ingest document is a UUIDv5 of stable archive-repo inputs,
 * so regenerating and re-ingesting updates rows in place and can never mint
 * duplicates. The namespace is fixed forever — changing it would move every
 * derived id and orphan the identity links hanging off competitor rows.
 * (Same posture as the identity manifest's `identityIdForSlug`.)
 */

import { createHash } from 'node:crypto';

/** Fixed namespace for archive-document ids. Arbitrary but permanent. */
const ARCHIVE_NS = '7c1f9d54-3e82-5b17-9a60-2f4d8c5e0b39';

/** RFC 4122 name-based (SHA-1) UUID. SHA-1 is the v5 definition, not a
 *  security choice; the ids are persisted, so the algorithm never changes. */
export function uuidv5(name: string, namespace: string = ARCHIVE_NS): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1')
    .update(ns)
    .update(Buffer.from(name, 'utf8'))
    .digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** A series id from the archive repo's stable per-series key (e.g. its
 *  manifest slug). Only for series the repo doesn't already pin an id for. */
export function seriesIdForKey(repoKey: string, seriesKey: string): string {
  return uuidv5(`${repoKey}/series/${seriesKey}`);
}

/** A fleet id within a series, from the fleet's name. */
export function fleetIdFor(seriesId: string, fleetName: string): string {
  return uuidv5(`${seriesId}/fleet/${fleetName}`);
}

/** A competitor id within a series, from a stable per-row key the generator
 *  derives (typically fleet + sail + normalised name + a dedup ordinal). */
export function competitorIdFor(seriesId: string, rowKey: string): string {
  return uuidv5(`${seriesId}/competitor/${rowKey}`);
}
