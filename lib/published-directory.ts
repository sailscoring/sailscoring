/**
 * The public directory of workspaces at `/p/` (#670) — a showcase of the
 * results scored with Sail Scoring — and its JSON twin, `/p/index.json`.
 *
 * Club workspaces with something published are listed unless they opt out
 * (`DirectoryListing` in `lib/features.ts`); personal workspaces never are.
 * Each gets a card: who they are, signs of life (when results last went out,
 * the current season, the latest event), the scale of what they have
 * published, and the kinds of racing they score. A strip of the most recent
 * publications across every workspace sits above, so the page changes week
 * to week during the season.
 *
 * Everything here is pure: the rows come from `readDirectoryRows`, the
 * counts from each publication's publish-time summary — never a page list or
 * a data file.
 */

import { escapeHtml as esc } from './html';
import {
  assemblePublishedSeasonTree,
  type DirectoryRows,
} from './published-repository';
import { jsonAlternateLink, renderPublicHero, renderPublicShell } from './published-shell';
import { publicationPath } from './published-tree';
import type { PublicationSummary, PublishedSeriesPage } from './types';

/** The directory format's version, under the public export's rules. */
export const PUBLIC_DIRECTORY_VERSION = 1;

/** How many publications the "recently published" strip shows. */
export const RECENT_COUNT = 8;

/** A kind of racing a workspace scores, as a card badge. */
export type DirectoryBadge =
  | 'IRC'
  | 'ORC'
  | 'ECHO'
  | 'NHC'
  | 'VPRS'
  | 'PY'
  | 'TCF'
  | 'One-design'
  | 'Split-fleet'
  | 'Archive';

const SYSTEM_BADGES: Record<string, DirectoryBadge> = {
  irc: 'IRC',
  orc: 'ORC',
  echo: 'ECHO',
  nhc: 'NHC',
  vprs: 'VPRS',
  py: 'PY',
  tcf: 'TCF',
  scratch: 'One-design',
};

/** Badge display order: handicap systems, then one-design, then format. */
const BADGE_ORDER: DirectoryBadge[] = [
  'IRC', 'ORC', 'ECHO', 'NHC', 'VPRS', 'PY', 'TCF', 'One-design', 'Split-fleet', 'Archive',
];

/** A publication the directory links to: its name and where it lands. */
export interface DirectoryLink {
  name: string;
  /** Site-relative path. */
  path: string;
  publishedAt: number;
}

export interface DirectoryWorkspace {
  slug: string;
  name: string;
  logo: string;
  description: string | null;
  lastPublishedAt: number;
  currentSeason: string | null;
  latest: DirectoryLink;
  counts: { seasons: number; series: number; races: number; entries: number };
  badges: DirectoryBadge[];
}

export interface Directory {
  workspaces: DirectoryWorkspace[];
  recent: (DirectoryLink & { workspaceSlug: string; workspaceName: string })[];
}

type Pages = Omit<PublishedSeriesPage, 'blobUrl'>[];

/**
 * The publications the directory links into, by id: each workspace's most
 * recent, and the most recent across all of them. Their page lists are read
 * separately (`readPublicationPages`) — so the bulk read never carries one.
 */
export function directoryLinkIds(rows: DirectoryRows): string[] {
  const ids = new Set<string>();
  const seen = new Set<string>();
  // Rows are newest first.
  for (const p of rows.publications) {
    if (!seen.has(p.workspaceId)) {
      seen.add(p.workspaceId);
      ids.add(p.id);
    }
  }
  for (const p of rows.publications.slice(0, RECENT_COUNT)) ids.add(p.id);
  return [...ids];
}

/**
 * Build the directory from its rows. `pages` holds the page lists of the
 * publications {@link directoryLinkIds} named. Workspaces with nothing
 * published are left out; the rest sort by their latest publish, newest
 * first.
 */
export function buildDirectory(
  rows: DirectoryRows,
  pages: Map<string, Pages>,
): Directory {
  const byWorkspace = new Map<string, DirectoryRows['publications']>();
  for (const p of rows.publications) {
    const list = byWorkspace.get(p.workspaceId) ?? [];
    list.push(p);
    byWorkspace.set(p.workspaceId, list);
  }

  // Each workspace's season segments, filled in below as its tree is built.
  const seasonSegments = new Map<string, Set<string>>();

  // Where a publication's link lands: its own event when its slug is shared
  // or is a season folder (the season-mode and archive shapes), the slug
  // otherwise.
  const linkFor = (
    ws: { slug: string },
    p: DirectoryRows['publications'][number],
    folderLabel: string,
  ): DirectoryLink => {
    const group = byWorkspace.get(p.workspaceId) ?? [];
    const shared =
      group.filter((q) => q.slug === p.slug).length > 1 ||
      (seasonSegments.get(p.workspaceId)?.has(p.slug) ?? false);
    const path = publicationPath(p.slug, pages.get(p.id) ?? [], shared);
    return {
      name: p.seriesName ?? folderLabel,
      path: `/p/${ws.slug}/${path}`,
      publishedAt: p.publishedAt.getTime(),
    };
  };

  const workspaces: DirectoryWorkspace[] = [];
  const folderLabels = new Map<string, Map<string, string>>();
  for (const ws of rows.workspaces) {
    const pubs = byWorkspace.get(ws.id) ?? [];
    if (pubs.length === 0) continue;
    const meta = new Map(
      rows.folders
        .filter((f) => f.workspaceId === ws.id)
        .map((f) => [f.path, { label: f.label, season: f.season }]),
    );
    const tree = assemblePublishedSeasonTree(
      {
        publications: pubs.map((p) => ({
          slug: p.slug,
          seriesName: p.seriesName,
          publishedAt: p.publishedAt,
          startDate: p.startDate,
        })),
        defined: rows.seasons
          .filter((s) => s.workspaceId === ws.id)
          .map((s) => ({ label: s.label, isCurrent: s.isCurrent })),
      },
      meta,
    );
    const labels = new Map(
      [...tree.seasons.flatMap((s) => s.folders), ...tree.undated].map((f) => [f.slug, f.label]),
    );
    folderLabels.set(ws.id, labels);
    seasonSegments.set(ws.id, new Set(tree.seasons.map((s) => s.segment)));
    const populated = tree.seasons.filter((s) => s.folders.length > 0);
    const summaries = pubs
      .map((p) => p.summary)
      .filter((s): s is PublicationSummary => s !== null);
    const latest = pubs[0];
    workspaces.push({
      slug: ws.slug,
      name: ws.name,
      logo: ws.logo,
      description: ws.description,
      lastPublishedAt: latest.publishedAt.getTime(),
      currentSeason: populated.find((s) => s.current)?.label ?? populated[0]?.label ?? null,
      latest: linkFor(ws, latest, labels.get(latest.slug) ?? latest.slug),
      counts: {
        seasons: populated.length,
        series: pubs.length,
        races: summaries.reduce((n, s) => n + s.races, 0),
        entries: summaries.reduce((n, s) => n + s.boats, 0),
      },
      badges: badgesOf(summaries),
    });
  }
  workspaces.sort((a, b) => b.lastPublishedAt - a.lastPublishedAt);

  const wsById = new Map(rows.workspaces.map((w) => [w.id, w]));
  const recent = rows.publications.slice(0, RECENT_COUNT).map((p) => {
    const ws = wsById.get(p.workspaceId)!;
    return {
      ...linkFor(ws, p, folderLabels.get(ws.id)?.get(p.slug) ?? p.slug),
      workspaceSlug: ws.slug,
      workspaceName: ws.name,
    };
  });

  return { workspaces, recent };
}

/** The kinds of racing a workspace's publications show. */
export function badgesOf(summaries: PublicationSummary[]): DirectoryBadge[] {
  const found = new Set<DirectoryBadge>();
  for (const s of summaries) {
    for (const f of s.fleets) {
      const badge = f.scoringSystem ? SYSTEM_BADGES[f.scoringSystem] : undefined;
      if (badge) found.add(badge);
    }
    if (s.splitFleet) found.add('Split-fleet');
    if (s.asPublished) found.add('Archive');
  }
  return BADGE_ORDER.filter((b) => found.has(b));
}

/** The directory as JSON — `/p/index.json`. Every URL is absolute; each
 *  workspace links its own `index.json` (#669), so an app can walk from here
 *  to any series' data file without being given a URL. */
export function directoryJson(directory: Directory, origin: string) {
  const abs = (path: string) =>
    /^https?:\/\//.test(path) ? path : `${origin}${path.startsWith('/') ? '' : '/'}${path}`;
  const link = (l: DirectoryLink) => ({
    name: l.name,
    url: abs(l.path),
    publishedAt: new Date(l.publishedAt).toISOString(),
  });
  return {
    version: PUBLIC_DIRECTORY_VERSION,
    workspaces: directory.workspaces.map((w) => ({
      slug: w.slug,
      name: w.name,
      url: abs(`/p/${w.slug}`),
      index: abs(`/p/${w.slug}/index.json`),
      ...(w.logo ? { logo: abs(w.logo) } : {}),
      ...(w.description ? { description: w.description } : {}),
      lastPublishedAt: new Date(w.lastPublishedAt).toISOString(),
      currentSeason: w.currentSeason,
      latest: link(w.latest),
      counts: w.counts,
      badges: w.badges,
    })),
    recent: directory.recent.map((r) => ({
      ...link(r),
      workspace: r.workspaceSlug,
    })),
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A `<time>` that reads as a plain date without script, and as "2 hours
 *  ago" once the page's script has run — so the HTML (and its ETag) never
 *  depends on the clock. */
function timeHtml(ms: number): string {
  const d = new Date(ms);
  const plain = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return `<time datetime="${d.toISOString()}" data-ago>${plain}</time>`;
}

const RELATIVE_SCRIPT = `<script>(function(){
var now=Date.now();
var units=[['year',31536e6],['month',2592e6],['week',6048e5],['day',864e5],['hour',36e5],['minute',6e4]];
document.querySelectorAll('time[data-ago]').forEach(function(t){
  var ms=now-Date.parse(t.getAttribute('datetime'));
  if(!(ms>=0)||ms>=5184e6)return;
  for(var i=0;i<units.length;i++){
    var n=Math.floor(ms/units[i][1]);
    if(n>=1){t.textContent=n+' '+units[i][0]+(n===1?'':'s')+' ago';return;}
  }
  t.textContent='just now';
});
})();</script>`;

const DIRECTORY_CSS = `
.intro { text-align: center; color: #475569; max-width: 44em; margin: 0 auto 28px; }
.recent { margin: 0 0 32px; }
.recent h2, .cards-head { font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; margin: 0 0 10px; font-weight: 600; }
.recent ul { list-style: none; margin: 0; padding: 0; display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px; }
.recent li { flex: 0 0 auto; background: #fff; border: 1px solid #e2e6ea; border-radius: 8px; padding: 10px 14px; max-width: 16em; }
.recent a { color: #073358; font-weight: 600; text-decoration: none; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.recent a:hover { color: #fb3a3b; }
.recent .who { font-size: 0.82em; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cards { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.card { background: #fff; border: 1px solid #e2e6ea; border-radius: 10px; padding: 18px; display: flex; flex-direction: column; gap: 8px; }
.card-head { display: flex; align-items: center; gap: 12px; text-decoration: none; color: #073358; }
.card-head:hover .name { color: #fb3a3b; }
.card-head img { width: 44px; height: 44px; object-fit: contain; flex: 0 0 auto; }
.card-head .mono { width: 44px; height: 44px; border-radius: 8px; background: #073358; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; flex: 0 0 auto; }
.card .name { font-size: 1.1em; font-weight: 700; }
.card p { margin: 0; }
.card .desc { color: #334155; font-size: 0.92em; }
.card .life { color: #475569; font-size: 0.86em; }
.card .latest { font-size: 0.9em; }
.card .latest a { color: #073358; }
.card .latest a:hover { color: #fb3a3b; }
.card .scale { color: #64748b; font-size: 0.82em; }
.badges { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.badges li { font-size: 0.72em; font-weight: 600; letter-spacing: 0.02em; color: #073358; background: #e8eef5; border-radius: 999px; padding: 2px 9px; }
.data-link { text-align: center; font-size: 0.82em; color: #64748b; margin: 28px 0 0; }
.data-link a { color: #073358; }
`;

function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-IE')} ${n === 1 ? one : many}`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z0-9]/.test(w))
    .slice(0, 3)
    .map((w) => w[0].toUpperCase())
    .join('');
}

function cardHtml(w: DirectoryWorkspace): string {
  const logo = w.logo
    ? `<img src="${esc(w.logo)}" alt="">`
    : `<span class="mono" aria-hidden="true">${esc(initials(w.name))}</span>`;
  const life = [
    `Results published ${timeHtml(w.lastPublishedAt)}`,
    ...(w.currentSeason ? [`Season ${esc(w.currentSeason)}`] : []),
  ].join(' · ');
  const scale = [
    ...(w.counts.seasons > 1 ? [count(w.counts.seasons, 'season', 'seasons')] : []),
    count(w.counts.series, 'series', 'series'),
    ...(w.counts.races > 0 ? [count(w.counts.races, 'race', 'races')] : []),
    ...(w.counts.entries > 0 ? [count(w.counts.entries, 'entry', 'entries')] : []),
  ].join(' · ');
  const badges = w.badges.length
    ? `<ul class="badges">${w.badges.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`
    : '';
  return `<li class="card" data-workspace="${esc(w.slug)}">
<a class="card-head" href="/p/${esc(w.slug)}">${logo}<span class="name">${esc(w.name)}</span></a>
${w.description ? `<p class="desc">${esc(w.description)}</p>` : ''}
<p class="life">${life}</p>
<p class="latest">Latest: <a href="${esc(w.latest.path)}">${esc(w.latest.name)}</a></p>
<p class="scale">${scale}</p>
${badges}
</li>`;
}

/** The directory page at `/p/`. */
export function renderDirectoryHtml(directory: Directory): string {
  const hero = renderPublicHero('Results scored with Sail Scoring');
  const intro = `<p class="intro">Clubs, classes and events publishing their results with Sail Scoring. Every page here is live results, scored in the app.</p>`;
  if (directory.workspaces.length === 0) {
    return renderPublicShell(
      'Results scored with Sail Scoring',
      hero,
      `${intro}<p class="empty">Nothing published yet.</p>`,
      DIRECTORY_CSS,
      jsonAlternateLink('/p/index.json'),
      { indexable: true },
    );
  }
  const recent = directory.recent.length
    ? `<section class="recent" aria-labelledby="recent-h"><h2 id="recent-h">Recently published</h2><ul>${directory.recent
        .map(
          (r) =>
            `<li><a href="${esc(r.path)}">${esc(r.name)}</a><span class="who">${esc(r.workspaceName)} · ${timeHtml(r.publishedAt)}</span></li>`,
        )
        .join('')}</ul></section>`
    : '';
  const cards = `<h2 class="cards-head">Publishing with Sail Scoring</h2><ul class="cards">\n${directory.workspaces
    .map(cardHtml)
    .join('\n')}\n</ul>`;
  const data = `<p class="data-link">This directory as data: <a href="/p/index.json">/p/index.json</a></p>`;
  return renderPublicShell(
    'Results scored with Sail Scoring',
    hero,
    `${intro}${recent}${cards}${data}${RELATIVE_SCRIPT}`,
    DIRECTORY_CSS,
    jsonAlternateLink('/p/index.json'),
    { indexable: true },
  );
}
