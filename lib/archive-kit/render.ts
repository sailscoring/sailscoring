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
  renderHtmlDocument,
  type DocumentChrome,
} from '@/lib/results-renderer';

import type {
  AsPublishedFleetResults,
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
}

function rankCell(row: AsPublishedRow): string {
  return `<td class="rank">${esc(row.rankLabel || (row.rank != null ? String(row.rank) : ''))}</td>`;
}

function raceCells(row: AsPublishedRow): string {
  return row.raceCells
    .map(
      (cell) =>
        `<td${cell.discard ? ' class="discard"' : ''}>${esc(cell.text)}</td>`,
    )
    .join('');
}

/** The stored table as `summarytable` markup, matching the full-fidelity
 *  page's classes so the shared stylesheet applies unchanged. */
export function renderAsPublishedTable(
  results: AsPublishedFleetResults,
): string {
  const { caption, leadColumns, raceHeaders, summaryColumns, rows } = results;

  const cols = [
    '<col class="rank" />',
    ...leadColumns.map((c) => `<col class="${esc(c.key)}" />`),
    ...raceHeaders.map(() => '<col class="race" />'),
    ...summaryColumns.map((c) => `<col class="${esc(c.key)}" />`),
  ].join('\n');

  const headerCells = [
    '<th>Rank</th>',
    ...leadColumns.map((c) => `<th>${esc(c.label)}</th>`),
    ...raceHeaders.map((r) => `<th>${esc(r.label)}</th>`),
    ...summaryColumns.map((c) => `<th>${esc(c.label)}</th>`),
  ].join('');

  const body = rows
    .map((row, i) => {
      const cells = [
        rankCell(row),
        ...row.leadCells.map((v) => `<td>${esc(v)}</td>`),
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
  return renderHtmlDocument(documentChrome, renderAsPublishedTable(results), {
    fontPercent: 72,
    hasNhcDetail: false,
    hasEchoDetail: false,
    flagDefs: '',
  });
}
