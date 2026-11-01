/**
 * The starters checklist: the printed check-off list a recorder takes onto
 * the committee boat, one row per expected boat, ticked as each arrives in
 * the starting area.
 *
 * The sheet is one table per *start*, not per fleet. Fleets here are scoring
 * fleets, and a keelboat class is routinely scored under two or three of them
 * at once (Class 1 IRC, Class 1 HPH, Class 1 ECHO) with each boat entered in
 * some subset. The recorder wants one table per class with every boat on it
 * once, whatever it is scored under. The starting area is what the sheet
 * records, so the start is the grouping:
 *
 *  - When the series has a default start sequence, each start group is one
 *    table, holding every boat in any of the group's fleets. A fleet outside
 *    every group gets a table of its own.
 *  - When it has none, fleets that share any competitor merge into one table,
 *    transitively. Class 1 IRC and Class 1 HPH share boats and merge; Class 1
 *    and Class 2 do not and stay apart. That gives the per-class tables with
 *    nothing configured.
 *
 * A table is headed by the words its fleets' names have in common when only
 * the scoring system differs ("Class 1 IRC" and "Class 1 HPH" head a table
 * "Class 1"), and by the names joined otherwise.
 */
import { isSyntheticFleetName } from './publishing';
import { compareSailNumbersIgnoringPrefix } from './sail-number-sort';
import type { StartGroup } from './types';

export interface ChecklistBoat {
  sailNumber: string;
  boatName?: string;
  /** What the recorder sees first, long before the number can be read; on a
   *  handicap fleet of mixed boats, how one boat is told from another. */
  boatClass?: string;
}

export interface ChecklistTable {
  /** The start's heading; null on a series with a single, unnamed start. */
  heading: string | null;
  /** In sail-number order, ignoring national prefixes: the recorder reads
   *  the number off the sail, and "IRL 12" sits beside "GBR 12". */
  boats: ChecklistBoat[];
}

export interface FleetLike {
  id: string;
  name: string;
  displayOrder: number;
  splitRoundId?: string;
}

/** Whatever a sheet lists, so long as it has a sail number to sort by and the
 *  fleets it is entered in to group by. */
export interface FleetEntry {
  sailNumber: string;
  fleetIds: string[];
}

/** One table of a sheet grouped by {@link groupEntriesByStart}. */
export interface EntryGroup<T> {
  heading: string | null;
  entries: T[];
}

/**
 * The fleets a boat is listed under on the sheet: the ones it is entered in,
 * less the app's own `Default` / `Unknown`, and with split-round fleets
 * collapsed to the latest round's (assignment appends rather than replaces,
 * so a boat two rounds in holds both rounds' fleets). The same rule the
 * published competitor list applies to its Fleet column.
 */
function displayFleetIds(boat: FleetEntry, fleetById: Map<string, FleetLike>): string[] {
  const own = boat.fleetIds
    .map((id) => fleetById.get(id))
    .filter((f): f is FleetLike => !!f && !isSyntheticFleetName(f.name));
  const latestRound = own
    .filter((f) => f.splitRoundId)
    .reduce<FleetLike | null>(
      (best, f) => (best === null || f.displayOrder > best.displayOrder ? f : best),
      null,
    );
  return own.filter((f) => !f.splitRoundId || f.id === latestRound?.id).map((f) => f.id);
}

/**
 * The leading words the names share, when what each name has left over is a
 * single word: the scoring system. "Class 1 IRC" and "Class 1 HPH" head a
 * table "Class 1"; "Cruisers IRC" and "Cruisers ECHO" head "Cruisers". Names
 * that differ by more than that are joined instead: a start shared by
 * "Class 2 HPH" and "Class 3 HPH" is not headed "Class", which says nothing,
 * and "Class 1 IRC" and "Class 10 IRC" are not headed "Class 1", which says
 * the wrong thing.
 */
export function checklistHeading(names: string[]): string {
  if (names.length === 1) return names[0];
  const words = names.map((n) => n.trim().split(/\s+/));
  const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;
  let common = 0;
  while (words.every((ws) => ws.length > common + 1 && same(ws[common], words[0][common]))) common++;
  const oneWordLeft = words.every((ws) => ws.length === common + 1);
  const heading = words[0].slice(0, common).join(' ').replace(/[\s\-–—/:]+$/, '');
  return oneWordLeft && heading !== '' ? heading : names.join(' / ');
}

/**
 * Group the entries into the tables of the starters checklist.
 *
 * `startGroups` is the series' default start sequence, when it has one. The
 * tables come out in start order when there is a sequence, then any fleet
 * outside it in fleet display order; without a sequence, in the display
 * order of each merged group's first fleet.
 */
export function buildStartersChecklist(input: {
  fleets: FleetLike[];
  competitors: (ChecklistBoat & { fleetIds: string[] })[];
  startGroups?: StartGroup[];
}): ChecklistTable[] {
  const boatOf = ({ sailNumber, boatName, boatClass }: ChecklistBoat): ChecklistBoat => ({
    sailNumber,
    ...(boatName ? { boatName } : {}),
    ...(boatClass ? { boatClass } : {}),
  });
  return groupEntriesByStart(input).map(({ heading, entries }) => ({ heading, boats: entries.map(boatOf) }));
}

/**
 * The grouping behind the starters checklist, for any sheet that lists each
 * boat once under the start it belongs to: one table per start group when
 * `startGroups` is given, otherwise one per set of fleets that share a boat.
 * Each table is in sail-number order, ignoring national prefixes. Boats in no
 * displayed fleet make a last, unheaded table.
 */
export function groupEntriesByStart<T extends FleetEntry>(input: {
  fleets: FleetLike[];
  competitors: T[];
  startGroups?: StartGroup[];
}): EntryGroup<T>[] {
  const fleets = [...input.fleets].sort((a, b) => a.displayOrder - b.displayOrder);
  const fleetById = new Map(fleets.map((f) => [f.id, f]));
  const membership = input.competitors.map((c) => ({ boat: c, fleetIds: displayFleetIds(c, fleetById) }));

  // Only fleets with a boat on them make a table; an empty table records nothing.
  const populated = fleets.filter((f) => membership.some((m) => m.fleetIds.includes(f.id)));
  const populatedIds = new Set(populated.map((f) => f.id));

  // Which table each fleet belongs to, as a representative fleet id.
  const groupOf = new Map<string, string>();
  const groupOrder: string[] = [];
  const join = (ids: string[]) => {
    const present = ids.filter((id) => populatedIds.has(id) && !groupOf.has(id));
    if (present.length === 0) return;
    const rep = present[0];
    groupOrder.push(rep);
    for (const id of present) groupOf.set(id, rep);
  };

  if (input.startGroups && input.startGroups.length > 0) {
    for (const g of input.startGroups) join(g.fleetIds);
    for (const f of populated) join([f.id]);
  } else {
    // Merge fleets that share a boat, transitively: union-find over the
    // populated fleets, then emit the components in display order.
    const parent = new Map(populated.map((f) => [f.id, f.id]));
    const find = (id: string): string => {
      let r = id;
      while (parent.get(r) !== r) r = parent.get(r)!;
      return r;
    };
    for (const m of membership) {
      for (let i = 1; i < m.fleetIds.length; i++) {
        const a = find(m.fleetIds[0]);
        const b = find(m.fleetIds[i]);
        if (a !== b) parent.set(b, a);
      }
    }
    const components = new Map<string, string[]>();
    for (const f of populated) {
      const root = find(f.id);
      const list = components.get(root) ?? [];
      list.push(f.id);
      components.set(root, list);
    }
    for (const ids of components.values()) join(ids);
  }

  const byBoat = (a: FleetEntry, b: FleetEntry) =>
    compareSailNumbersIgnoringPrefix(a.sailNumber, b.sailNumber);

  const tables: EntryGroup<T>[] = groupOrder.map((rep) => {
    const fleetIds = populated.filter((f) => groupOf.get(f.id) === rep).map((f) => f.id);
    const names = fleetIds.map((id) => fleetById.get(id)!.name);
    const entries = membership
      .filter((m) => m.fleetIds.some((id) => groupOf.get(id) === rep))
      .map((m) => m.boat)
      .sort(byBoat);
    return { heading: checklistHeading(names), entries };
  });

  // Boats in no fleet at all: every boat on a single-fleet series (its only
  // fleet is `Default`), or the odd unassigned boat on a multi-fleet one. One
  // table, unheaded; alone on a single-fleet series, last otherwise.
  const unassigned = membership.filter((m) => m.fleetIds.length === 0).map((m) => m.boat).sort(byBoat);
  if (unassigned.length > 0) tables.push({ heading: null, entries: unassigned });

  return tables;
}

/**
 * How tightly the sheet is set. The first is the sheet as designed; each
 * after it gives up a little more to save paper, in the order a scorer
 * preparing the sheet by hand would: a spare row under each start first,
 * since a late entry can still go in the notes, then the row height and the
 * size of the number, then the notes themselves.
 *
 * Every height on the sheet is fixed rather than left to the text, so that
 * what is planned here is what prints: the stylesheet is written from these
 * same figures.
 */
export interface ChecklistDensity {
  /** A boat's row, rule included. */
  rowMm: number;
  /** The start's heading row, the space above the heading included. */
  headMm: number;
  /** Between one start's table and the next in a column. */
  gapMm: number;
  /** The sail number. */
  sailPt: number;
  /** The tick box's side. */
  tickMm: number;
  spareRows: number;
  noteLines: number;
}

export const CHECKLIST_DENSITIES: readonly ChecklistDensity[] = [
  { rowMm: 7.6, headMm: 9, gapMm: 5, sailPt: 13, tickMm: 5, spareRows: 2, noteLines: 4 },
  { rowMm: 7.6, headMm: 9, gapMm: 5, sailPt: 13, tickMm: 5, spareRows: 1, noteLines: 4 },
  { rowMm: 6.6, headMm: 8, gapMm: 4, sailPt: 12, tickMm: 4.6, spareRows: 1, noteLines: 3 },
  { rowMm: 5.9, headMm: 7, gapMm: 3, sailPt: 11, tickMm: 4.2, spareRows: 1, noteLines: 2 },
];

/**
 * The page the sheet is planned for: A4 inside the sheet's own 8mm margins,
 * two columns. The stylesheet asks for A4, so this is what the browser
 * prints on; a printer loaded with Letter scales it.
 */
export const CHECKLIST_PAGE = {
  /** The printable height, less a little slack for rounding in the browser. */
  heightMm: 279,
  /** The line naming the series and leaving Date, Race(s) and Recorder
   *  blank, on the first page only. */
  identMm: 10,
  noteLabelMm: 6,
  noteLineMm: 6,
  columns: 2,
} as const;

/** How short a table has to be to be kept off a column boundary. A table of
 *  a few boats split across two columns is more distracting than the space
 *  the split saves; a class of thirty is not. */
export const KEEP_WHOLE_ROWS = 8;

/** Rows of a start's table, spare rows included, from `from` up to `to`. */
export interface ChecklistPiece {
  table: number;
  from: number;
  to: number;
}

export interface ChecklistColumn {
  pieces: ChecklistPiece[];
  /** The closing notes block ends this column. */
  notes?: boolean;
}

export interface ChecklistSheet {
  density: ChecklistDensity;
  /** Each page's columns, `CHECKLIST_PAGE.columns` of them. */
  pages: ChecklistColumn[][];
}

interface PlanTable {
  boats: number;
  headed: boolean;
}

/**
 * Lay the tables out at one density, into columns of `capMm(page)`.
 *
 * A start's table may run on from one column into the next on the same
 * page, but never over a page: one that would is moved whole to the next
 * page, where the recorder finds the start in one place rather than turning
 * over in the middle of it. Only a table too long for a page of its own is
 * split across pages, because there is nothing else to do with it.
 *
 * With `wholeColumns`, a table that will not fit in what is left of a column
 * but would fit whole in the next one on the page starts there instead of
 * splitting: one start to a column, where there is room for it.
 */
function layOut(
  tables: PlanTable[],
  d: ChecklistDensity,
  capMm: (page: number) => number,
  wholeColumns: boolean,
): ChecklistColumn[][] {
  const pages: ChecklistColumn[][] = [];
  let col = 0;
  let used = 0;
  const openPage = () => {
    pages.push(Array.from({ length: CHECKLIST_PAGE.columns }, () => ({ pieces: [] })));
    col = 0;
    used = 0;
  };
  const nextColumn = () => {
    if (col + 1 < CHECKLIST_PAGE.columns) {
      col++;
      used = 0;
    } else {
      openPage();
    }
  };
  const cap = () => capMm(pages.length - 1);
  const gap = () => (used > 0 ? d.gapMm : 0);

  /** How many of `left` rows to set in what remains of the current column,
   *  0 when it is better to start the next one. Never a lone row at the
   *  foot of a column, nor a lone row carried over to the top of the next. */
  const take = (left: number, head: number, whole: boolean): number => {
    const room = Math.floor((cap() - used - gap() - head) / d.rowMm + 1e-9);
    if (whole) return room >= left ? left : 0;
    if (room >= left) return left;
    const n = left - room === 1 ? room - 1 : room;
    return n >= 2 ? n : 0;
  };

  /** Whether the table fits in what is left of this page, from here. */
  const fitsOnPage = (rows: number, head: number, whole: boolean): boolean => {
    const saved = { col, used };
    let left = rows;
    let ok = true;
    while (left > 0) {
      const n = take(left, head, whole);
      if (n > 0) {
        used += gap() + head + n * d.rowMm;
        left -= n;
      }
      if (left > 0) {
        if (col + 1 >= CHECKLIST_PAGE.columns) {
          ok = false;
          break;
        }
        col++;
        used = 0;
      }
    }
    ({ col, used } = saved);
    return ok;
  };

  openPage();
  tables.forEach((t, i) => {
    const rows = t.boats + d.spareRows;
    const head = t.headed ? d.headMm : 0;
    const whole = rows <= KEEP_WHOLE_ROWS;
    const pageEmpty = col === 0 && used === 0;
    if (!pageEmpty && !fitsOnPage(rows, head, whole)) openPage();
    else if (
      wholeColumns &&
      used > 0 &&
      col + 1 < CHECKLIST_PAGE.columns &&
      take(rows, head, true) === 0 &&
      head + rows * d.rowMm <= cap()
    ) {
      nextColumn();
    }
    let from = 0;
    while (from < rows) {
      let n = take(rows - from, head, whole);
      // An empty column that still cannot take the table: a column shorter
      // than the table's minimum. Set what fits and let the rest run on.
      if (n === 0 && used === 0) n = Math.max(1, Math.min(rows - from, Math.floor((cap() - head) / d.rowMm)));
      if (n > 0) {
        pages[pages.length - 1][col].pieces.push({ table: i, from, to: from + n });
        used += gap() + head + n * d.rowMm;
        from += n;
      }
      if (from < rows) nextColumn();
    }
  });

  const notesMm = CHECKLIST_PAGE.noteLabelMm + d.noteLines * CHECKLIST_PAGE.noteLineMm;
  if (used > 0 && used + d.gapMm + notesMm > cap()) nextColumn();
  pages[pages.length - 1][col].notes = true;
  return pages;
}

/**
 * Plan the printed sheet: which rows of which start go in which column of
 * which page, and how tightly it is set.
 *
 * The density is the loosest that prints on the fewest pages. A sheet a few
 * rows over one page is tightened onto one, as anyone preparing it by hand
 * would; one that needs two pages however it is set prints at full size on
 * two, broken between starts. At that density, each start is kept to a
 * column of its own when that costs no page.
 *
 * The last page's columns are then balanced, shortest first, so that a
 * short list stays short and the notes sit under it rather than at the foot
 * of a second column drawn out to the full page height.
 */
export function planChecklistSheet(tables: PlanTable[]): ChecklistSheet {
  const full = (page: number) =>
    CHECKLIST_PAGE.heightMm - (page === 0 ? CHECKLIST_PAGE.identMm : 0);
  let best: { density: ChecklistDensity; wholeColumns: boolean; pages: ChecklistColumn[][] } | null = null;
  for (const density of CHECKLIST_DENSITIES) {
    for (const wholeColumns of [true, false]) {
      const pages = layOut(tables, density, full, wholeColumns);
      if (best === null || pages.length < best.pages.length) best = { density, wholeColumns, pages };
    }
  }
  const { density, wholeColumns } = best!;
  const count = best!.pages.length;
  const last = count - 1;

  // The shortest last-page column that keeps everything on the same number
  // of pages, to the millimetre.
  let lo = 0;
  let hi = full(last);
  while (hi - lo > 1) {
    const mid = (lo + hi) / 2;
    const pages = layOut(tables, density, (p) => (p === last ? mid : full(p)), wholeColumns);
    if (pages.length === count) hi = mid;
    else lo = mid;
  }
  return { density, pages: layOut(tables, density, (p) => (p === last ? hi : full(p)), wholeColumns) };
}
