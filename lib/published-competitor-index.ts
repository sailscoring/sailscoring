/**
 * Public competitor index at `/p/{ws}/competitors` (#217): a browsable,
 * searchable roster of every recurring competitor in the workspace, each
 * linking to its timeline (`/p/{ws}/competitor/{slug}`).
 *
 * The headline of the cross-series work — with a deep class history loaded
 * (IODAI Optimists, ≈180 series back to 2009) people dig for hours: "who
 * sailed 1605?", "everyone who raced in 2014". The `/p/...` surface is plain
 * rendered HTML with no client framework, so the search (name + sail) and the
 * year filter run from a small inline script over `data-*` keys baked onto
 * each row — instant filtering, no per-keystroke navigation. The same pattern
 * the published results pages already use for their inline behaviour.
 *
 * Participation only, exactly like the timeline: name, sail number, club,
 * years — all already public in the results. Never age / implied birth year.
 * Inherits the shell's `noindex`, so it's shareable by link but stays out of
 * search engines.
 */

import type { IdentityWithArc } from './competitor-identity-repository';
import { escapeHtml as esc } from './html';
import { renderPublicHero, renderPublicShell } from './published-index';

/** One competitor as shown in the index — the timeline link plus the keys the
 *  inline search/filter matches on. */
export interface CompetitorIndexEntry {
  slug: string;
  name: string;
  /** Distinct sail numbers across the competitor's entries, chronological. */
  sailNumbers: string[];
  firstYear: number | null;
  lastYear: number | null;
  /** Distinct years the competitor raced, ascending — drives the year filter. */
  years: number[];
  seriesCount: number;
}

/** Folded search key: diacritics stripped, lowercased, whitespace collapsed —
 *  so "Seán" is found by typing "sean". Mirrored verbatim in the client script
 *  below so the query folds the same way the row keys do. */
function fold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Shape reconciled identities into index rows: distinct sails + years, a series
 * count, dropping any row without a slug (it has no public URL to link to —
 * only rows still awaiting their backfilled slug, which shouldn't occur in a
 * reconciled workspace). Pure, so the shaping is unit-tested directly.
 */
export function toCompetitorIndexEntries(
  identities: IdentityWithArc[],
): CompetitorIndexEntry[] {
  const out: CompetitorIndexEntry[] = [];
  for (const id of identities) {
    if (!id.slug) continue;
    const sailNumbers = [
      ...new Set(id.entries.map((e) => e.sailNumber).filter(Boolean)),
    ];
    const years = [
      ...new Set(
        id.entries
          .map((e) => e.year)
          .filter((y): y is number => y != null),
      ),
    ].sort((a, b) => a - b);
    out.push({
      slug: id.slug,
      name: id.label,
      sailNumbers,
      firstYear: id.firstYear,
      lastYear: id.lastYear,
      years,
      seriesCount: id.entries.length,
    });
  }
  // Alphabetical by folded name, with blank-name rows (data debris awaiting
  // cleanup) sorted last so they never lead the list.
  return out.sort((a, b) => {
    const fa = fold(a.name);
    const fb = fold(b.name);
    if (!fa !== !fb) return fa ? -1 : 1;
    return fa.localeCompare(fb);
  });
}

const INDEX_CSS = `.tools { display: flex; flex-wrap: wrap; gap: 12px; margin: 4px 0 18px; }
.tools input, .tools select { font: inherit; padding: 9px 12px; border: 1px solid #cfd6dd; border-radius: 8px; background: #fff; color: #1a2b3c; }
.tools input { flex: 1; min-width: 200px; }
.tools input:focus, .tools select:focus { outline: none; border-color: #fb3a3b; box-shadow: 0 0 0 3px rgba(251,58,59,0.15); }
.count { color: #6b7280; font-size: 0.82em; margin: 0 0 12px; }
ul.crows { list-style: none; padding: 0; margin: 0; }
li.crow { background: #fff; border: 1px solid #e2e6ea; border-left: 4px solid transparent; border-radius: 8px; margin-bottom: 8px; box-shadow: 0 1px 2px rgba(7,51,88,0.06); transition: box-shadow .15s, border-color .15s, transform .1s; }
li.crow:hover { box-shadow: 0 4px 14px rgba(7,51,88,0.13); border-left-color: #fb3a3b; transform: translateY(-1px); }
li.crow a { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; padding: 14px 18px; text-decoration: none; }
li.crow .nm { color: #073358; font-weight: 600; font-size: 1.08em; min-width: 0; }
li.crow .nm.unnamed { color: #9aa5b1; font-style: italic; font-weight: 400; }
li.crow .det { color: #6b7280; font-size: 0.8em; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
li.crow .sails { display: block; color: #9aa5b1; }
p.empty { color: #6b7280; text-align: center; margin: 40px 0; }`;

/** The inline filter: folds the query the same way the row keys were folded,
 *  matches it against name OR sail, AND'd with the year select. Padding the
 *  year list with spaces stops "202" matching inside "2021". Blank-name rows
 *  (`data-blank`) stay hidden in the default browse and surface only while a
 *  search/filter is active and they match — so a sail search still finds them.
 *  Runs once on load so the initial view matches (blanks already hidden). */
const INDEX_SCRIPT = `<script>(function(){
var q=document.getElementById('q'),yr=document.getElementById('yr'),
count=document.getElementById('count'),empty=document.getElementById('empty'),
rows=[].slice.call(document.querySelectorAll('li.crow'));
function fold(s){return s.normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/\\s+/g,' ').trim();}
function apply(){
var t=fold(q.value),y=yr.value,filtering=!!(t||y),n=0;
rows.forEach(function(li){
var okText=!t||li.getAttribute('data-name').indexOf(t)>=0||li.getAttribute('data-sails').indexOf(t)>=0;
var okYear=!y||(' '+li.getAttribute('data-years')+' ').indexOf(' '+y+' ')>=0;
var matches=okText&&okYear;
var show=li.getAttribute('data-blank')==='1'?(filtering&&matches):matches;
li.style.display=show?'':'none';if(show)n++;
});
count.textContent=n+(n===1?' competitor':' competitors');
empty.style.display=n?'none':'';
}
q.addEventListener('input',apply);yr.addEventListener('change',apply);apply();
})();</script>`;

function spanLabel(e: CompetitorIndexEntry): string {
  if (e.firstYear == null || e.lastYear == null) return '';
  return e.firstYear === e.lastYear
    ? `${e.firstYear}`
    : `${e.firstYear}–${e.lastYear}`;
}

/**
 * The competitor index at `/p/{ws}/competitors`. A `← {workspace}` link sits
 * above the heading. Reaching this page means the workspace has the feature and
 * at least one competitor, so the row list is never empty on first load — the
 * "no matches" line only appears once a search/filter excludes everything.
 */
export function renderCompetitorIndexHtml(
  workspaceSlug: string,
  workspaceName: string,
  competitors: CompetitorIndexEntry[],
  logoUrl = '',
): string {
  const title = `${workspaceName} — competitors`;
  const heading = `${esc(workspaceName)} &mdash; competitors`;
  const hero = renderPublicHero(heading, logoUrl);
  const back = `<p class="back"><a href="/p/${esc(workspaceSlug)}">&larr; ${esc(workspaceName)}</a></p>`;

  const allYears = [
    ...new Set(competitors.flatMap((c) => c.years)),
  ].sort((a, b) => b - a);
  const yearOptions = [
    '<option value="">All years</option>',
    ...allYears.map((y) => `<option value="${y}">${y}</option>`),
  ].join('');

  const rows = competitors
    .map((c) => {
      const blank = !c.name.trim();
      const sails = c.sailNumbers.length
        ? `<span class="sails">${esc(c.sailNumbers.join(', '))}</span>`
        : '';
      const span = spanLabel(c);
      const count = `${c.seriesCount} ${c.seriesCount === 1 ? 'series' : 'series'}`;
      const det = `<span class="det">${span ? `${span} &middot; ` : ''}${count}${sails}</span>`;
      // Blank-name rows: tagged + hidden by default (so they don't lead the
      // browse), shown a placeholder so a sail search reveals a usable row.
      const nm = blank
        ? `<span class="nm unnamed">(no name)</span>`
        : `<span class="nm">${esc(c.name)}</span>`;
      const attrs = [
        `class="crow"`,
        `data-name="${esc(fold(c.name))}"`,
        `data-sails="${esc(fold(c.sailNumbers.join(' ')))}"`,
        `data-years="${c.years.join(' ')}"`,
        blank ? `data-blank="1" style="display:none"` : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `<li ${attrs}><a href="/p/${esc(
        workspaceSlug,
      )}/competitor/${esc(c.slug)}">${nm}${det}</a></li>`;
    })
    .join('\n');

  // Blanks are hidden in the default browse, so the headline count excludes them.
  const visibleCount = competitors.filter((c) => c.name.trim()).length;

  const tools = `<div class="tools">
<input id="q" type="search" placeholder="Search name or sail number…" aria-label="Search by name or sail number" autocomplete="off">
<select id="yr" aria-label="Filter by year">${yearOptions}</select>
</div>`;

  const countLine = `<p class="count" id="count">${visibleCount} ${
    visibleCount === 1 ? 'competitor' : 'competitors'
  }</p>`;
  const emptyLine = `<p class="empty" id="empty" style="display:none">No competitors match.</p>`;

  const body = `${back}\n${tools}\n${countLine}\n<ul class="crows">\n${rows}\n</ul>\n${emptyLine}\n${INDEX_SCRIPT}`;
  return renderPublicShell(title, hero, body, INDEX_CSS);
}
