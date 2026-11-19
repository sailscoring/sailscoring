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
 * column, preserving the published order.
 *
 * A race column is one whose header links to that race's own page: IODAI's
 * read "Race 3", Bray Sailing Club's carry the race's code and date ("C1
 * 060523"). The races follow "Series Points", so a linked header before it —
 * Bray's "Handicap" links to a handicap listing — is an entrant column. The linked pages are results in their own right — Bray's carry
 * each boat's finish time, handicap and corrected time — and
 * `parseSail100RaceHtml` reads one into a race table. Generator-side only
 * (jsdom).
 *
 * Older Sail100 pages (Cork Week's, 2004 and 2006) carry no classes and no
 * `<h1>`: the heading is a bold line in a layout table above the standings
 * ("Cork Week IRC1"), and a discarded race cell is shaded grey
 * (`BGCOLOR="#999999"`) rather than given class `j`.
 */

import { JSDOM } from 'jsdom';

import { kebab } from '../publishing';

import type { SailwaveRaceSection, SailwaveSummarySection } from './sailwave-html';
import { parseRankLabel } from './sailwave-html';

const WS = /\s+/g;

function textOf(el: Element | null): string {
  return (el?.textContent ?? '').replace(WS, ' ').trim();
}

/** A header cell's text, with a line break read as the space it shows as
 *  ("Finishing<br/>Place"). */
function headerText(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  for (const br of copy.querySelectorAll('br')) br.replaceWith(' ');
  return textOf(copy);
}

/** Whether Sail100 showed a race cell as discarded: class `j`, grey shading
 *  (older pages), or parentheses (some pages). */
function isDiscardCell(cell: Element, text: string): boolean {
  return (
    cell.classList.contains('j') ||
    cell.getAttribute('bgcolor')?.trim().toLowerCase() === '#999999' ||
    /^\(.*\)$/.test(text.trim())
  );
}

/** Whether a header cell is a race column: it links to the race's page, or
 *  reads "Race 1", "Race 12". */
function isRaceHeader(cell: Element, label: string): boolean {
  return cell.querySelector('a[href]') !== null || /^race\s*\d+$/i.test(label);
}

/** The race page a race column's header links to, as published (relative to
 *  the standings page); null when the header carries no link. */
function raceLink(cell: Element): string | null {
  return cell.querySelector('a[href]')?.getAttribute('href')?.trim() || null;
}

function toSection(
  table: Element,
): { section: SailwaveSummarySection; raceLinks: Array<string | null> } | null {
  const trs = [...table.querySelectorAll('tr')];
  if (trs.length < 2) return null;
  const headerEls = [...trs[0].querySelectorAll('td, th')];
  const headerCells = headerEls.map((c) => textOf(c));
  if (headerCells.length < 3) return null;
  // The rank column anchors the table; some pages lead with an empty marker
  // column before it, which is skipped. A page without a place column isn't
  // a standings table.
  const rankIdx = headerCells.findIndex((label) => /place/i.test(label));
  if (rankIdx === -1 || rankIdx > 2) return null;

  const pointsIdx = headerCells.findIndex((label) => /^series points$/i.test(label));
  const isRace = headerEls.map(
    (cell, i) => i > pointsIdx && isRaceHeader(cell, headerCells[i]),
  );
  const firstRace = isRace.indexOf(true);
  const lastRace = isRace.lastIndexOf(true);
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
                // Sail100 has no podium colouring.
                discard: isDiscardCell(cells[firstRace + i], text),
                podium: 0,
              })),
        summaryCells: firstRace === -1 ? [] : texts.slice(lastRace + 1),
      },
    ];
  });

  return {
    section: {
      title: null,
      caption: null,
      leadColumns,
      raceHeaders,
      summaryColumns,
      rows,
    },
    raceLinks:
      firstRace === -1 ? [] : headerEls.slice(firstRace, lastRace + 1).map(raceLink),
  };
}

/** Parse a Sail100 results page into Sailwave-shaped summary sections.
 *  `raceLinks` runs parallel to `summaries`: for each, the page every race
 *  column's header links to, aligned with its `raceHeaders`. The title is the
 *  page's first `<h1>`, or on an older page without one its first bold line. */
export function parseSail100Html(html: string): {
  title: string | null;
  summaries: SailwaveSummarySection[];
  raceLinks: Array<Array<string | null>>;
} {
  // Fragment parsing, not `new JSDOM(html)` — see the note in
  // `sailwave-html.ts`.
  const doc = JSDOM.fragment(html);
  const parsed = [...doc.querySelectorAll('table')]
    .map(toSection)
    .filter((s) => s !== null && s.section.rows.length > 0);
  return {
    title: textOf(doc.querySelector('h1')) || textOf(doc.querySelector('b')) || null,
    summaries: parsed.map((s) => s!.section),
    raceLinks: parsed.map((s) => s!.raceLinks),
  };
}

/** A race page's results: the first table holding no table of its own whose
 *  first row is at least three cells, with a row after it. That passes over
 *  the layout tables a page may set its heading in — Royal Cork's wrap the
 *  whole page in one, with the logos and headings a single row of a table
 *  inside it, and Cork Week 2004's stack the headings one cell to a row. */
function resultsTable(doc: DocumentFragment): Element | null {
  return (
    [...doc.querySelectorAll('table')].find((table) => {
      if (table.querySelector('table')) return false;
      const trs = table.querySelectorAll('tr');
      return trs.length >= 2 && trs[0].querySelectorAll('td, th').length >= 3;
    }) ?? null
  );
}

/**
 * Parse one Sail100 race page — the page a standings column links to, or a
 * race the club published on its own. The page is headed by `<h1>`s, the last
 * of them the race ("C1 060523", "Race 3") — Bray's has the series above it,
 * Royal Cork's the sponsor and the class as well — then an `<h2>` start line
 * ("Start: Sat 6 May 23 10:35:00"), and a table whose first row is its
 * headers. An older page (Cork Week 2004) sets the same headings as bold
 * lines and the start line as plain text. Its columns are published as they
 * stand, keyed by label; a label the table repeats ("Points" leads and ends
 * Bray's) gets a numbered key. Returns null for a page with no such table.
 */
export function parseSail100RaceHtml(html: string): SailwaveRaceSection | null {
  const doc = JSDOM.fragment(html);
  const table = resultsTable(doc);
  const trs = table ? [...table.querySelectorAll('tr')] : [];
  if (!table || trs.length < 2) return null;
  const labels = [...trs[0].querySelectorAll('td, th')].map(headerText);
  const seen = new Map<string, number>();
  const columns = labels.map((label, i) => {
    const base = kebab(label) || `col${i}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { key: n === 1 ? base : `${base}-${n}`, label };
  });
  const rows = trs
    .slice(1)
    .map((tr) => [...tr.querySelectorAll('td')].map((c) => textOf(c)))
    .filter((cells) => cells.length === labels.length);
  const outside = (el: Element) => !table.contains(el);
  const headings = [...doc.querySelectorAll('h1')].map((h) => textOf(h)).filter(Boolean);
  const bold = [...doc.querySelectorAll('b')].filter(outside).map((b) => textOf(b)).filter(Boolean);
  const startLine = [...doc.querySelectorAll('td, th')]
    .filter(outside)
    .map((c) => textOf(c))
    .find((text) => /^start:/i.test(text));
  return {
    title: headings.at(-1) ?? bold.at(-1) ?? '',
    caption: textOf(doc.querySelector('h2')) || startLine || null,
    columns,
    rows,
  };
}
