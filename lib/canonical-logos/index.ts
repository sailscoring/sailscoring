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

/** The dedicated canonical-logo origin, when configured. In production this is
 *  `https://logos.sailscoring.ie`, which serves the dataset bundle at its root
 *  (`/{file}`). When unset — local dev, CI, e2e — the app self-hosts the synced
 *  bundle under `/canonical-logos/{file}` from `public/` instead. */
const CANONICAL_ORIGIN = (process.env.NEXT_PUBLIC_CANONICAL_LOGOS_URL ?? '').replace(
  /\/$/,
  '',
);

/**
 * Public URL for a canonical asset. With a dedicated origin configured it is
 * `{origin}/{file}` (already absolute); otherwise the app-hosted fallback
 * `{appBase}/canonical-logos/{file}` — `appBase` is `NEXT_PUBLIC_APP_URL` so
 * downloaded/published exports resolve absolutely, empty for same-origin
 * in-app rendering. The hosting choice is isolated to this one helper.
 */
export function canonicalLogoUrl(file: string, appBase = ''): string {
  if (CANONICAL_ORIGIN) return `${CANONICAL_ORIGIN}/${file}`;
  return `${appBase.replace(/\/$/, '')}/canonical-logos/${file}`;
}

const CANONICAL_PATH_RE = /\/canonical-logos\/([A-Za-z0-9._-]+)$/;

/** The asset filename if `url` is a canonical reference (dedicated origin or
 *  app-hosted fallback, absolute or relative), else null — lets the picker
 *  recognise and pre-select a stored canonical choice and distinguish it from a
 *  hand-typed URL or a flag-locker reference. */
export function parseCanonicalLogoFile(url: string): string | null {
  const u = url.trim();
  if (CANONICAL_ORIGIN && u.startsWith(`${CANONICAL_ORIGIN}/`)) {
    const rest = u.slice(CANONICAL_ORIGIN.length + 1);
    return rest && !rest.includes('/') ? rest : null;
  }
  const m = u.match(CANONICAL_PATH_RE);
  return m ? m[1] : null;
}

/** Catalogue entry whose primary `file` matches a parsed filename. */
export function findCanonicalByFile(file: string): CanonicalLogo | undefined {
  return CANONICAL_LOGOS.find((l) => l.file === file);
}
