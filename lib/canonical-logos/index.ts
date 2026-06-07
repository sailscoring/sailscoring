/**
 * Canonical logo library helpers (shared logo library tier 3). The catalogue is
 * generated at build time into `generated/manifest.ts`; the asset bytes are
 * served from the synced `/canonical-logos/{file}` path. A picker writes a
 * canonical URL into a series' venue/event slot exactly like a flag-locker
 * indirection URL — the renderer just emits `<img src>`.
 */

import type { CanonicalLogo, CanonicalLogoClass } from './types';
import { CANONICAL_LOGOS, CANONICAL_DATASET_VERSION } from './generated/manifest';

export type { CanonicalLogo, CanonicalLogoClass };
export { CANONICAL_LOGOS, CANONICAL_DATASET_VERSION };

export const CANONICAL_CLASS_LABELS: Record<CanonicalLogoClass, string> = {
  'governing-body': 'Governing body',
  'sailing-club': 'Sailing club',
  'class-assoc': 'Class association',
  sponsor: 'Sponsor',
  venue: 'Venue',
  regatta: 'Regatta',
};

/**
 * Public URL for a canonical asset. Served from the app's own origin today
 * (`{base}/canonical-logos/{file}`); `base` is `NEXT_PUBLIC_APP_URL` so
 * downloaded/published exports resolve absolutely, empty for same-origin
 * in-app rendering. Relocating to a dedicated `logos.sailscoring.ie` origin is
 * a future change isolated to this one helper (see docs/design/horizon.md).
 */
export function canonicalLogoUrl(file: string, base = ''): string {
  return `${base.replace(/\/$/, '')}/canonical-logos/${file}`;
}

const CANONICAL_URL_RE = /\/canonical-logos\/([A-Za-z0-9._-]+)$/;

/** The asset filename if `url` is a canonical reference (absolute or relative),
 *  else null — lets the picker recognise and pre-select a stored canonical
 *  choice and distinguish it from a hand-typed URL or a flag-locker reference. */
export function parseCanonicalLogoFile(url: string): string | null {
  const m = url.trim().match(CANONICAL_URL_RE);
  return m ? m[1] : null;
}

/** Catalogue entry whose primary `file` matches a parsed filename. */
export function findCanonicalByFile(file: string): CanonicalLogo | undefined {
  return CANONICAL_LOGOS.find((l) => l.file === file);
}
