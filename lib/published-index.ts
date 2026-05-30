/**
 * Renderers for the public published-results listing pages (ADR-008 Phase 9/10,
 * #162). Two static-feeling listings sit above the per-fleet results pages:
 *
 *   /p/{ws}            → workspace index: every published series in the workspace
 *   /p/{ws}/{series}   → series index: that publication's fleet pages
 *
 * Both are rendered on the fly by the `/p/[...slug]` route (the read path is a
 * thin always-fresh function, not a static blob — see #162), so there is no
 * stored index blob to regenerate on publish/unpublish. The chrome mirrors
 * `results-renderer.ts` (arial, centred, the `Sail Scoring — sailscoring.ie`
 * footer) so a listing and a results page feel like one site.
 */

/** HTML-escape for text and attribute interpolation. Mirrors the private
 *  helper in `results-renderer.ts`. */
function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A published series as shown in the workspace listing. */
export interface WorkspaceIndexItem {
  slug: string;
  /** Display title: the series name, or the slug for an orphaned publication. */
  title: string;
  publishedAt: number; // Unix ms
  fleetCount: number;
}

/** A fleet page as shown in the series listing. */
export interface SeriesIndexPage {
  fleetName: string;
  subPath: string; // `standings` for a single fleet, else `kebab(fleetName)`
}

/** One contributing series' fleet pages within a shared-slug listing. With a
 *  single group the listing is flat; with several it is sub-headed per series. */
export interface SeriesIndexGroup {
  seriesName: string; // contributing series name (or the slug, for an orphan)
  pages: SeriesIndexPage[];
}

const FOOTER =
  '<p>Sail Scoring &mdash; <a href="https://sailscoring.ie" target="_top" rel="noopener">sailscoring.ie</a></p>';

const STYLE = `body { font: 90% arial, helvetica, sans-serif; text-align: center; margin: 24px; }
h1 { font-size: 1.6em; }
h2.series { font-size: 1.1em; max-width: 640px; margin: 20px auto 6px; text-align: left; color: #334; }
ul.listing { list-style: none; padding: 0; max-width: 640px; margin: 24px auto; text-align: left; }
ul.listing li { padding: 10px 14px; border: 1px #ccd solid; border-radius: 6px; margin-bottom: 8px; }
ul.listing li a { font-size: 1.1em; text-decoration: none; }
ul.listing li a:hover { text-decoration: underline; }
ul.listing .meta { display: block; color: #666; font-size: 0.85em; margin-top: 2px; }
p.empty { color: #666; }
p.back { max-width: 640px; margin: 0 auto; text-align: left; font-size: 0.9em; }
p { text-align: center; }`;

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style type="text/css">
${STYLE}
</style>
</head>
<body>
${body}
${FOOTER}
</body>
</html>`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-IE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Workspace listing at `/p/{ws}`. `items` should already be newest-first.
 * Each row links to the series index `/p/{ws}/{slug}`.
 */
export function renderWorkspaceIndexHtml(
  workspaceSlug: string,
  workspaceName: string,
  items: WorkspaceIndexItem[],
): string {
  const heading = `${esc(workspaceName)} &mdash; published results`;
  const body =
    items.length === 0
      ? `<h1>${heading}</h1>\n<p class="empty">No published results yet.</p>`
      : `<h1>${heading}</h1>
<ul class="listing">
${items
  .map((it) => {
    const fleets =
      it.fleetCount > 1 ? ` &middot; ${it.fleetCount} fleets` : '';
    return `<li><a href="/p/${esc(workspaceSlug)}/${esc(it.slug)}">${esc(it.title)}</a><span class="meta">Published ${esc(formatDate(it.publishedAt))}${fleets}</span></li>`;
  })
  .join('\n')}
</ul>`;
  return shell(`${workspaceName} — published results`, body);
}

/**
 * Series listing at `/p/{ws}/{series}`. Lists the publication's fleet pages; a
 * single-fleet publication renders as a one-item listing so the bare slug stays
 * a stable listing rather than the standings page itself.
 *
 * A slug is a shared namespace, so `groups` may carry several contributing
 * series. With one group the listing is flat (as before); with several, each
 * series is sub-headed so the fleets read as that event's, e.g. Lambay Races →
 * Cruisers fleets + One Designs fleets under one page.
 *
 * A `← {workspace} — published results` link sits above the heading, up to the
 * workspace index `/p/{ws}`. Reaching this page means the workspace has at least
 * one publication, so that index always resolves.
 */
export function renderSeriesIndexHtml(
  workspaceSlug: string,
  workspaceName: string,
  slug: string,
  title: string,
  groups: SeriesIndexGroup[],
): string {
  const renderList = (pages: SeriesIndexPage[]): string => {
    const single = pages.length === 1;
    return `<ul class="listing">
${pages
  .map((p) => {
    const label = single ? 'Standings' : p.fleetName;
    return `<li><a href="/p/${esc(workspaceSlug)}/${esc(slug)}/${esc(p.subPath)}">${esc(label)}</a></li>`;
  })
  .join('\n')}
</ul>`;
  };

  const sections =
    groups.length <= 1
      ? renderList(groups[0]?.pages ?? [])
      : groups
          .map(
            (g) => `<h2 class="series">${esc(g.seriesName)}</h2>\n${renderList(g.pages)}`,
          )
          .join('\n');

  const back = `<p class="back"><a href="/p/${esc(workspaceSlug)}">&larr; ${esc(workspaceName)} &mdash; published results</a></p>`;
  return shell(title, `${back}\n<h1>${esc(title)}</h1>\n${sections}`);
}
