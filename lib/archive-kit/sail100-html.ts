/**
 * Parser for Sail100-published results HTML (ADR-010, #283) — the third
 * capture format in the IODAI archive (2009–2013 events, plus several later
 * Ulsters). One bare `<table border="1">`: a first row of `<td>` headers
 * ("Series Place", "Sail No", "Fleet", "Helm", "M/F", "Prize Age", "Club",
 * "Series Points", then linked "Race N" columns), data rows after, with
 * discarded race cells carrying class `j` (kept cells `n`).
 *
 * Emits the same section shape as the Sailwave parser, so
 * `buildSailwaveArchiveDoc` consumes either. Note the layout difference:
 * Sail100 puts "Series Points" *before* the race columns — it stays a lead
 * column, preserving the published order. Generator-side only (jsdom).
 */

import { JSDOM } from 'jsdom';

import { kebab } from '@/lib/publishing';

import type { SailwaveSummarySection } from './sailwave-html';
import { parseRankLabel } from './sailwave-html';

const WS = /\s+/g;

function textOf(el: Element | null): string {
  return (el?.textContent ?? '').replace(WS, ' ').trim();
}

/** Whether a header label is a race column ("Race 1", "Race 12"). */
function isRaceLabel(label: string): boolean {
  return /^race\s*\d+$/i.test(label);
}

function toSection(table: Element): SailwaveSummarySection | null {
  const trs = [...table.querySelectorAll('tr')];
  if (trs.length < 2) return null;
  const headerCells = [...trs[0].querySelectorAll('td, th')].map((c) => textOf(c));
  if (headerCells.length < 3) return null;
  // The rank column anchors the table; some pages lead with an empty marker
  // column before it, which is skipped. A page without a place column isn't
  // a standings table.
  const rankIdx = headerCells.findIndex((label) => /place/i.test(label));
  if (rankIdx === -1 || rankIdx > 2) return null;

  const firstRace = headerCells.findIndex(isRaceLabel);
  const lastRace =
    firstRace === -1
      ? -1
      : headerCells.length -
        1 -
        [...headerCells].reverse().findIndex(isRaceLabel);
  const leadEnd = firstRace === -1 ? headerCells.length : firstRace;

  const leadColumns = headerCells.slice(rankIdx + 1, leadEnd).map((label, i) => ({
    key: kebab(label) || `col${rankIdx + 1 + i}`,
    label,
  }));
  const raceHeaders =
    firstRace === -1 ? [] : headerCells.slice(firstRace, lastRace + 1);
  // Anything after the last race (rare) becomes summary columns.
  const summaryColumns =
    firstRace === -1
      ? []
      : headerCells.slice(lastRace + 1).map((label, i) => ({
          key: kebab(label) || `col${lastRace + 1 + i}`,
          label,
        }));

  const rows = trs.slice(1).flatMap((tr) => {
    const cells = [...tr.querySelectorAll('td')];
    if (cells.length !== headerCells.length) return [];
    const texts = cells.map((c) => textOf(c));
    const rankLabel = texts[rankIdx];
    return [
      {
        rankLabel,
        rank: parseRankLabel(rankLabel),
        leadCells: texts.slice(rankIdx + 1, leadEnd),
        raceCells:
          firstRace === -1
            ? []
            : texts.slice(firstRace, lastRace + 1).map((text, i) => ({
                text,
                // Sail100 marks a discarded cell with class `j` (counted
                // cells are `n`); some pages parenthesise instead. It has no
                // podium colouring.
                discard:
                  cells[firstRace + i].classList.contains('j') ||
                  /^\(.*\)$/.test(text.trim()),
                podium: 0,
              })),
        summaryCells: firstRace === -1 ? [] : texts.slice(lastRace + 1),
      },
    ];
  });

  return {
    title: null,
    caption: null,
    leadColumns,
    raceHeaders,
    summaryColumns,
    rows,
  };
}

/** Parse a Sail100 results page into Sailwave-shaped summary sections. */
export function parseSail100Html(html: string): {
  title: string | null;
  summaries: SailwaveSummarySection[];
} {
  // Fragment parsing, not `new JSDOM(html)` — see the note in
  // `sailwave-html.ts`.
  const doc = JSDOM.fragment(html);
  const summaries = [...doc.querySelectorAll('table')]
    .map(toSection)
    .filter((s): s is SailwaveSummarySection => s !== null && s.rows.length > 0);
  return {
    title: textOf(doc.querySelector('h1')) || null,
    summaries,
  };
}
