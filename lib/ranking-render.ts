/**
 * Public ranking page (#209): the live season ladder at
 * `/p/{ws}/ranking/{slug}` — "see it constantly". Renders in the shared
 * `/p/...` chrome so the ladder reads as part of the same public site.
 *
 * Public = published: the ladder here is computed over the config's
 * *published* series only (the caller filters before computing), and the
 * footer names exactly what was counted, so a reader can always tell which
 * events the numbers came from.
 */

import { escapeHtml as esc } from './html';
import { renderPublicHero, renderPublicShell } from './published-index';
import type { RankingConfig } from './ranking';
import type { RankingStandingsData } from './ranking-standings';

const RANKING_CSS = `.ladder { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e6ea; border-radius: 8px; overflow: hidden; margin: 20px 0; box-shadow: 0 1px 2px rgba(7,51,88,0.06); }
.ladder th { text-align: left; font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; background: #f6f8fa; padding: 10px 14px; border-bottom: 1px solid #e2e6ea; }
.ladder td { padding: 10px 14px; border-bottom: 1px solid #eef1f4; color: #1a2b3c; }
.ladder tr:last-child td { border-bottom: none; }
.ladder .rank { font-weight: 700; color: #073358; font-variant-numeric: tabular-nums; width: 3em; }
.ladder .sailor { font-weight: 600; }
.ladder .sailor a { color: #073358; text-decoration: none; }
.ladder .sailor a:hover { color: #fb3a3b; text-decoration: underline; }
.ladder .club { color: #6b7280; }
.ladder .places { color: #6b7280; font-variant-numeric: tabular-nums; }
.ladder .total { font-weight: 700; color: #073358; text-align: right; font-variant-numeric: tabular-nums; }
.basis { color: #6b7280; font-size: 0.85em; margin: 16px 0 0; }
p.empty { color: #6b7280; text-align: center; margin: 48px 0; }`;

/** Render the public ladder. `standings` must already be computed over
 *  published series only. */
export function renderRankingHtml(
  workspaceSlug: string,
  workspaceName: string,
  rankingName: string,
  config: RankingConfig,
  standings: RankingStandingsData,
  opts: { competitorLinks?: boolean; logoUrl?: string } = {},
): string {
  const hero = renderPublicHero(esc(rankingName), opts.logoUrl ?? '');
  const back = `<p class="back"><a href="/p/${esc(workspaceSlug)}">&larr; ${esc(workspaceName)}</a></p>`;
  const { rows } = standings.result;

  const fleetNote = config.fleet ? ` ${esc(config.fleet)} fleet only.` : '';
  const basis = standings.includedSeries.length
    ? `<p class="basis">Based on: ${standings.includedSeries
        .map((s) => esc(s.name))
        .join(', ')}.${fleetNote}</p>`
    : '';

  if (rows.length === 0) {
    return renderPublicShell(
      rankingName,
      hero,
      `${back}<p class="empty">No ranked sailors yet.</p>${basis}`,
      RANKING_CSS,
    );
  }

  const bucketHeads = config.buckets
    .map((b) => `<th>${esc(b.name || 'Bucket')}</th>`)
    .join('');
  const body = rows
    .map((row) => {
      const sailor =
        opts.competitorLinks && row.slug
          ? `<a href="/p/${esc(workspaceSlug)}/competitor/${esc(row.slug)}">${esc(row.label)}</a>`
          : esc(row.label);
      const bucketCells = row.buckets
        .map(
          (b) =>
            `<td class="places">${b.counted.map((c) => c.place).join(' + ') || '&mdash;'}</td>`,
        )
        .join('');
      return `<tr><td class="rank">${row.rank}</td><td class="sailor">${sailor}</td><td class="club">${esc(row.club ?? '')}</td>${bucketCells}<td class="total">${row.total}</td></tr>`;
    })
    .join('\n');

  const table = `<table class="ladder">
<thead><tr><th>Rank</th><th>Sailor</th><th>Club</th>${bucketHeads}<th style="text-align:right">Total</th></tr></thead>
<tbody>
${body}
</tbody>
</table>`;

  return renderPublicShell(
    rankingName,
    hero,
    `${back}\n${table}\n${basis}`,
    RANKING_CSS,
  );
}
