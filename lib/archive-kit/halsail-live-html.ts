/**
 * Parser for live HalSail results — the `GET /Result/_Boat/{seriesId}`
 * fragment that `halsail.com/Result/Public/{seriesId}` loads over AJAX
 * (ADR-010). A different markup from the `archive.halsail.com` pages
 * `halsail-html.ts` reads, so it gets its own parser; both produce the same
 * `HalsailPage`, so one document builder serves both.
 *
 * What the fragment looks like:
 *
 * - The whole page is repeated once per Bootstrap breakpoint, each copy in a
 *   `div.sizeframe` shown at one screen width. Only the widest
 *   (`d-xl-block`) is read: it carries the most columns, and reading every
 *   frame would publish each table five times.
 * - Every column the club's HalSail setup can show is in the markup; the
 *   ones it doesn't show are `d-none`. That class is the page's own display
 *   contract, so hidden columns are dropped — an as-published page carries
 *   what was published, not what was in the database behind it.
 * - The standings table sits in `#divOverall`: Rank, the boat/person columns,
 *   one `Race N` column per race sailed, then Score. A high-point series says
 *   "HP scoring" in the caption.
 * - Each race is a table inside `div[data-raceid]`, captioned
 *   "Sat02 (Race 3), 16 May 2026 10:05:00, race officer was …, wind was …".
 *   A cancelled or abandoned race is a caption with no table body; it has no
 *   column in the standings either, so it is skipped.
 * - A series of a single race publishes no standings table, only the race.
 *   The standings rows are then read off the race table (the identity spine
 *   needs them) and the page is flagged race-only, to publish as a race
 *   result.
 *
 * Generator-side only (jsdom); never imported by server runtime code. Archive
 * repos import it by relative path, so it uses no `@/` alias imports.
 */

import { JSDOM } from 'jsdom';

import type {
  HalsailColumn,
  HalsailOverall,
  HalsailOverallRow,
  HalsailPage,
  HalsailRace,
} from './halsail-html';

const WS = /\s+/g;

/** A column key from its label: "Corrected" → "corrected", "Next Hcap" →
 *  "next-hcap". */
function columnKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

function textOf(el: Element | null): string {
  return (el?.textContent ?? '').replace(/ /g, ' ').replace(WS, ' ').trim();
}

/** A header's label as displayed. HalSail breaks long headers with `<br>`:
 *  "Next<br>Hcap" reads as two words, "Corr-<br>ected" as one. */
function headerLabel(th: Element): string {
  const clone = th.cloneNode(true) as Element;
  for (const br of [...clone.querySelectorAll('br')]) br.replaceWith(' ');
  return textOf(clone).replace(/(\w)- (\w)/g, '$1$2');
}

/** Whether a cell shows in the widest frame. `d-none` hides it unless a
 *  breakpoint class brings it back (`d-md-table-cell`); `d-xl-none` hides it
 *  at the width this parser reads. */
function shownAtXl(el: Element): boolean {
  const classes = [...el.classList];
  if (classes.includes('d-xl-none')) return false;
  if (!classes.includes('d-none')) return true;
  return classes.some((c) => /^d-(sm|md|lg|xl)-(?!none)[a-z-]+$/.test(c));
}

interface Grid {
  columns: HalsailColumn[];
  rows: string[][];
}

/** The table's visible columns and the matching cells of each body row. */
function visibleGrid(table: Element): Grid | null {
  const headers = [...table.querySelectorAll('thead th')];
  if (headers.length === 0) return null;
  const shown = headers.map(shownAtXl);
  const columns = headers
    .filter((_, i) => shown[i])
    .map((th, i) => {
      const label = headerLabel(th);
      return { key: columnKey(label) || `col${i}`, label };
    });
  const rows = [...table.querySelectorAll('tbody tr')]
    .map((tr) => [...tr.querySelectorAll('td')])
    .filter((tds) => tds.length === headers.length)
    .map((tds) => tds.filter((_, i) => shown[i]).map((td) => textOf(td)));
  return { columns, rows };
}

function parseRank(label: string): number | null {
  const m = /^(\d+)/.exec(label.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

const isRaceColumn = (c: HalsailColumn): boolean => /^race \d+$/i.test(c.label);

function toOverall(table: Element): { overall: HalsailOverall; highPoint: boolean } | null {
  const grid = visibleGrid(table);
  if (!grid || !/rank/i.test(grid.columns[0]?.label ?? '')) return null;
  const { columns } = grid;

  const firstRace = columns.findIndex(isRaceColumn);
  const lastRace = columns.length - 1 - [...columns].reverse().findIndex(isRaceColumn);
  const leadEnd = firstRace === -1 ? columns.length - 1 : firstRace;
  const summaryStart = firstRace === -1 ? columns.length - 1 : lastRace + 1;

  // The caption's `.lead` spans: the "Class, Series" title, then — on a
  // high-point series — "HP scoring". Both are what a reader of the page saw.
  const leads = [...table.querySelectorAll('caption .lead')].map(textOf).filter(Boolean);
  const caption = leads.join(' · ') || null;

  const rows: HalsailOverallRow[] = grid.rows.map((cells) => ({
    rankLabel: cells[0],
    rank: parseRank(cells[0]),
    leadCells: cells.slice(1, leadEnd),
    raceCells:
      firstRace === -1
        ? []
        : cells.slice(firstRace, lastRace + 1).map((text) => ({
            text,
            discard: /^\(.*\)$/.test(text),
          })),
    summaryCells: cells.slice(summaryStart),
  }));

  return {
    overall: {
      caption,
      leadColumns: columns.slice(1, leadEnd),
      raceHeaders: firstRace === -1 ? [] : columns.slice(firstRace, lastRace + 1).map((c) => c.label),
      raceDates: [],
      summaryColumns: columns.slice(summaryStart),
      rows,
    },
    highPoint: leads.some((l) => /\bHP scoring\b/i.test(l)),
  };
}

/** The race caption as displayed, without its link and icon chrome (the
 *  "ECHO Analysis" button, the pdf and chart links). */
function raceCaption(table: Element): string | null {
  const caption = table.querySelector('caption');
  if (!caption) return null;
  const clone = caption.cloneNode(true) as Element;
  for (const el of [...clone.querySelectorAll('a, i')]) el.remove();
  return textOf(clone).replace(/ ,/g, ',') || null;
}

/** "Sat02 (Race 3), 16 May 2026 10:05:00, …" → label + ISO date. */
function parseRaceCaption(caption: string | null): { label: string; date?: string } {
  if (!caption) return { label: 'Race' };
  const label = /^([^,]*?\bRace \d+\)?)/.exec(caption)?.[1]?.trim() ?? 'Race';
  const dm = /\b(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})\b/.exec(caption);
  const month = dm ? MONTHS[dm[2].toLowerCase()] : undefined;
  return {
    label,
    ...(dm && month ? { date: `${dm[3]}-${month}-${dm[1].padStart(2, '0')}` } : {}),
  };
}

function toRace(table: Element): HalsailRace | null {
  const grid = visibleGrid(table);
  if (!grid) return null;
  const caption = raceCaption(table);
  const { label, date } = parseRaceCaption(caption);
  return { label, ...(date ? { date } : {}), caption, columns: grid.columns, rows: grid.rows };
}

/** A single-race series publishes no standings: read its rows off the race
 *  table, place for rank, the boat/person columns as the lead. */
function overallFromRace(race: HalsailRace): HalsailOverall {
  const firstResult = race.columns.findIndex((c) => /^(laps|finish|elapsed)$/i.test(c.label));
  const leadEnd = firstResult === -1 ? race.columns.length : firstResult;
  return {
    caption: race.caption,
    leadColumns: race.columns.slice(1, leadEnd),
    raceHeaders: [],
    raceDates: [],
    summaryColumns: [],
    rows: race.rows.map((cells) => ({
      rankLabel: cells[0],
      rank: parseRank(cells[0]),
      leadCells: cells.slice(1, leadEnd),
      raceCells: [],
      summaryCells: [],
    })),
  };
}

/** Parse one live HalSail results fragment (one class × series). */
export function parseHalsailLiveHtml(html: string): HalsailPage {
  // Fragment parsing, not `new JSDOM(html)` — see `sailwave-html.ts`.
  const doc = JSDOM.fragment(html);
  const frames = [...doc.querySelectorAll('div.sizeframe')];
  const frame: ParentNode =
    frames.find((f) => f.classList.contains('d-xl-block')) ?? frames[0] ?? doc;

  const overallTable = frame.querySelector('#divOverall table');
  const parsed = overallTable ? toOverall(overallTable) : null;
  const races = [...frame.querySelectorAll('div[data-raceid] table')]
    .map(toRace)
    .filter((r): r is HalsailRace => r !== null);

  if (parsed) {
    return {
      overall: parsed.overall,
      races,
      ...(parsed.highPoint ? { highPoint: true } : {}),
    };
  }
  if (races.length === 1) {
    return { overall: overallFromRace(races[0]), races, raceOnly: true };
  }
  return { overall: null, races };
}
