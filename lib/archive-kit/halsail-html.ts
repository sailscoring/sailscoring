/**
 * Parser for HalSail public results HTML (ADR-010, #283) — the capture format
 * of the DBSC archive. One page per (class, series): an Overall Results table
 * (Rank, Sail Number, Name, Owner, Club, one linked column per race, Net Pts,
 * with a leading dates row), followed by one `<table id="raceNNNN">` per race
 * (Place, Sail number, Name, Owner, Club, Hcap, Finish, Elapsed, Corrected,
 * Points) — the per-race handicap detail the as-published regime stores as
 * display strings.
 *
 * Generator-side only (jsdom); never imported by server runtime code.
 */

import { JSDOM } from 'jsdom';

import { kebab } from '@/lib/publishing';

export interface HalsailColumn {
  key: string;
  label: string;
}

export interface HalsailOverallRow {
  rankLabel: string;
  rank: number | null;
  leadCells: string[];
  raceCells: Array<{ text: string; discard: boolean }>;
  summaryCells: string[];
}

export interface HalsailOverall {
  /** The caption badge text, e.g. "Class 'Cruisers 3 Master', series '2024
   *  Summer Series', Overall Results". */
  caption: string | null;
  leadColumns: HalsailColumn[];
  raceHeaders: string[];
  /** The dates row's race-aligned cells ("27 Apr"), where present. */
  raceDates: string[];
  summaryColumns: HalsailColumn[];
  rows: HalsailOverallRow[];
}

export interface HalsailRace {
  /** "Race 3" — the caption's leading phrase. */
  label: string;
  /** ISO date parsed from the caption's dd/mm/yyyy, where present. */
  date?: string;
  caption: string | null;
  columns: HalsailColumn[];
  rows: string[][];
}

export interface HalsailPage {
  overall: HalsailOverall | null;
  races: HalsailRace[];
}

const WS = /\s+/g;

function textOf(el: Element | null): string {
  return (el?.textContent ?? '')
    .replace(/ /g, ' ')
    .replace(WS, ' ')
    .trim();
}

/** The caption's human line, minus the navigation/print link cruft. */
function captionText(table: Element): string | null {
  // The widest-screen span carries the fullest text.
  const spans = [...table.querySelectorAll('caption span span')];
  const best = spans
    .map((s) => textOf(s))
    .sort((a, b) => b.length - a.length)[0];
  if (best) return best;
  const caption = table.querySelector('caption');
  return caption ? textOf(caption) || null : null;
}

function headerColumns(table: Element): HalsailColumn[] {
  return [...table.querySelectorAll('thead th')].map((th, i) => {
    const label = textOf(th);
    return { key: kebab(label) || `col${i}`, label };
  });
}

function bodyRows(table: Element): string[][] {
  return [...table.querySelectorAll('tbody tr')].map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => textOf(td)),
  );
}

function parseRank(label: string): number | null {
  const m = /^(\d+)/.exec(label.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

function toOverall(table: Element): HalsailOverall | null {
  const columns = headerColumns(table);
  if (columns.length === 0 || !/rank/i.test(columns[0].label)) return null;

  // Race columns are the linked `R…` headers between the lead block and the
  // trailing points column(s).
  const isRace = (c: HalsailColumn): boolean => /^r\d+$/i.test(c.label.replace(WS, ''));
  const firstRace = columns.findIndex(isRace);
  const lastRace = columns.length - 1 - [...columns].reverse().findIndex(isRace);
  const leadEnd = firstRace === -1 ? columns.length : firstRace;
  const summaryStart = firstRace === -1 ? columns.length : lastRace + 1;

  const allRows = bodyRows(table).filter((cells) => cells.length === columns.length);
  // The dates row leads the body: rank and sail cells empty, race cells dates.
  let raceDates: string[] = [];
  let dataRows = allRows;
  if (
    allRows.length > 0 &&
    allRows[0][0] === '' &&
    (firstRace === -1 || allRows[0].slice(firstRace, lastRace + 1).some((c) => c !== ''))
  ) {
    raceDates = firstRace === -1 ? [] : allRows[0].slice(firstRace, lastRace + 1);
    dataRows = allRows.slice(1);
  }

  const rows: HalsailOverallRow[] = dataRows.map((cells) => ({
    rankLabel: cells[0],
    rank: parseRank(cells[0]),
    leadCells: cells.slice(1, leadEnd),
    raceCells:
      firstRace === -1
        ? []
        : cells.slice(firstRace, lastRace + 1).map((text) => ({
            text,
            discard: /^\(.*\)$/.test(text.trim()),
          })),
    summaryCells: cells.slice(summaryStart),
  }));

  return {
    caption: captionText(table),
    leadColumns: columns.slice(1, leadEnd),
    raceHeaders:
      firstRace === -1 ? [] : columns.slice(firstRace, lastRace + 1).map((c) => c.label),
    raceDates,
    summaryColumns: columns.slice(summaryStart),
    rows,
  };
}

/** "Race 3 (provisional) 27/04/2024 14:25:00, …" → label + ISO date. */
function parseRaceCaption(caption: string | null): { label: string; date?: string } {
  if (!caption) return { label: 'Race' };
  const label = /^([A-Za-z ]*\d+)/.exec(caption)?.[1]?.trim() ?? 'Race';
  const dm = /(\d{2})\/(\d{2})\/(\d{4})/.exec(caption);
  return {
    label,
    ...(dm ? { date: `${dm[3]}-${dm[2]}-${dm[1]}` } : {}),
  };
}

function toRace(table: Element): HalsailRace | null {
  const columns = headerColumns(table);
  if (columns.length === 0) return null;
  const caption = captionText(table);
  const { label, date } = parseRaceCaption(caption);
  return {
    label,
    ...(date ? { date } : {}),
    caption,
    columns,
    rows: bodyRows(table).filter((cells) => cells.length === columns.length),
  };
}

/** Parse one HalSail results page (one class × series). */
export function parseHalsailHtml(html: string): HalsailPage {
  const dom = new JSDOM(html);
  try {
    const doc = dom.window.document;

    const tables = [...doc.querySelectorAll('table')];
    const raceTables = tables.filter((t) => /^race\d+$/.test(t.id));
    const overallTable = tables.find((t) => !/^race\d+$/.test(t.id) && t.querySelector('thead'));

    return {
      overall: overallTable ? toOverall(overallTable) : null,
      races: raceTables
        .map(toRace)
        .filter((r): r is HalsailRace => r !== null),
    };
  } finally {
    // Bulk generation parses hundreds of pages; an unclosed window keeps the
    // whole DOM reachable and the run OOMs.
    dom.window.close();
  }
}
