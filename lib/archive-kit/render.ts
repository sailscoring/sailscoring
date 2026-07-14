/**
 * Public pages for as-published series (ADR-010, #283): render a stored
 * results table into the same document chrome as a full-fidelity fleet page,
 * so an archive page doesn't read as a different kind of thing. What it
 * simply doesn't have — the embedded JSON export, per-race detail tables,
 * handicap-calculation toggles — is omitted rather than faked.
 *
 * Pure: string in, string out. The ingest handler publishes the output
 * through the standard blob pipeline.
 */

import { escapeHtml as esc } from '@/lib/html';
import {
  renderFlagDefs,
  renderHtmlDocument,
  type DocumentChrome,
} from '@/lib/results-renderer';

import type {
  AsPublishedFleetResults,
  AsPublishedRaceTable,
  AsPublishedRow,
} from './types';

/** Chrome inputs the ingest can supply — a subset of the full-fidelity
 *  page's, since an archive series has no provisional stamp or open-in-app. */
export interface AsPublishedPageChrome {
  seriesName: string;
  venue?: string;
  /** Shown under the series title — the fleet name for multi-fleet series. */
  fleetName?: string;
  leftLogoUrl?: string;
  rightLogoUrl?: string;
  leftUrl?: string;
  rightUrl?: string;
  /** `/p/{ws}/{slug}` — the breadcrumb up to the series listing. */
  seriesIndexUrl?: string;
  /** Flag SVGs keyed by 3-letter code (the app's nationality dataset).
   *  When set, nationality lead columns render flags like a full-fidelity
   *  page; codes without a flag fall back to text. */
  flagSvgByCode?: Readonly<Record<string, { viewBox: string; inner: string }>>;
}

/** Lead-column keys that carry a 3-letter national code — Sailwave's `nat`
 *  colgroup class and Sail100's header-derived labels. */
const NATIONALITY_KEYS = new Set(['nat', 'country', 'nationality']);

/** Every national code referenced by the table's nationality columns. */
export function collectNationalityCodes(
  results: AsPublishedFleetResults,
): string[] {
  const natIdxs = results.leadColumns
    .map((c, i) => (NATIONALITY_KEYS.has(c.key) ? i : -1))
    .filter((i) => i !== -1);
  const codes = new Set<string>();
  for (const row of results.rows) {
    for (const i of natIdxs) {
      const code = (row.leadCells[i] ?? '').trim();
      if (/^[A-Z]{3}$/.test(code)) codes.add(code);
    }
  }
  return [...codes].sort();
}

function rankCell(row: AsPublishedRow): string {
  return `<td class="rank">${esc(row.rankLabel || (row.rank != null ? String(row.rank) : ''))}</td>`;
}

function raceCells(row: AsPublishedRow): string {
  return row.raceCells
    .map((cell) => {
      // The published page's podium colouring (1st/2nd/3rd in the race)
      // rides in the structured rank slot; discard styling composes with it
      // exactly as on a full-fidelity page.
      const classes = [
        cell.rank != null && cell.rank >= 1 && cell.rank <= 3
          ? `rank${cell.rank}`
          : '',
        cell.discard ? 'discard' : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `<td${classes ? ` class="${classes}"` : ''}>${esc(cell.text)}</td>`;
    })
    .join('');
}

/** A nationality cell in the full-fidelity page's layout: flag stacked above
 *  the code; codes without a flag (or non-code values) render as text. */
function nationalityCell(
  value: string,
  flagSvgByCode: AsPublishedPageChrome['flagSvgByCode'],
): string {
  const code = value.trim();
  const flag = flagSvgByCode?.[code];
  const flagSpan = flag
    ? `<span class="flag"><svg xmlns="http://www.w3.org/2000/svg"><use href="#flag-${esc(code)}" /></svg></span>`
    : '';
  return `<td class="nat">${flagSpan}<span class="nattext">${esc(code)}</span></td>`;
}

/** The stored table as `summarytable` markup, matching the full-fidelity
 *  page's classes so the shared stylesheet applies unchanged. */
export function renderAsPublishedTable(
  results: AsPublishedFleetResults,
  opts: { flagSvgByCode?: AsPublishedPageChrome['flagSvgByCode'] } = {},
): string {
  const { caption, leadColumns, raceHeaders, summaryColumns, rows } = results;
  const isNatColumn = leadColumns.map((c) => NATIONALITY_KEYS.has(c.key));
  // A table published without places (coached regatta fleets) carries no
  // rank data at all — don't render an empty Rank column for it.
  const hasRanks = rows.some((r) => r.rank != null || r.rankLabel !== '');

  const cols = [
    ...(hasRanks ? ['<col class="rank" />'] : []),
    ...leadColumns.map((c) => `<col class="${esc(c.key)}" />`),
    ...raceHeaders.map(() => '<col class="race" />'),
    ...summaryColumns.map((c) => `<col class="${esc(c.key)}" />`),
  ].join('\n');

  const headerCells = [
    ...(hasRanks ? ['<th>Rank</th>'] : []),
    ...leadColumns.map((c) => `<th>${esc(c.label)}</th>`),
    ...raceHeaders.map((r) => `<th>${esc(r.label)}</th>`),
    ...summaryColumns.map((c) => `<th>${esc(c.label)}</th>`),
  ].join('');

  const body = rows
    .map((row, i) => {
      const cells = [
        ...(hasRanks ? [rankCell(row)] : []),
        ...row.leadCells.map((v, i) =>
          isNatColumn[i]
            ? nationalityCell(v, opts.flagSvgByCode)
            : `<td>${esc(v)}</td>`,
        ),
        raceCells(row),
        ...row.summaryCells.map((v) => `<td>${esc(v)}</td>`),
      ].join('');
      return `<tr class="${i % 2 === 0 ? 'odd' : 'even'}">${cells}</tr>`;
    })
    .join('\n');

  const captionHtml = caption
    ? `<div class="caption summarycaption">${esc(caption)}</div>\n`
    : '';

  return `${captionHtml}<div class="tablewrap">
<table class="summarytable" cellspacing="0" cellpadding="0" border="0">
<colgroup>
${cols}
</colgroup>
<thead>
<tr>${headerCells}</tr>
</thead>
<tbody>
${body}
</tbody>
</table>
</div>`;
}

/** A per-race detail table (handicap sources: elapsed / handicap /
 *  corrected as published), in the full-fidelity page's race-table style. */
export function renderAsPublishedRaceTable(
  table: AsPublishedRaceTable,
): string {
  const heading = `<h3 class="racetitle">${esc(table.label)}${table.date ? ` <span class="racedate">${esc(table.date)}</span>` : ''}</h3>`;
  const captionHtml = table.caption
    ? `<div class="caption">${esc(table.caption)}</div>\n`
    : '';
  const headerCells = table.columns
    .map((c) => `<th>${esc(c.label)}</th>`)
    .join('');
  const body = table.rows
    .map((row, i) => {
      const podium =
        row.rank !== undefined && row.rank <= 3 ? ` class="rank${row.rank}"` : '';
      const cells = row.cells
        .map((v, ci) => `<td${ci === 0 ? podium : ''}>${esc(v)}</td>`)
        .join('');
      return `<tr class="${i % 2 === 0 ? 'odd' : 'even'}">${cells}</tr>`;
    })
    .join('\n');
  return `${heading}
${captionHtml}<div class="tablewrap">
<table class="racetable" cellspacing="0" cellpadding="0" border="0">
<thead>
<tr>${headerCells}</tr>
</thead>
<tbody>
${body}
</tbody>
</table>
</div>`;
}

/** One as-published fleet page, in the standard published-page chrome. */
export function renderAsPublishedFleetHtml(
  chrome: AsPublishedPageChrome,
  results: AsPublishedFleetResults,
): string {
  const documentChrome: DocumentChrome = {
    series: { name: chrome.seriesName, venue: chrome.venue ?? '' },
    fleetName: chrome.fleetName,
    leftLogoUrl: chrome.leftLogoUrl,
    rightLogoUrl: chrome.rightLogoUrl,
    leftUrl: chrome.leftUrl,
    rightUrl: chrome.rightUrl,
    seriesIndexUrl: chrome.seriesIndexUrl,
  };
  const raceTables = (results.raceTables ?? [])
    .map(renderAsPublishedRaceTable)
    .join('\n');
  const table = renderAsPublishedTable(results, {
    flagSvgByCode: chrome.flagSvgByCode,
  });
  const content = raceTables ? `${table}\n${raceTables}` : table;
  return renderHtmlDocument(documentChrome, content, {
    fontPercent: 72,
    hasNhcDetail: false,
    hasEchoDetail: false,
    flagDefs: renderFlagDefs(
      collectNationalityCodes(results),
      chrome.flagSvgByCode,
    ),
  });
}
