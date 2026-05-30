/**
 * Pure helpers for the in-app publishing path (ADR-008 Phase 9/10, the bilge
 * replacement — #153). Runtime-agnostic: uses Web Crypto (`crypto.subtle`),
 * available in both the Node server runtime and tests.
 *
 * Published URLs are `/p/{workspaceSlug}/{seriesSlug}/{subPath}`:
 *   - `workspaceSlug` is the org slug (`hyc`, or `u-{id}` for personal).
 *   - `seriesSlug` is `kebab(series name)` by default, editable at first
 *     publish, frozen after, unique within the workspace.
 *   - `subPath` is `standings` for a single (default) fleet, or `kebab(fleet)`
 *     for a named fleet. The bare `/p/{ws}/{series}` is reserved for the
 *     listing (#162), so every fleet is a sub-page.
 */

/** Lowercase, hyphenate runs of non-alphanumerics, trim hyphens. */
export function kebab(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'series'
  );
}

/** Default series slug for first publish — just the kebab-cased name. The
 *  workspace namespaces it, so no global suffix is needed; in-workspace
 *  collisions are resolved by the publish handler. */
export function deriveSeriesSlug(seriesName: string): string {
  return kebab(seriesName);
}

/** Human-readable title derived from a slug, for a shared-namespace listing
 *  with several contributing series (no single series name fits). Splits on
 *  hyphens and title-cases: `2026-lambay-races` → `2026 Lambay Races`. */
export function humanizeSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Sub-path under the series slug for a fleet's page. A single (default) fleet
 * is served at `standings`; named fleets at `kebab(fleetName)`. This is the
 * sole-contributor scheme — see {@link publicationSubPath} for the shared case.
 */
export function fleetSubPath(fleetName: string, isDefault: boolean): string {
  return isDefault ? 'standings' : kebab(fleetName);
}

/**
 * Sub-path for a fleet's page within a (possibly shared) slug. A slug is a
 * shared namespace: when a series is the *sole* contributor its single default
 * fleet keeps the clean `standings` path, but when it co-publishes with others
 * the default fleet is served at the series' own slug instead — otherwise two
 * single-fleet series would both claim `standings`. Named fleets are always
 * `kebab(fleetName)` (distinct fleet names keep them apart; the publish handler
 * rejects a residual clash). Assigned once and then frozen per page, so a
 * publication's URLs never shift when another series later joins or leaves.
 */
export function publicationSubPath(
  fleetName: string,
  isDefault: boolean,
  seriesSlug: string,
  shared: boolean,
): string {
  if (!isDefault) return kebab(fleetName);
  return shared ? seriesSlug : 'standings';
}

/**
 * Storage key for a published page. The publication's `contentHash` is folded
 * into the key so every re-publish writes a *new* blob object rather than
 * overwriting one at a stable pathname. Overwrites have a read-after-write
 * propagation window on Vercel Blob (a stale copy can be served for up to a
 * minute or more after a re-publish); a brand-new object has none. The public
 * URL never carries the hash — the `/p/...` route resolves it via the DB row's
 * stored `blobUrl` — so this stays purely an internal storage detail. Superseded
 * objects are deleted by the publish handler once the row points at the new ones.
 */
export function publishedBlobKey(
  workspaceSlug: string,
  seriesSlug: string,
  subPath: string,
  contentHash: string,
): string {
  return `p/${workspaceSlug}/${seriesSlug}/${subPath}-${contentHash}`;
}

/**
 * Stable content hash over all of a publication's page HTML. Used both to skip
 * re-uploading unchanged content and as the `ETag` for served pages.
 */
export async function contentHash(htmlParts: string[]): Promise<string> {
  const data = new TextEncoder().encode(htmlParts.join(' '));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
