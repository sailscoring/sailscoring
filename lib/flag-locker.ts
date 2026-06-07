/**
 * Pure helpers for the flag locker — the per-workspace logo library (shared
 * logo library, tier 1; see docs/notes/canonical-logo-library.md and
 * docs/design/horizon.md). "Flag locker" is the fitting on a boat or in a club
 * where burgees and signal flags are stowed.
 *
 * Runtime-agnostic and dependency-free so it can be imported from both the
 * client (validation, the upload card) and the server, and unit-tested without
 * a DB or Blob. The bytes themselves live in `lib/flag-locker-storage.ts`.
 */

import type { LogoClass } from './types';

/** Logo groupings, in display order. Mirrors the HYC scorers' table and the
 *  classes the canonical tier will use (canonical-logo-library.md §3). */
export const LOGO_CLASSES: readonly LogoClass[] = [
  'governing-body',
  'sailing-club',
  'class-assoc',
  'sponsor',
  'venue',
];

/** Human labels for the classes — used in the picker and the management card. */
export const LOGO_CLASS_LABELS: Record<LogoClass, string> = {
  'governing-body': 'Governing body',
  'sailing-club': 'Sailing club',
  'class-assoc': 'Class association',
  sponsor: 'Sponsor',
  venue: 'Venue',
};

export function isLogoClass(s: string): s is LogoClass {
  return (LOGO_CLASSES as readonly string[]).includes(s);
}

/**
 * Accepted upload formats → canonical file extension. Web-renderable raster
 * formats plus SVG; the canonical-tier note (§6) accepts a high-res raster
 * where vector isn't available, and this is the consuming end of that. BMP and
 * other exotic inputs from ad-hoc club archives are deliberately excluded —
 * re-save as PNG first.
 */
export const LOGO_CONTENT_TYPES: Record<string, string> = {
  'image/svg+xml': 'svg',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export function isAllowedLogoContentType(contentType: string): boolean {
  return Object.prototype.hasOwnProperty.call(LOGO_CONTENT_TYPES, contentType);
}

export function logoExtension(contentType: string): string {
  return LOGO_CONTENT_TYPES[contentType] ?? 'bin';
}

/** Upload cap. Logos are header-slot artwork (~100 px rendered), so 2 MB is
 *  generous for a clean PNG/SVG and keeps the Postgres fallback row small. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/**
 * Storage key for a logo's bytes. Content-addressed by `sha256` and namespaced
 * by workspace, so the object is immutable: a re-upload of changed bytes writes
 * a new key and the row re-points, while identical re-uploads dedupe. The
 * stable handle a consumer references is the row id, never this key.
 */
export function logoBlobKey(
  workspaceId: string,
  sha256: string,
  contentType: string,
): string {
  return `logos/${workspaceId}/${sha256}.${logoExtension(contentType)}`;
}
