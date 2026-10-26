/**
 * Finish sheet submissions (#671), read the way the scorer reviews them.
 * Pure and client-safe: the server reads an upload with these to tell the
 * recorder what matched, and the review dialog reads the same submission
 * with the same functions to show the scorer what applying it would do.
 *
 * A submission is read as an imported finish sheet is (lib/finish-sheet-
 * csv.ts): the same matching tiers for a sail number, the same rules for a
 * code and a time, the same rows skipped. A row the recorder already tied
 * to an entry by `competitorId` skips the sail number matching.
 */

import {
  parseFinishSheetCsv,
  type Candidate,
  type FinishSheetColumnMap,
  type ParseFinishSheetResult,
} from './finish-sheet-csv';
import type { ImportedFinish } from './finish-entry';
import { raceFleetIds, withRaceSailNumbers } from './race-membership';
import { formatElapsedInput } from './time-parse';
import type { Competitor, Finish, RaceStart, SubmittedFinish } from './types';

const COLUMNS: FinishSheetColumnMap = { 0: 'sailNumber', 1: 'finishTime', 2: 'elapsed', 3: 'resultCode' };

/**
 * What a race's sheet matches sail numbers against: the boats in the race's
 * fleets (every boat, while the race has no starts), each under the number
 * it sails in this race and with those fleets' names, so a sheet's class
 * column can tell a shared sail number apart.
 */
export function raceCandidates(
  competitors: readonly Competitor[],
  starts: readonly RaceStart[],
  fleetName: (fleetId: string) => string | undefined,
): (Competitor & Candidate)[] {
  const fleetIds = raceFleetIds(starts as RaceStart[]);
  const inRace = (id: string) => fleetIds.size === 0 || fleetIds.has(id);
  return withRaceSailNumbers(competitors as Competitor[], starts)
    .filter((c) => fleetIds.size === 0 || c.fleetIds.some(inRace))
    .map((c) => ({
      ...c,
      fleetNames: c.fleetIds
        .filter(inRace)
        .map(fleetName)
        .filter((name): name is string => Boolean(name)),
    }));
}

/**
 * A submission's finishes, read as an imported sheet. `candidates` are the
 * boats in the race's fleets, as for an import; `sailNumberOf` names a boat
 * by id for the messages, from the whole entry list, since a boat outside
 * the race's fleets is just what a message has to name. Row numbers in the
 * messages count the submission's rows from 1.
 */
export function readSubmission(
  finishes: readonly SubmittedFinish[],
  candidates: Candidate[],
  sailNumberOf: (competitorId: string) => string | undefined,
): ParseFinishSheetResult {
  return parseFinishSheetCsv({
    rows: finishes.map((f) => [
      f.sailNumber ?? (f.competitorId ? sailNumberOf(f.competitorId) : undefined) ?? '',
      f.finishTime ?? '',
      f.elapsedSecs != null ? String(f.elapsedSecs) : '',
      f.resultCode ?? '',
    ]),
    columnMap: COLUMNS,
    candidates,
    identified: finishes.map((f) => f.competitorId),
    firstRowNumber: 1,
  });
}

/** What a recorder hears back about an upload. */
export interface SubmissionMatch {
  /** Rows that name a boat entered in the race. */
  matched: number;
  /** Sail numbers that match no entry: the scorer resolves them. */
  unknownSailNumbers: string[];
  /** Rows the scorer's review will leave out, and why. */
  skipped: { id: string; reason: string }[];
}

export function matchOf(finishes: readonly SubmittedFinish[], read: ParseFinishSheetResult): SubmissionMatch {
  return {
    matched: read.finishes.filter((f) => f.competitorId !== null).length,
    unknownSailNumbers: read.finishes
      .filter((f) => f.competitorId === null)
      .map((f) => f.unknownSailNumber ?? ''),
    skipped: read.errors.map((e) => ({ id: finishes[e.rowIndex - 1]?.id ?? '', reason: e.reason })),
  };
}

/** One boat's line on a sheet, as the review compares it. */
export interface SheetLine {
  /** Place among the finishers; null for a boat that didn't finish. */
  place: number | null;
  /** The time recorded, of day or elapsed; null where none was. */
  time: string | null;
  code: string | null;
}

export interface SheetDiffRow {
  competitorId: string | null;
  /** The sail number written down, for a boat that matched no entry. */
  unknownSailNumber: string | null;
  before: SheetLine | null;
  after: SheetLine | null;
  changed: boolean;
}

type SheetRow = Pick<Finish, 'competitorId' | 'unknownSailNumber' | 'sortOrder' | 'finishTime' | 'elapsedSecs' | 'resultCode'>;

function keyOf(f: SheetRow): string {
  return f.competitorId ?? `?${(f.unknownSailNumber ?? '').toUpperCase()}`;
}

/** Each finisher's place by row order, as the sheet reads: sortOrder is the
 *  crossing order, and a stored sheet may have gaps in it. */
function places(rows: readonly SheetRow[]): Map<SheetRow, number> {
  const out = new Map<SheetRow, number>();
  rows
    .filter((f) => f.sortOrder !== null)
    .sort((a, b) => a.sortOrder! - b.sortOrder!)
    .forEach((f, i) => out.set(f, i + 1));
  return out;
}

function lineOf(f: SheetRow, place: number | undefined): SheetLine {
  const time = f.finishTime ?? (f.elapsedSecs != null ? formatElapsedInput(f.elapsedSecs) : null);
  return { place: f.sortOrder !== null ? (place ?? null) : null, time, code: f.resultCode ?? null };
}

const sameLine = (a: SheetLine, b: SheetLine) => a.place === b.place && a.time === b.time && a.code === b.code;

/**
 * The race's current finish sheet against what a submission would make it:
 * a row per boat on either, in the submission's order (finishers, then the
 * boats it codes), then the boats only the current sheet has.
 */
export function diffSheets(stored: readonly SheetRow[], incoming: readonly ImportedFinish[]): SheetDiffRow[] {
  // A row with neither a place nor a code is a start check-in, not a line
  // of the finish sheet.
  const current = stored.filter((f) => f.sortOrder !== null || f.resultCode !== null);
  const beforePlaces = places(current);
  const afterPlaces = places(incoming);
  const before = new Map(current.map((f) => [keyOf(f), lineOf(f, beforePlaces.get(f))]));
  const ordered = [
    ...incoming.filter((f) => f.sortOrder !== null).sort((a, b) => a.sortOrder! - b.sortOrder!),
    ...incoming.filter((f) => f.sortOrder === null),
  ];
  const seen = new Set<string>();
  const rows: SheetDiffRow[] = ordered.map((f) => {
    const key = keyOf(f);
    seen.add(key);
    const after = lineOf(f, afterPlaces.get(f));
    const was = before.get(key) ?? null;
    return {
      competitorId: f.competitorId,
      unknownSailNumber: f.competitorId ? null : (f.unknownSailNumber ?? null),
      before: was,
      after,
      changed: !was || !sameLine(was, after),
    };
  });
  for (const f of current) {
    if (seen.has(keyOf(f))) continue;
    rows.push({
      competitorId: f.competitorId,
      unknownSailNumber: f.competitorId ? null : (f.unknownSailNumber ?? null),
      before: before.get(keyOf(f))!,
      after: null,
      changed: true,
    });
  }
  return rows;
}
