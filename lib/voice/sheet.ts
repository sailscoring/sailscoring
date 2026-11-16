/**
 * How lines taken by voice land on the finish sheet: the same rows the
 * recorder types, in the same finishing order. Pure: each function takes the
 * sheet's rows and gives back the rows as they should now be.
 *
 * A line makes one row, under the line's own id. A boat the call was sure
 * of, or read by sound, goes down as that boat; a call that fits several
 * boats, a number on no entry, and a press of Now nobody named a boat for
 * all go down as an unknown boat, for a person to resolve as they would a
 * typed number that matched nothing.
 */

import { makeFinish } from '@/lib/finish-entry';
import type { Finish } from '@/lib/types';

import type { VoiceLine, VoiceMark } from './types';

export interface SheetContext {
  raceId: string;
  /** Whether a boat's row carries a time of day. An unknown boat's does
   *  whenever the sheet takes times at all (`competitorId` null). */
  takesTime: (competitorId: string | null) => boolean;
  /** When each row taken by voice crossed, by row id: the order of rows on
   *  a sheet without times comes from this. */
  crossedAt: (rowId: string) => number | undefined;
}

/** A time on the phone's clock as the sheet writes it: local `HH:MM:SS`,
 *  to the nearest second. */
export function clockTime(at: number): string {
  const d = new Date(Math.round(at / 1000) * 1000);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

/** What an unknown boat's row is filed under. */
export function unknownLabel(line: Pick<VoiceLine, 'digits'>): string {
  return line.digits || '?';
}

const placed = (rows: readonly Finish[]) =>
  rows.filter((r) => r.sortOrder !== null).sort((a, b) => a.sortOrder! - b.sortOrder!);

/** Put `row` among the placed rows, just before the first one known to have
 *  crossed later, and number the order again from 1. */
function slot(rows: readonly Finish[], row: Finish, at: number, ctx: SheetContext): Finish[] {
  const order = placed(rows).filter((r) => r.id !== row.id);
  const time = clockTime(at);
  let insertAt = order.length;
  for (let i = 0; i < order.length; i++) {
    const other = order[i];
    const crossed = ctx.crossedAt(other.id);
    const later = crossed !== undefined ? crossed > at : other.finishTime !== undefined && other.finishTime > time;
    if (later) { insertAt = i; break; }
  }
  const next = [...order.slice(0, insertAt), row, ...order.slice(insertAt)];
  const renumbered = new Map(next.map((r, i) => [r.id, i + 1]));
  const out = rows
    .filter((r) => r.id !== row.id)
    .map((r) => (renumbered.has(r.id) && r.sortOrder !== renumbered.get(r.id) ? { ...r, sortOrder: renumbered.get(r.id)! } : r));
  return [...out, { ...row, sortOrder: renumbered.get(row.id)! }];
}

/**
 * Put a line on the sheet, or bring its row up to date: a line whose time
 * was fixed moves to where that time puts it, and a press of Now that was
 * given its boat becomes that boat's row.
 *
 * A boat that already has a place on the sheet under another row keeps it:
 * the rows come back unchanged, as a second typed entry of her number would
 * leave them.
 */
export function placeLine(rows: readonly Finish[], line: VoiceLine, ctx: SheetContext): Finish[] {
  if (line.removed) return removeLine(rows, line.id);
  const own = rows.find((r) => r.id === line.id);
  // A row the recorder has since put a boat to by hand stays that boat's.
  const settledByHand = own !== undefined && own.competitorId !== null;
  const competitorId = settledByHand ? own.competitorId : line.competitorId;
  const hers = competitorId && !settledByHand
    ? rows.find((r) => r.competitorId === competitorId && r.id !== line.id)
    : undefined;
  if (hers && hers.sortOrder !== null) return own ? removeLine(rows, line.id) : [...rows];

  const time = ctx.takesTime(competitorId) ? { finishTime: clockTime(line.at) } : {};
  const identity = competitorId
    ? { competitorId, unknownSailNumber: undefined }
    : { competitorId: null, unknownSailNumber: unknownLabel(line) };
  let row: Finish;
  if (own && !hers) {
    row = { ...own, ...(settledByHand ? {} : identity), tiedWithPrevious: false };
    if ('finishTime' in time) row.finishTime = time.finishTime;
    else delete row.finishTime;
  } else if (hers) {
    // She has a row with no place: a code, or a start check-in. The crossing
    // joins it, as it does when her number is typed.
    row = { ...hers, id: line.id, tiedWithPrevious: false, ...time };
  } else {
    row = makeFinish(ctx.raceId, { id: line.id, ...identity, sortOrder: 0, startPresent: competitorId ? true : null, ...time });
  }
  if (row.unknownSailNumber === undefined) delete row.unknownSailNumber;
  // Her unplaced row, and the line's own unknown row where it had one, both
  // give way to the row just made.
  const without = hers ? rows.filter((r) => r.id !== hers.id && r.id !== line.id) : rows;
  return slot(without, row, line.at, ctx);
}

/** Take a line's row off the sheet. */
export function removeLine(rows: readonly Finish[], lineId: string): Finish[] {
  if (!rows.some((r) => r.id === lineId)) return [...rows];
  const rest = rows.filter((r) => r.id !== lineId);
  const renumbered = new Map(placed(rest).map((r, i) => [r.id, i + 1]));
  return rest.map((r) => (renumbered.has(r.id) && r.sortOrder !== renumbered.get(r.id) ? { ...r, sortOrder: renumbered.get(r.id)! } : r));
}

/**
 * What a line still needs a person to look at, given its row as the sheet
 * has it now. A line whose row is gone, or whose row the recorder has since
 * put a boat to by hand, has nothing left to settle about its boat.
 */
export function marksOf(line: VoiceLine, row: Finish | undefined, takesTime: (competitorId: string | null) => boolean): VoiceMark[] {
  if (line.removed || !row) return [];
  const marks: VoiceMark[] = [];
  if (row.competitorId === null) {
    marks.push(line.how === 'ambiguous' ? 'choose' : line.how === 'tap' ? 'no-boat' : 'unknown');
  } else if (line.how === 'sounds' && !line.boatSettled && row.competitorId === line.competitorId) {
    marks.push('check');
  }
  if (line.how !== 'tap' && line.timeFrom === 'called' && !line.timeSettled && row.finishTime && takesTime(row.competitorId)) {
    // Only while the row still carries the time the call gave it.
    if (row.finishTime === clockTime(line.at)) marks.push('time');
  }
  return marks;
}

/** The lines with something left to settle, in the order they crossed. */
export function linesToSettle(
  lines: readonly VoiceLine[],
  rows: readonly Finish[],
  takesTime: (competitorId: string | null) => boolean,
): { line: VoiceLine; row: Finish; marks: VoiceMark[] }[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return lines
    .map((line) => ({ line, row: byId.get(line.id), marks: marksOf(line, byId.get(line.id), takesTime) }))
    .filter((x): x is { line: VoiceLine; row: Finish; marks: VoiceMark[] } => x.row !== undefined && x.marks.length > 0)
    .sort((a, b) => a.line.at - b.line.at);
}
