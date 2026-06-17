/**
 * The built-in canonical logo library (shared logo library tier 3; see
 * docs/notes/canonical-logo-library.md). A maintained, versioned dataset of
 * official sailing logos lives in `sailscoring/canonical-logos` and is consumed
 * at build time (see `scripts/sync-canonical-logos.ts`). Unlike the
 * per-workspace flag locker, the canonical tier is a *reference*: the renderer
 * links to the hosted asset so it tracks the official version.
 */

/** Canonical logo groupings. A superset of the workspace `LogoClass` — the
 *  dataset also tracks one-off `regatta` brands, which don't fit the
 *  per-workspace classes. */
export type CanonicalLogoClass =
  | 'governing-body'
  | 'sailing-club'
  | 'class-assoc'
  | 'sponsor'
  | 'venue'
  | 'regatta';

/** A single catalogue entry. The asset bytes are served from the synced
 *  `/canonical-logos/{file}` path; this is the picker-facing metadata. `file`
 *  and `small` are basenames (the `logos/` prefix is stripped on sync). */
export interface CanonicalLogo {
  id: string;
  logoClass: CanonicalLogoClass;
  displayName: string;
  file: string;
  format: 'svg' | 'png';
  /** Small derivative for the ~100 px header slot, if the dataset ships one. */
  small?: string;
  /** The org's official website, when the dataset records one. The logo picker
   *  uses it as the default click-through target for the series venue/event slot
   *  the logo is chosen for. */
  homepageUrl?: string;
  /** `provisional` marks a deliberately-kept sub-par best-available asset. */
  quality: 'ok' | 'provisional';
}
