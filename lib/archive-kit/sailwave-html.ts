/**
 * Parser for Sailwave-published results HTML (ADR-010, #283) — the capture
 * format of the IODAI and HYC archives. Sailwave's HTML is machine-generated
 * and regular: each results section is an `<h3 class="summarytitle">`, a
 * `<div class="caption">` line, and a `<table class="summarytable">` whose
 * `<colgroup>` col classes name the columns (`rank`, `sailno`, `helmname`,
 * `race`, `total`, `nett`, …); per-race detail tables follow the same shape
 * with `racetitle` / `racetable`.
 *
 * Generator-side only (runs in archive-repo CI / operator machines), so it
 * may lean on jsdom — never imported by server runtime code.
 */

import { JSDOM } from 'jsdom';

/** One column of a parsed table: the colgroup class and the header label. */
export interface SailwaveColumn {
  key: string;
  label: string;
}

export interface SailwaveSummaryRow {
  /** The rank cell as published ("1st", "2=", "DNQ"). */
  rankLabel: string;
  /** Parsed structured rank, when the label carries one. */
  rank: number | null;
  /** Aligned with the section's `leadColumns`. */
  leadCells: string[];
  /** Aligned with `raceHeaders`; discard = parenthesised as published;
   *  podium = the source's rank1/2/3 cell colouring (0 = none). */
  raceCells: Array<{ text: string; discard: boolean; podium: number }>;
  /** Aligned with `summaryColumns`. */
  summaryCells: string[];
}

/** One summary (standings) section of a Sailwave page. */
export interface SailwaveSummarySection {
  /** The `<h3 class="summarytitle">` text, e.g. "Senior Division"; null for
   *  a page with one untitled summary. */
  title: string | null;
  /** The caption line ("Sailed: 6, Discards: 1, …"). */
  caption: string | null;
  leadColumns: SailwaveColumn[];
  raceHeaders: string[];
  summaryColumns: SailwaveColumn[];
  rows: SailwaveSummaryRow[];
}

/** One per-race detail table. */
export interface SailwaveRaceSection {
  /** The `<h3 class="racetitle">` text, e.g. "R1" or "Race 1 - Jun 15". */
  title: string;
  caption: string | null;
  columns: SailwaveColumn[];
  rows: string[][];
}

export interface SailwavePage {
  /** The page's `<h1>` — the event name as published. */
  title: string | null;
  /** The `<h2>` — venue and dates as published. */
  subtitle: string | null;
  summaries: SailwaveSummarySection[];
  races: SailwaveRaceSection[];
}

const WS = /\s+/g;

function textOf(el: Element | null): string {
  return (el?.textContent ?? '').replace(WS, ' ').trim();
}

/** "1st" → 1, "22nd" → 22, "3" → 3, "2=" → 2; anything else → null. */
export function parseRankLabel(label: string): number | null {
  const m = /^(\d+)/.exec(label.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

/** The nearest preceding sibling heading of the given class, stopping at any
 *  other table (which would own that heading instead). */
function precedingHeading(table: Element, headingClass: string): string | null {
  let el = table.previousElementSibling;
  while (el) {
    if (el.tagName === 'TABLE') return null;
    if (el.tagName === 'H3' && el.classList.contains(headingClass)) {
      return textOf(el);
    }
    el = el.previousElementSibling;
  }
  return null;
}

/** The nearest preceding caption div, stopping at headings/tables. */
function precedingCaption(table: Element): string | null {
  let el = table.previousElementSibling;
  while (el) {
    if (el.tagName === 'TABLE') return null;
    if (el.tagName === 'DIV' && el.classList.contains('caption')) {
      return textOf(el);
    }
    if (el.tagName === 'H3') return null;
    el = el.previousElementSibling;
  }
  return null;
}

interface RawTable {
  columnKeys: string[];
  headerLabels: string[];
  rows: string[][];
  /** Per-cell podium marker (1–3) parsed from Sailwave's rank1/2/3 cell
   *  classes, aligned with `rows`; 0 = none. */
  podium: number[][];
}

function parseTable(table: Element): RawTable {
  const columnKeys = [...table.querySelectorAll('colgroup col')].map(
    (col) => col.getAttribute('class')?.trim() ?? '',
  );
  // Older Sailwave output (~2014) omits <thead>: the title row is a plain
  // <tr> of <th> cells, so fall back to the first row carrying th's.
  let headerLabels = [...table.querySelectorAll('thead th')].map((th) =>
    textOf(th),
  );
  if (headerLabels.length === 0) {
    const titleRow = [...table.querySelectorAll('tr')].find(
      (tr) => tr.querySelector('th') !== null,
    );
    headerLabels = titleRow
      ? [...titleRow.querySelectorAll('th')].map((th) => textOf(th))
      : [];
  }
  // Data rows are the td-bearing ones wherever they sit (jsdom implies a
  // tbody either way; a th-only title row yields no tds and filters out).
  const cellRows = [...table.querySelectorAll('tr')]
    .map((tr) => [...tr.querySelectorAll('td')])
    .filter((cells) => cells.length > 0);
  const rows = cellRows.map((cells) => cells.map((td) => textOf(td)));
  const podium = cellRows.map((cells) =>
    cells.map((td) => {
      const m = /(?:^|\s)rank([123])(?:\s|$)/.exec(td.getAttribute('class') ?? '');
      return m ? Number(m[1]) : 0;
    }),
  );
  return { columnKeys, headerLabels, rows, podium };
}

function toSummarySection(
  table: Element,
): SailwaveSummarySection | null {
  const raw = parseTable(table);
  const keys = raw.columnKeys;
  // The rank column anchors the table but isn't always first — a handful of
  // captures lead with helm/crew columns. It is lifted to the front; the
  // other lead columns keep their published order.
  // A section may have no rank column at all (IODAI publishes coached
  // regatta fleets without places — participation, not a ranking): rows then
  // carry rank null and every column is a lead column.
  const rankIdx = keys.indexOf('rank');
  if (keys.length === 0) return null;

  const firstRace = keys.indexOf('race');
  const lastRace = keys.lastIndexOf('race');
  if (firstRace !== -1 && rankIdx > firstRace) return null;
  // A summary without race columns still parses: everything after the lead
  // block is summary (some captures publish standings-only pages).
  const leadEnd = firstRace === -1 ? keys.length : firstRace;
  const summaryStart = firstRace === -1 ? keys.length : lastRace + 1;

  const columnAt = (i: number): SailwaveColumn => ({
    key: keys[i] || `col${i}`,
    label: raw.headerLabels[i] ?? '',
  });
  const leadIdxs = [...Array(leadEnd).keys()].filter((i) => i !== rankIdx);
  const leadColumns = leadIdxs.map(columnAt);
  const raceHeaders =
    firstRace === -1 ? [] : raw.headerLabels.slice(firstRace, lastRace + 1);
  const summaryColumns = [...Array(keys.length).keys()]
    .slice(summaryStart)
    .map(columnAt);

  const rows: SailwaveSummaryRow[] = raw.rows
    .map((cells, rowIdx) => ({ cells, podium: raw.podium[rowIdx] }))
    .filter(({ cells }) => cells.length === keys.length)
    .map(({ cells, podium }) => {
      const rankLabel = rankIdx === -1 ? '' : cells[rankIdx];
      const raceCells =
        firstRace === -1
          ? []
          : cells.slice(firstRace, lastRace + 1).map((text, i) => ({
              text,
              discard: /^\(.*\)$/.test(text.trim()),
              // Sailwave marks 1st/2nd/3rd-in-race cells with rank1/2/3
              // classes — the podium colouring on the published page.
              podium: podium[firstRace + i] || 0,
            }));
      return {
        rankLabel,
        rank: parseRankLabel(rankLabel),
        leadCells: leadIdxs.map((i) => cells[i]),
        raceCells,
        summaryCells: cells.slice(summaryStart),
      };
    });

  return {
    title: precedingHeading(table, 'summarytitle'),
    caption: precedingCaption(table),
    leadColumns,
    raceHeaders,
    summaryColumns,
    rows,
  };
}

function toRaceSection(table: Element): SailwaveRaceSection | null {
  const raw = parseTable(table);
  if (raw.headerLabels.length === 0) return null;
  const columns: SailwaveColumn[] = raw.headerLabels.map((label, i) => ({
    key: raw.columnKeys[i] || `col${i}`,
    label,
  }));
  return {
    title: precedingHeading(table, 'racetitle') ?? 'Race',
    caption: precedingCaption(table),
    columns,
    rows: raw.rows.filter((cells) => cells.length === columns.length),
  };
}

/** Parse a whole Sailwave results page. */
export function parseSailwaveHtml(html: string): SailwavePage {
  const dom = new JSDOM(html);
  try {
    const doc = dom.window.document;

    const summaries = [...doc.querySelectorAll('table.summarytable')]
      .map(toSummarySection)
      .filter((s): s is SailwaveSummarySection => s !== null);
    const races = [...doc.querySelectorAll('table.racetable')]
      .map(toRaceSection)
      .filter((r): r is SailwaveRaceSection => r !== null);

    return {
      title: textOf(doc.querySelector('h1')),
      subtitle: textOf(doc.querySelector('h2')) || null,
      summaries,
      races,
    };
  } finally {
    // Bulk generation parses hundreds of pages; an unclosed window keeps the
    // whole DOM reachable and the run OOMs.
    dom.window.close();
  }
}
