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
import { formatPlace, type RankingConfig } from './ranking';
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
.ladder th.place, .ladder td.place { text-align: center; }
.ladder .place { color: #1a2b3c; font-variant-numeric: tabular-nums; }
.ladder .place.blank, .ladder .place.discard { color: #6b7280; }
.ladder td.rank1 { background: #d4a72c; }
.ladder td.rank2 { background: #aab0b6; }
.ladder td.rank3 { background: #c98a5e; }
.ladder td.discard { background: #f2f2f2; }
.ladder .total, .ladder .net { font-weight: 700; color: #073358; text-align: right; font-variant-numeric: tabular-nums; }
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
  const placesNote =
    config.recomputePlaces && config.nationality
      ? ` Places counted among ${esc(config.nationality)} sailors only.`
      : '';
  const basis = standings.includedSeries.length
    ? `<p class="basis">Based on: ${standings.includedSeries
        .map((s) => esc(s.name))
        .join(', ')}.${fleetNote}${placesNote}</p>`
    : '';

  if (rows.length === 0) {
    return renderPublicShell(
      rankingName,
      hero,
      `${back}<p class="empty">No ranked sailors yet.</p>${basis}`,
      RANKING_CSS,
    );
  }

  // Standings-like: one column per series, discards in parentheses, podium
  // places in the published-standings medal colours (discards lose the
  // medal), gross Total and — when a discard exists — the Net that ranks.
  const hasDiscards = rows.some((row) => row.gross !== row.total);
  const seriesHeads = standings.includedSeries
    .map((s) => `<th class="place">${esc(s.name)}</th>`)
    .join('');
  const adjustmentNotes = new Map(
    (config.adjustments ?? []).map((a) => [
      `${a.identityId}:${a.seriesId}`,
      a.note,
    ]),
  );
  const body = rows
    .map((row) => {
      const sailor =
        opts.competitorLinks && row.slug
          ? `<a href="/p/${esc(workspaceSlug)}/competitor/${esc(row.slug)}">${esc(row.label)}</a>`
          : esc(row.label);
      const places = new Map<
        string,
        { place: number; counted: boolean; adjusted: boolean }
      >();
      for (const b of row.buckets) {
        for (const p of b.places) {
          if (!places.has(p.seriesId)) places.set(p.seriesId, p);
        }
      }
      const placeCells = standings.includedSeries
        .map((s) => {
          const p = places.get(s.id);
          if (!p) return `<td class="place blank">&mdash;</td>`;
          const note = p.adjusted
            ? adjustmentNotes.get(`${row.identityId}:${s.id}`)
            : undefined;
          const title = note ? ` title="${esc(note)}"` : '';
          const text = `${formatPlace(p.place)}${p.adjusted ? '*' : ''}`;
          if (!p.counted) {
            return `<td class="place discard"${title}>(${text})</td>`;
          }
          const medal =
            Number.isInteger(p.place) && p.place <= 3 ? ` rank${p.place}` : '';
          return `<td class="place${medal}"${title}>${text}</td>`;
        })
        .join('');
      const netCell = hasDiscards
        ? `<td class="net">${formatPlace(row.total)}</td>`
        : '';
      return `<tr><td class="rank">${row.rank}</td><td class="sailor">${sailor}</td><td class="club">${esc(row.club ?? '')}</td>${placeCells}<td class="total">${formatPlace(row.gross)}</td>${netCell}</tr>`;
    })
    .join('\n');

  // Every adjusted place gets its explanation in a footnote, so the asterisk
  // is never a mystery to a public reader.
  const includedIds = new Set(standings.includedSeries.map((s) => s.id));
  const labelById = new Map(
    [...rows, ...standings.result.ineligible].map((r) => [
      r.identityId,
      r.label,
    ]),
  );
  const adjustmentNoteLines = (config.adjustments ?? [])
    .filter((a) => includedIds.has(a.seriesId) && labelById.has(a.identityId))
    .map((a) => {
      const seriesName =
        standings.includedSeries.find((s) => s.id === a.seriesId)?.name ?? '';
      return `<p class="basis">* ${esc(labelById.get(a.identityId)!)} — ${esc(seriesName)}: ${esc(a.note)}</p>`;
    })
    .join('\n');

  const netHead = hasDiscards ? '<th style="text-align:right">Net</th>' : '';
  const table = `<table class="ladder">
<thead><tr><th>Rank</th><th>Sailor</th><th>Club</th>${seriesHeads}<th style="text-align:right">Total</th>${netHead}</tr></thead>
<tbody>
${body}
</tbody>
</table>`;

  return renderPublicShell(
    rankingName,
    hero,
    `${back}\n${table}\n${adjustmentNoteLines}\n${basis}`,
    RANKING_CSS,
  );
}
