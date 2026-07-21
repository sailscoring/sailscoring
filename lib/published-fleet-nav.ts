/**
 * The fleet switcher on public fleet pages (#320): sideways navigation between
 * the sibling pages of one publication, so getting from Class 1 to Class 2
 * doesn't mean climbing back up to the series index.
 *
 * The switcher is injected by the `/p/` route at serve time, not rendered into
 * the stored blob: pages are rendered before the publish handler resolves
 * sub-paths, the route already has the sibling page list in hand, and the blob
 * stays byte-identical to the published artifact (parity with the download and
 * FTP outputs, which have no siblings to switch between). The publication's
 * `contentHash` changes whenever its page set does, so the page ETag stays a
 * sound cache key for the injected result.
 */

import { escapeHtml as esc } from './html';
import type { SeriesIndexPage } from './published-index';

/** Inline links up to this many pages; beyond it, a select. */
const MAX_LINKS = 4;

/** Display label for a page in the switcher. Mirrors the series-index rule: a
 *  lone results page reads as "Standings" rather than its (possibly synthetic
 *  "Default") fleet name, the prize sheet always keeps its own name, and a
 *  sub-series page carries its block name so same-named fleets in different
 *  blocks stay distinguishable. */
function pageLabel(page: SeriesIndexPage, single: boolean): string {
  const leaf = !page.isPrizes && single ? 'Standings' : page.fleetName;
  return page.subSeriesName ? `${page.subSeriesName} — ${leaf}` : leaf;
}

// Scoped under `ssfleetnav-` so nothing collides with the stored page's own
// styles. Floats right beside the breadcrumb (which is left-aligned and
// unfloated), wraps under it on narrow screens, and disappears from print
// like the rest of the page chrome.
const NAV_STYLE = `<style>
.ssfleetnav { float: right; margin: 0 25px 10px 12px; font-size: 0.78em; text-align: right; max-width: 62%; }
.ssfleetnav a { color: #073358; text-decoration: none; margin-left: 12px; white-space: nowrap; }
.ssfleetnav a:hover { color: #fb3a3b; text-decoration: underline; }
.ssfleetnav .ssfleetnav-current { color: #fb3a3b; font-weight: 600; margin-left: 12px; white-space: nowrap; }
.ssfleetnav select { font: inherit; color: #073358; max-width: 100%; }
@media print { .ssfleetnav { display: none; } }
@media (max-width: 640px) { .ssfleetnav { float: none; text-align: center; margin: 10px 12px 0; max-width: none; } }
</style>`;

/**
 * The switcher fragment for one fleet page, or `''` when the publication has
 * fewer than two pages (nothing to switch to). `pages` is the owning
 * publication's page list in its published order; `currentSubPath` picks the
 * page being served; `base` is the path-absolute series URL (`/p/{ws}/{slug}`).
 *
 * Few pages render as inline links (the current page unlinked and
 * highlighted); more render as a select that navigates on change. Links carry
 * no `target`, so switching fleets stays inside an embedding iframe — unlike
 * the breadcrumb, which deliberately climbs out to the listing.
 */
export function renderFleetNav(
  pages: SeriesIndexPage[],
  currentSubPath: string,
  base: string,
): string {
  if (pages.length < 2) return '';
  const single = pages.filter((p) => !p.isPrizes).length === 1;
  const entries = pages.map((p) => ({
    label: pageLabel(p, single),
    href: `${base}/${p.subPath}`,
    current: p.subPath === currentSubPath,
  }));

  if (pages.length <= MAX_LINKS) {
    const links = entries
      .map((e) =>
        e.current
          ? `<span class="ssfleetnav-current">${esc(e.label)}</span>`
          : `<a href="${esc(e.href)}">${esc(e.label)}</a>`,
      )
      .join('');
    return `<div class="ssfleetnav">${NAV_STYLE}${links}</div>`;
  }

  const options = entries
    .map(
      (e) =>
        `<option value="${esc(e.href)}"${e.current ? ' selected' : ''}>${esc(e.label)}</option>`,
    )
    .join('');
  return `<div class="ssfleetnav">${NAV_STYLE}<select aria-label="Switch fleet" onchange="if(this.value!==location.pathname)location.href=this.value">${options}</select></div>`;
}

/** Insert a fragment immediately after the document's opening `<body ...>`
 *  tag. A document without one (never our own rendered pages) is returned
 *  unchanged rather than corrupted. */
export function injectAfterBodyTag(html: string, fragment: string): string {
  const bodyOpen = /<body[^>]*>/i.exec(html);
  if (!bodyOpen) return html;
  const at = bodyOpen.index + bodyOpen[0].length;
  return html.slice(0, at) + fragment + html.slice(at);
}
