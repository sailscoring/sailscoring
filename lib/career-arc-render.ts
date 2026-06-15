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

import { escapeHtml as esc } from './html';
import type { IdentityWithArc } from './competitor-identity-repository';
import { renderPublicHero, renderPublicShell } from './published-index';

const ARC_CSS = `.arcsub { text-align: center; color: #c7d6e6; font-size: 0.95em; margin: 10px 0 0; }
.arc { list-style: none; padding: 0; margin: 20px 0; }
.arc li { display: flex; align-items: baseline; gap: 14px; background: #fff; border: 1px solid #e2e6ea; border-left: 4px solid #fb3a3b; border-radius: 8px; padding: 12px 18px; margin-bottom: 8px; box-shadow: 0 1px 2px rgba(7,51,88,0.06); }
.arc .yr { font-weight: 700; color: #073358; font-variant-numeric: tabular-nums; min-width: 3.2em; }
.arc .ev { flex: 1; min-width: 0; color: #1a2b3c; font-weight: 600; }
.arc .ev .venue { display: block; font-weight: 400; color: #6b7280; font-size: 0.82em; margin-top: 2px; }
.arc .sail { color: #6b7280; font-size: 0.9em; font-variant-numeric: tabular-nums; white-space: nowrap; }
p.empty { color: #6b7280; text-align: center; margin: 48px 0; }`;

/** Render the public career arc for one recurring competitor. */
export function renderCareerArcHtml(
  workspaceSlug: string,
  workspaceName: string,
  identity: IdentityWithArc,
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

  const back = `<p class="back"><a href="/p/${esc(workspaceSlug)}">&larr; ${esc(workspaceName)}</a></p>`;

  if (identity.entries.length === 0) {
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
      return `<li><span class="yr">${e.year ?? '&mdash;'}</span><span class="ev">${esc(
        e.seriesName,
      )}${venue}</span><span class="sail">${esc(e.sailNumber)}</span></li>`;
    })
    .join('\n');

  const body = `${back}\n<p class="arcsub">${sub}</p>\n<ul class="arc">\n${rows}\n</ul>`;
  return renderPublicShell(title, hero, body, ARC_CSS);
}
