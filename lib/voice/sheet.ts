/**
 * How a recording's finishes land on the finish sheet: the same rows the
 * recorder types, in the same finishing order. Pure: each function takes
 * the sheet's rows and gives back the rows as they should now be.
 *
 * Two kinds of row come from a recording. An accepted finish makes an
 * ordinary row, under the finish's own id, and from then on the row is the
 * finish: a person can change it on the sheet like any other. A suggested
 * finish makes a row marked as a suggestion, kept in step with the
 * suggestions as they change and never submitted. Changing a suggested row
 * by hand accepts it as changed; deleting it says it is not a finish.
 */

import { makeFinish } from '@/lib/finish-entry';
import type { Finish } from '@/lib/types';

import type { Suggestion } from './timeline';
import type { VoiceFinish } from './types';

export interface SheetContext {
  raceId: string;
  /** Whether a competitor's row carries a time of day. A row for someone
   *  not on the entry list (`competitorId` null) does whenever the sheet
   *  takes times at all. */
  takesTime: (competitorId: string | null) => boolean;
  /** When each row from the recording finished, by row id: the order of
   *  rows on a sheet without times comes from this. */
  crossedAt: (rowId: string) => number | undefined;
}

/** A time on the phone's clock as the sheet writes it: local `HH:MM:SS`,
 *  to the nearest second. */
export function clockTime(at: number): string {
  const d = new Date(Math.round(at / 1000) * 1000);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

/** A time on the phone's clock to a tenth of a second, as the timeline shows it. */
export function clockTenths(at: number): string {
  const tenths = Math.round(at / 100);
  const d = new Date(Math.floor(tenths / 10) * 1000);
  const hms = [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
  return `${hms}.${tenths % 10}`;
}

/**
 * `HH:MM:SS` typed on the sheet, as a time on the phone's clock on the day
 * of `near`: the one closest to it, so a finish typed just after midnight
 * lands on the right day.
 */
export function atOfClockTime(time: string, near: number): number | null {
  const m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(time);
  if (!m) return null;
  const d = new Date(near);
  d.setHours(Number(m[1]), Number(m[2]), Number(m[3]), 0);
  const day = 24 * 60 * 60 * 1000;
  const at = d.getTime();
  return [at - day, at, at + day].sort((a, b) => Math.abs(a - near) - Math.abs(b - near))[0];
}

const SUGGESTION = 'voice-suggestion-';
/** The row a suggestion makes, by its key. */
export const suggestionRowId = (key: string) => `${SUGGESTION}${key}`;
export const isSuggestionRow = (row: Pick<Finish, 'id'>) => row.id.startsWith(SUGGESTION);
export const suggestionKeyOf = (rowId: string) => (rowId.startsWith(SUGGESTION) ? rowId.slice(SUGGESTION.length) : null);

/** What a row from the recording says, to tell a person's change from ours. */
export interface RowSignature {
  competitorId: string | null;
  unknownSailNumber: string | null;
  finishTime: string | null;
}
export const signatureOf = (row: Finish): RowSignature => ({
  competitorId: row.competitorId,
  unknownSailNumber: row.unknownSailNumber ?? null,
  finishTime: row.finishTime ?? null,
});
const sameSignature = (a: RowSignature, b: RowSignature) =>
  a.competitorId === b.competitorId && a.unknownSailNumber === b.unknownSailNumber && a.finishTime === b.finishTime;

/** What an unknown competitor's row is filed under: the sail number heard
 *  or typed, or `?` for a NOW with none. */
const unknownLabel = (sailNumber: string | null) => sailNumber || '?';

const placed = (rows: readonly Finish[]) =>
  rows.filter((r) => r.sortOrder !== null).sort((a, b) => a.sortOrder! - b.sortOrder!);

/** Put `row` among the placed rows, just before the first one known to have
 *  finished later, and number the order again from 1. */
function slot(rows: readonly Finish[], row: Finish, at: number, ctx: SheetContext): Finish[] {
  const order = placed(rows).filter((r) => r.id !== row.id);
  const time = clockTime(at);
  let insertAt = order.length;
  for (let i = 0; i < order.length; i++) {
    const other = order[i];
    const crossed = ctx.crossedAt(other.id);
    const later = crossed !== undefined ? crossed > at : other.finishTime !== undefined && other.finishTime > time;
    if (later) {
      insertAt = i;
      break;
    }
  }
  const next = [...order.slice(0, insertAt), row, ...order.slice(insertAt)];
  const renumbered = new Map(next.map((r, i) => [r.id, i + 1]));
  const out = rows
    .filter((r) => r.id !== row.id)
    .map((r) => (renumbered.has(r.id) && r.sortOrder !== renumbered.get(r.id) ? { ...r, sortOrder: renumbered.get(r.id)! } : r));
  return [...out, { ...row, sortOrder: renumbered.get(row.id)! }];
}

/** Take a row off the sheet, and number the order again. */
export function removeRow(rows: readonly Finish[], rowId: string): Finish[] {
  if (!rows.some((r) => r.id === rowId)) return [...rows];
  const rest = rows.filter((r) => r.id !== rowId);
  const renumbered = new Map(placed(rest).map((r, i) => [r.id, i + 1]));
  return rest.map((r) => (renumbered.has(r.id) && r.sortOrder !== renumbered.get(r.id) ? { ...r, sortOrder: renumbered.get(r.id)! } : r));
}

/** The competitor's row, other than a suggestion and other than `exceptId`. */
const theirRow = (rows: readonly Finish[], competitorId: string | null, exceptId: string) =>
  competitorId === null ? undefined : rows.find((r) => r.competitorId === competitorId && r.id !== exceptId && !isSuggestionRow(r));

function makeRow(id: string, competitorId: string | null, sailNumber: string | null, at: number, ctx: SheetContext, base?: Finish): Finish {
  const time = ctx.takesTime(competitorId) ? clockTime(at) : undefined;
  const row: Finish = base
    ? { ...base, id, competitorId, tiedWithPrevious: false }
    : makeFinish(ctx.raceId, { id, competitorId, sortOrder: 0, startPresent: competitorId ? true : null });
  if (competitorId) delete row.unknownSailNumber;
  else row.unknownSailNumber = unknownLabel(sailNumber);
  if (time) row.finishTime = time;
  else delete row.finishTime;
  return row;
}

/**
 * Put an accepted finish on the sheet, or bring its row up to date, in
 * place of `replacing` (the suggestion it was accepted from) where given.
 * A competitor who has a row with no place yet (a code, a start check-in)
 * finishes on it, as typing their number does; one with a place already
 * keeps it, and the rows come back unchanged.
 */
export function placeFinish(rows: readonly Finish[], finish: VoiceFinish, ctx: SheetContext, replacing?: string): Finish[] {
  if (finish.removed) return removeRow(rows, finish.id);
  const theirs = theirRow(rows, finish.competitorId, finish.id);
  if (theirs && theirs.sortOrder !== null) return [...rows];
  let out = replacing ? removeRow(rows, replacing) : [...rows];
  // Their suggestion goes: they have a finish now.
  if (finish.competitorId) out = out.filter((r) => !(isSuggestionRow(r) && r.competitorId === finish.competitorId));
  const own = out.find((r) => r.id === finish.id);
  const row = makeRow(finish.id, finish.competitorId, finish.sailNumber, finish.at, ctx, own ?? theirs);
  if (theirs) out = out.filter((r) => r.id !== theirs.id);
  return slot(out, row, finish.at, ctx);
}

/**
 * The sheet with its suggested rows in step with `suggestions`: one row for
 * each, in the order they finished, except for a competitor who already
 * has a place on the sheet. Returns the same array when nothing changes, so
 * keeping it in step costs nothing between changes, and what each
 * suggested row says, to tell a person's change to it later.
 */
export function syncSuggestions(
  rows: readonly Finish[],
  suggestions: readonly Suggestion[],
  ctx: SheetContext,
): { rows: readonly Finish[]; written: Map<string, RowSignature> } {
  const want = suggestions.filter((s) => {
    const theirs = theirRow(rows, s.competitorId, suggestionRowId(s.key));
    return !theirs || theirs.sortOrder === null;
  });
  const wantIds = new Set(want.map((s) => suggestionRowId(s.key)));
  let out: Finish[] = rows.filter((r) => !isSuggestionRow(r) || wantIds.has(r.id));
  const written = new Map<string, RowSignature>();
  for (const s of want) {
    const id = suggestionRowId(s.key);
    const own = out.find((r) => r.id === id);
    const row = makeRow(id, s.competitorId, s.sailNumber, s.at, ctx, own);
    written.set(id, signatureOf(row));
    if (own && sameSignature(signatureOf(own), signatureOf(row)) && own.sortOrder !== null) continue;
    out = slot(out, row, s.at, ctx);
  }
  // Keep the order right as suggestions move: a row whose neighbours no
  // longer agree with when it finished is put back in its place.
  for (const s of want) {
    const id = suggestionRowId(s.key);
    const order = placed(out);
    const i = order.findIndex((r) => r.id === id);
    const before = order[i - 1];
    const after = order[i + 1];
    const timeOf = (r: Finish) => ctx.crossedAt(r.id);
    const wrong = (before && (timeOf(before) ?? -Infinity) > s.at) || (after && (timeOf(after) ?? Infinity) < s.at);
    if (wrong) out = slot(out, out.find((r) => r.id === id)!, s.at, ctx);
  }
  const unchanged =
    out.length === rows.length &&
    out.every((r) => {
      const was = rows.find((x) => x.id === r.id);
      return was !== undefined && was.sortOrder === r.sortOrder && sameSignature(signatureOf(was), signatureOf(r));
    });
  return { rows: unchanged ? rows : out, written };
}

/**
 * What a person has done by hand, on the sheet, to the suggested rows the
 * recording last wrote (`written`): changed one, which accepts it as
 * changed, or deleted one, which says it is not a finish.
 */
export function handChanges(
  rows: readonly Finish[],
  written: ReadonlyMap<string, RowSignature>,
): { changed: { key: string; row: Finish }[]; deleted: string[] } {
  const changed: { key: string; row: Finish }[] = [];
  const deleted: string[] = [];
  for (const [id, signature] of written) {
    const key = suggestionKeyOf(id)!;
    const row = rows.find((r) => r.id === id);
    if (!row) deleted.push(key);
    else if (!sameSignature(signatureOf(row), signature)) changed.push({ key, row });
  }
  return { changed, deleted };
}

/** The rows a submission carries: suggestions nobody accepted stay behind. */
export const submittableRows = (rows: readonly Finish[]) => rows.filter((r) => !isSuggestionRow(r));
