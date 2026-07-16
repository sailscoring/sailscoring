/**
 * Public career-arc page (#212): a per-competitor record that spans years,
 * read off the cross-series identity link. Every series the recurring
 * competitor entered, in order — the showcase for a class with a deep history
 * (IODAI Optimists, ≈180 series back to 2009): joining as a coached
 * eight-year-old, season after season, up to ageing out of the class.
 *
 * Renders in the shared `/p/...` chrome (navy hero, red accent, the
 * `Sail Scoring` footer) so the arc reads as part of the same public site.
 * Participation only — every fact here (event, year, sail number, club) is
 * already public in the results. Deliberately *not* shown: age / implied birth
 * year, which is a reconciliation signal kept server-side, never published.
 */

import type { CareerArc, CareerArcEntry } from './career-arc';
import { escapeHtml as esc } from './html';
import { renderPublicHero, renderPublicShell } from './published-index';

const ARC_CSS = `.arch2 { font-size: 0.95em; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; margin: 26px 0 6px; }
.arcsub { text-align: center; color: #c7d6e6; font-size: 0.95em; margin: 10px 0 0; }
.arc { list-style: none; padding: 0; margin: 20px 0; }
.arc li { display: flex; align-items: baseline; gap: 14px; background: #fff; border: 1px solid #e2e6ea; border-left: 4px solid #fb3a3b; border-radius: 8px; padding: 12px 18px; margin-bottom: 8px; box-shadow: 0 1px 2px rgba(7,51,88,0.06); }
.arc .yr { font-weight: 700; color: #073358; font-variant-numeric: tabular-nums; min-width: 3.2em; }
.arc .ev { flex: 1; min-width: 0; color: #1a2b3c; font-weight: 600; }
.arc .ev a { color: #073358; text-decoration: none; }
.arc .ev a:hover { color: #fb3a3b; text-decoration: underline; }
.arc .ev .venue { display: block; font-weight: 400; color: #6b7280; font-size: 0.82em; margin-top: 2px; }
.arc .right { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; white-space: nowrap; }
.arc .place { color: #073358; font-weight: 700; font-variant-numeric: tabular-nums; }
.arc .place .of { color: #6b7280; font-weight: 400; }
.arc .place .infleet { color: #6b7280; font-weight: 400; font-size: 0.85em; }
.arc .sail { color: #9aa5b1; font-size: 0.82em; font-variant-numeric: tabular-nums; }
p.empty { color: #6b7280; text-align: center; margin: 48px 0; }`;

/** English ordinal: 1 → "1st", 22 → "22nd", 13 → "13th". */
function ordinal(n: number): string {
  const mod100 = n % 100;
  const suffix =
    mod100 >= 11 && mod100 <= 13
      ? 'th'
      : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/** The finishing-position cell: "3rd of 48", with the fleet name beneath for a
 *  multi-fleet series. Empty when the series isn't rankable yet. */
function placementHtml(entry: CareerArcEntry): string {
  if (entry.rank == null || entry.fleetSize == null) return '';
  const inFleet = entry.fleetName
    ? `<span class="infleet">${esc(entry.fleetName)}</span>`
    : '';
  return `<span class="place">${ordinal(entry.rank)}<span class="of"> of ${entry.fleetSize}</span></span>${inFleet}`;
}

/** Render the public career arc for one recurring competitor. */
export function renderCareerArcHtml(
  workspaceSlug: string,
  workspaceName: string,
  identity: CareerArc,
  logoUrl = '',
): string {
  const title = `${identity.label} — career`;
  const hero = renderPublicHero(esc(identity.label), logoUrl);

  const seasons = identity.entries.length;
  const spanLabel =
    identity.firstYear != null && identity.lastYear != null
      ? identity.firstYear === identity.lastYear
        ? `${identity.firstYear}`
        : `${identity.firstYear}–${identity.lastYear}`
      : null;
  const sub = [
    `${seasons} ${seasons === 1 ? 'series' : 'series'}`,
    spanLabel,
    identity.club ? esc(identity.club) : null,
  ]
    .filter(Boolean)
    .join(' &middot; ');

  // Back up to the competitor index (the roster this timeline belongs to), not
  // the workspace results listing.
  const back = `<p class="back"><a href="/p/${esc(workspaceSlug)}/competitors">&larr; ${esc(workspaceName)} competitors</a></p>`;

  if (identity.entries.length === 0 && identity.rankingEntries.length === 0) {
    return renderPublicShell(
      title,
      hero,
      `${back}<p class="empty">No series recorded yet.</p>`,
      ARC_CSS,
    );
  }

  const rows = identity.entries
    .map((e) => {
      const venue = e.venue ? `<span class="venue">${esc(e.venue)}</span>` : '';
      const place = placementHtml(e);
      const right = `<span class="right">${place}<span class="sail">${esc(e.sailNumber)}</span></span>`;
      // Deep-link the event to its published results when there is a page;
      // unpublished series stay plain text.
      const name = e.publishedSlug
        ? `<a href="/p/${esc(workspaceSlug)}/${esc(e.publishedSlug)}">${esc(e.seriesName)}</a>`
        : esc(e.seriesName);
      return `<li><span class="yr">${e.year ?? '&mdash;'}</span><span class="ev">${name}${venue}</span>${right}</li>`;
    })
    .join('\n');

  // Season-ranking achievements (#309): an accomplishment line per ranked
  // year, above the event timeline. A ranking-only sailor's arc is just
  // this list.
  const rankingRows = identity.rankingEntries
    .map((r) => {
      const of = r.rank !== null ? `Ranked ${esc(r.rankLabel)} of ${r.rankedCount}` : 'Listed';
      const name = `<a href="/p/${esc(workspaceSlug)}/ranking/${esc(r.slug)}">${esc(r.name)}</a>`;
      return `<li><span class="yr">${r.season}</span><span class="ev">${name}</span><span class="right"><span class="place">${of}</span></span></li>`;
    })
    .join('\n');
  const rankingBlock = rankingRows
    ? `<h2 class="arch2">Season rankings</h2>\n<ul class="arc">\n${rankingRows}\n</ul>\n`
    : '';
  const eventsBlock = rows
    ? `<ul class="arc">\n${rows}\n</ul>`
    : '';

  const body = `${back}\n<p class="arcsub">${sub}</p>\n${rankingBlock}${eventsBlock}`;
  return renderPublicShell(title, hero, body, ARC_CSS);
}
