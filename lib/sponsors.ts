/**
 * The sponsors whose funding keeps the service free, and the burgee footer they
 * are recognised with on the pages we host.
 *
 * Two of the three recognition surfaces decided in the governance repo
 * (`sponsorship/founding-sponsor-benefits.md`) live in this repo: the burgee
 * footer on the live public results listings, and the acknowledgement inside
 * the app the scorers use. The third — the marketing site — keeps its own copy
 * of this list in `../sailscoring.ie/lib/sponsors.ts`. Two small lists beat a
 * shared feed at this scale; revisit if this grows past a handful of entries.
 *
 * **The footer is injected at serve time, never rendered into a publication.**
 * A published page is the scorer's output and the club's record: the same HTML
 * that goes to blob storage goes to a club's own web host over FTP and into a
 * downloaded archive, and we do not rewrite those to carry someone else's logo.
 * Injecting in the `/p/...` route instead means the footer appears only on the
 * pages we serve, and is always current rather than frozen at whatever the
 * sponsor list held on the evening the series was published.
 *
 * Burgee assets come from the canonical logo origin that already serves club
 * marks to published results, so there is one copy of each and it tracks the
 * official version.
 */

import { escapeHtml as esc } from './html';

export type SponsorTier = 'founding' | 'burgee';

export interface Sponsor {
  /** Canonical logo id, which is also the React key. */
  id: string;
  tier: SponsorTier;
  /** Exactly as the sponsor wants to be named. */
  name: string;
  /** Absolute URL — these pages are served cross-origin and saved by clubs. */
  logoUrl: string;
  href: string;
  /** The season the sponsorship began. Founding status is permanent. */
  since: number;
}

export const SPONSORS: readonly Sponsor[] = [
  {
    id: 'hyc',
    tier: 'founding',
    name: 'Howth Yacht Club',
    logoUrl: 'https://logos.sailscoring.ie/hyc.small.png',
    href: 'https://www.hyc.ie',
    since: 2026,
  },
];

export const foundingSponsors = SPONSORS.filter((s) => s.tier === 'founding');

/**
 * A short digest of the list above, folded into the ETag of every page the
 * `/p/...` route serves. Without it a sponsorship that starts or lapses would
 * never reach a browser holding a revalidatable copy of a publication that
 * hasn't otherwise changed — which is exactly the "always current" property
 * that makes this surface worth sponsoring. Derived rather than hand-bumped,
 * because a hand-bumped revision is one that gets forgotten.
 */
export const SPONSORS_REVISION = fnv1a(
  SPONSORS.map((s) => `${s.id}:${s.tier}:${s.name}:${s.logoUrl}:${s.href}:${s.since}`).join('|'),
);

/** FNV-1a, 32-bit, hex. Not a security hash — a cheap synchronous fingerprint,
 *  where `contentHash`'s WebCrypto digest would force this to be async. */
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/**
 * The burgee footer, as a self-contained fragment for injection before
 * `</body>`.
 *
 * It lands in two unrelated stylesheets — the navy-hero listing chrome and the
 * results pages' own much older CSS — so it carries its own scoped rules and
 * assumes nothing about the host page beyond `<body>`. Links open `_top`
 * because clubs embed these pages in their own sites. It is hidden in print:
 * a printed results sheet is the scorer's document, and the same reasoning
 * that keeps sponsors out of exports keeps them off paper.
 *
 * Returns '' when there are no sponsors, so the injection site can stay
 * unconditional.
 */
export function renderSponsorFooterHtml(): string {
  if (foundingSponsors.length === 0) return '';

  const burgees = foundingSponsors
    .map(
      (s) =>
        `<a class="ss-sponsor" href="${esc(s.href)}" target="_top" rel="noopener" title="${esc(s.name)} — Founding Sponsor ${s.since}"><img src="${esc(s.logoUrl)}" alt="${esc(s.name)}"><span>${esc(s.name)}</span></a>`,
    )
    .join('');

  return `<div class="ss-sponsors">
<p class="ss-sponsors-label">Sail Scoring is supported by</p>
<div class="ss-sponsors-row">${burgees}</div>
</div>
<style type="text/css">
.ss-sponsors { max-width: 720px; margin: 0 auto; padding: 18px 20px 26px; text-align: center; font-family: "Poppins", system-ui, -apple-system, "Segoe UI", Roboto, Arial, helvetica, sans-serif; }
.ss-sponsors-label { margin: 0 0 12px; font-size: 11px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #6b7280; }
.ss-sponsors-row { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 14px 28px; }
a.ss-sponsor { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; color: #475569; font-size: 13px; font-weight: 600; }
a.ss-sponsor:hover { color: #fb3a3b; }
a.ss-sponsor img { display: block; height: 34px; width: auto; max-width: 52px; object-fit: contain; }
@media print { .ss-sponsors { display: none; } }
</style>`;
}
