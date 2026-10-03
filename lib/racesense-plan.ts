/**
 * Turn a parsed RaceSense workbook into a plan the scorer can read, race by
 * race, and commit a piece at a time.
 *
 * A RaceSense export is a snapshot of the whole regatta, not a delta: the
 * export taken on the last day of a championship still contains the first
 * day's races. Applying finishes is destructive — it replaces a race's
 * finishes wholesale — and everything RaceSense doesn't capture reaches the
 * scorer as separate notes from the race committee, entered by hand. So an
 * import that wrote every sheet would erase each day's retirements,
 * disqualifications and redress on the next day's upload. What the format
 * can't express at all — penalties, redress, ties, start check-ins — is
 * carried across from the stored race wherever it still attaches (see
 * `carryAcrossImport`), so re-importing a sheet doesn't quietly shed the
 * jury's work; what can't carry shows in the race's change list.
 *
 * The workbook is therefore a proposal. Every race arrives in one of four
 * states — `new`, `unchanged`, `differs`, `unmatched` — and only `new` races
 * with nothing else to say about them come recommended. A race that differs
 * from what's stored shows exactly how and waits to be chosen deliberately.
 *
 * The pleasant consequence of the file carrying the whole regatta: the races
 * already entered come back `unchanged`, which is a free confirmation that
 * the app and the committee's device agree about them.
 *
 * Reading the finishes themselves is `lib/finish-sheet-csv.ts` — the same
 * matching, dedupe and unresolved-sail handling the CSV importer uses, fed
 * rows built from the workbook, so the result commits down the path that
 * already exists. What those rows carry is the elapsed time, not the time of
 * day; see `COLUMN_MAP` for why.
 */

import { carryAcrossImport } from './finish-entry';
import {
  parseFinishSheetCsv,
  sailNumberKeys,
  type Candidate,
  type FinishSheetColumnMap,
  type ParseFinishSheetResult,
} from './finish-sheet-csv';
import { ordinal } from './ordinal';
import { sailNumberInRace } from './race-membership';
import {
  neverCameToTheLine,
  startLineCounts,
  startStatusCode,
  type RaceSenseAnomaly,
  type RaceSenseRace,
  type RaceSenseWorkbook,
  type StartLineCounts,
} from './racesense-workbook';
import type { StoredStage } from './split-fleets';
import { hasTrackData } from './track-data';
import type { Finish, FinishTrackData, RaceSenseLink } from './types';

/** Columns of the rows this module builds for the finish-sheet parser.
 *
 *  The elapsed time, not the time of day. RaceSense's `Total Time` is the
 *  measurement its `Finishing Time` is rendered from, and the rendering has
 *  been seen going wrong for individual boats — an hour out on four boats of
 *  one race while every elapsed figure on the sheet stayed right. So the
 *  timestamp is read (the parser cross-checks it and complains when the two
 *  disagree) but never imported. */
const COLUMN_MAP: FinishSheetColumnMap = {
  0: 'sailNumber',
  1: 'elapsed',
  2: 'resultCode',
};

/**
 * The start, in one line: how many came to the line and how the line went.
 *
 * `null` for a sheet with no Starts block worth reading. A start where nobody
 * was over still says so — "a clean start" is the answer to the question, and
 * a race officer scanning the list for the crowded ones needs the quiet races
 * to look quiet rather than to look unreported.
 */
export function describeStartLine(counts: StartLineCounts): string | null {
  const { starters, ocs, cleared } = counts;
  if (starters === 0) return null;
  const parts = [`${starters} starter${starters === 1 ? '' : 's'}`];
  if (ocs > 0) {
    const share = (ocs / starters) * 100;
    parts.push(`${ocs} OCS (${share < 1 ? '<1' : Math.round(share)}%)`);
  } else {
    parts.push(cleared > 0 ? 'no OCS' : 'a clean start');
  }
  if (cleared > 0) parts.push(`${cleared} cleared`);
  return parts.join(', ');
}

/** A race in the series a sheet might land in. Starts carry the fleet and
 *  stage identity; a series with no fleets has one start naming none. */
export interface SeriesRace {
  id: string;
  name: string | null;
  raceNumber: number;
  starts: {
    fleetIds: string[];
    stage?: StoredStage | null;
    stageRaceNumber?: number | null;
  }[];
  /** The RaceSense races imported into this one before. */
  raceSenseLinks?: RaceSenseLink[];
}

/** How a sheet found its race: chosen by hand in the dialog, remembered from
 *  an earlier import, or counted to by position. */
export type RaceMatchedBy = 'override' | 'link' | 'position';

export type RaceMatchState = 'new' | 'unchanged' | 'differs' | 'unmatched';

/** One boat's row in the differs view: what's stored against what would
 *  replace it. Both sides are already phrased for reading. */
export interface FinishChange {
  sailNumber: string;
  stored: string;
  incoming: string;
}

export interface PlannedRace {
  sheetName: string;
  /** RaceSense's own race number. */
  raceNumber: number;
  race: SeriesRace | null;
  /** `null` when there is no race. */
  matchedBy: RaceMatchedBy | null;
  state: RaceMatchState;
  /** Whether to tick this race by default. Only a `new` race with nothing
   *  flagged against it: anything else is the scorer's call. */
  recommended: boolean;
  /** The finishes that would be written, ready for the CSV import's own
   *  commit path. `null` when there's no race to write them to. */
  result: ParseFinishSheetResult | null;
  /** What the Starts block says about the start: how many boats came to the
   *  line, how many were over it, how many got back. Set for every sheet,
   *  matched or not — it is a reading of the export, not of the series. */
  startLine: StartLineCounts;
  /** How many of those finishes carry track data — what the device recorded
   *  beyond the finishing order. Zero for a sheet with no metrics in it, and
   *  worth saying on every race: a `new` race is committed unseen otherwise,
   *  and only a `differs` race spells its track data out in the change list. */
  trackData: number;
  /** Populated when `state` is `differs`. */
  changes: FinishChange[];
  /** Everything worth saying about this race: the parser's anomalies for its
   *  sheet, plus what the plan itself noticed. */
  notes: RaceSenseAnomaly[];
}

export interface RaceSensePlan {
  regatta: string | null;
  division: string | null;
  races: PlannedRace[];
  /** Anomalies not attributable to one race sheet (the app version, the
   *  Summary cross-check, an unknown sheet). */
  workbookNotes: RaceSenseAnomaly[];
}

export interface RaceSensePlanInput {
  workbook: RaceSenseWorkbook;
  /** The fleet this workbook's division sailed in. `null` for a series with
   *  no fleets, where every race is a candidate and every competitor is. */
  fleetId: string | null;
  /** The series' races, in the order they are numbered. */
  races: SeriesRace[];
  competitors: Candidate[];
  /** Existing finishes across the series; filtered per race. */
  finishes: Finish[];
  /** Shift the match by position: RaceSense's race `n` becomes the
   *  `n + offset`-th race this fleet sailed. An abandonment desynchronises the
   *  two numberings and the workbook gives no way to see it, so this is the
   *  scorer's to set — once: a race matched by a remembered link isn't
   *  shifted, and the races after it count on from it. */
  offset?: number;
  /** sheetName → raceId, overriding the match for one sheet. */
  overrides?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Building the rows for one race
// ---------------------------------------------------------------------------

interface BuiltRows {
  rows: string[][];
  notes: RaceSenseAnomaly[];
}

/**
 * Whether a note is reason enough not to tick a race by default.
 *
 * Every warning is, bar one. `defaulted-code` fires on any race with a
 * non-finisher in it, which is most of them, and what it asks for is done
 * after the import rather than before it: the codes it lists are written to
 * the finish sheet, where the scorer corrects them against the committee's
 * record. Un-ticking the race would only stop the sheet reaching the place
 * the correction is made.
 */
function blocksRecommendation(note: RaceSenseAnomaly): boolean {
  return note.severity === 'warning' && note.kind !== 'defaulted-code';
}

/**
 * Turn one race sheet into finish-sheet rows: finishers in crossing order,
 * then the coded tail.
 *
 * The one substitution that matters is the OCS. An uncleared OCS boat appears
 * in the Finishes tail as a `DNF`, so taking that block at face value would
 * turn a real start-line penalty into a did-not-finish. Her Status is the
 * only record of it, and it becomes the code the race's preparatory signal
 * calls for.
 */
function buildRows(race: RaceSenseRace): BuiltRows {
  const notes: RaceSenseAnomaly[] = [];
  const note = (
    severity: 'info' | 'warning',
    kind: string,
    message: string,
    where?: string,
  ) => notes.push({ severity, kind, sheet: race.sheetName, message, ...(where ? { where } : {}) });

  /** sailNumber → the code her start status calls for, if any. */
  const statusCodes = new Map<string, string>();
  for (const starter of race.starters) {
    const code = startStatusCode(starter.meaning, race.preparatorySignal);
    if (code) statusCodes.set(starter.sailNumber, code);
    else if (starter.meaning === 'ocs') {
      note('warning', 'uncoded-ocs',
        `${starter.sailNumber} was OCS, but the preparatory signal doesn’t say which code that is here — set it by hand after importing.`,
        `starter ${starter.sailNumber}`);
    }
  }

  const neverAppeared = new Set(
    race.starters.filter(neverCameToTheLine).map((s) => s.sailNumber),
  );

  /**
   * The code for a boat with no finishing place. RaceSense writes `DNF` for
   * every one of them — retired, never started, never left the beach — so her
   * Starts row is the only evidence of which it was. A device that never
   * checked in and never registered a distance to the line is the one case
   * that says she wasn't there, and a boat that did not come to the starting
   * area is DNC, not DNF (RRS A5.1). Everything else stays DNF.
   *
   * Read against the organising authority's results for the 2026 ILCA 7
   * Worlds: every boat scored DNC over the seven qualifying races was exactly
   * a boat whose device never checked in. It is still a reading of the
   * evidence and not a record of what happened, which is what the note below
   * says; a DNF that was really a retirement can't be told apart at all.
   */
  const codeForNonFinisher = (sailNumber: string): string =>
    neverAppeared.has(sailNumber) ? 'DNC' : 'DNF';

  const rows: string[][] = [];
  const placed = new Set<string>();

  if (race.finishes === null) {
    // RaceSense omits the block when nobody finished. Its own Summary reads
    // DNF for every boat, so that is what this writes — but a race nobody
    // finished is as likely to have been abandoned, which is a decision no
    // import should make on the committee's behalf.
    note('warning', 'nobody-finished',
      `Nobody finished this race, so every starter is being read as DNF${
        neverAppeared.size > 0 ? ', bar those whose device never checked in — they are read as DNC' : ''
      }. If the race was abandoned instead, don’t import it — abandon it in the app.`);
    for (const starter of race.starters) {
      const status = statusCodes.get(starter.sailNumber);
      rows.push([starter.sailNumber, '', status ?? codeForNonFinisher(starter.sailNumber)]);
      placed.add(starter.sailNumber);
    }
    return { rows, notes };
  }

  /** Every boat whose code this import chose rather than read, as it reads on
   *  her row. The note that lists them is the scorer's cue to check them. */
  const chosen: string[] = [];

  for (const finish of race.finishes) {
    placed.add(finish.sailNumber);
    const status = statusCodes.get(finish.sailNumber);
    if (finish.position !== null) {
      if (status) {
        // She crossed the line, but she was over it at the start and never
        // cleared: the code replaces the finish.
        rows.push([finish.sailNumber, '', status]);
        note('info', 'ocs-over-finish',
          `${finish.sailNumber} finished but was OCS, so she is scored ${status} rather than on her elapsed time.`,
          `finish row for ${finish.sailNumber}`);
      } else {
        if (finish.totalTimeSecs === null) {
          note('warning', 'no-elapsed',
            `${finish.sailNumber} finished but the sheet records no Total Time for her, so she is imported with a place and no time. A fleet scored on handicap needs one entered by hand.`,
            `finish row for ${finish.sailNumber}`);
        }
        rows.push([finish.sailNumber, finish.totalTimeSecs?.toString() ?? '', '']);
      }
    } else {
      // Her start-line penalty, or a code the sheet states for itself, stands
      // as written. `DNF` is the one RaceSense writes for every non-finisher
      // alike, so it is the one that has to be read rather than taken.
      const stated = status ?? (finish.code === 'DNF' ? null : finish.code);
      const code = stated ?? codeForNonFinisher(finish.sailNumber);
      if (stated === null) chosen.push(`${finish.sailNumber} ${code}`);
      rows.push([finish.sailNumber, '', code]);
    }
  }

  if (chosen.length > 0) {
    const one = chosen.length === 1;
    notes.push({
      severity: 'warning',
      kind: 'defaulted-code',
      sheet: race.sheetName,
      value: chosen.join(', '),
      message:
        'RaceSense writes DNF for every boat that didn’t finish, so it can’t tell a '
        + `retirement from a boat that never started. ${one ? 'This code is' : 'These codes are'} `
        + `this import’s reading of the Starts block, not the sheet’s: ${chosen.join(', ')}. `
        + `Confirm ${one ? 'it' : 'each'} against the committee’s record and correct `
        + `${one ? 'it' : 'them'} on the finish sheet.`,
    });
  }

  // A starter RaceSense never mentions again. Leaving her out scores her DNC
  // by omission, which is probably right and is certainly not ours to decide
  // silently.
  for (const starter of race.starters) {
    if (placed.has(starter.sailNumber)) continue;
    const status = statusCodes.get(starter.sailNumber);
    if (status) {
      rows.push([starter.sailNumber, '', status]);
      continue;
    }
    note('warning', 'started-but-unlisted',
      `${starter.sailNumber} started but appears nowhere in the Finishes block, so she is being left off the sheet — she will score DNC.`,
      `starter ${starter.sailNumber}`);
  }

  return { rows, notes };
}

// ---------------------------------------------------------------------------
// Track data
// ---------------------------------------------------------------------------

/**
 * How each boat sailed, keyed by upper-cased sail number: DTL from the Starts
 * block, distance and max speed from the Finishes block. Her elapsed time is
 * not here — it is a recording of the finish, and it reaches the row through
 * the finish sheet with the rest of the result.
 */
function trackDataFor(source: RaceSenseRace): Map<string, FinishTrackData> {
  const bySail = new Map<string, FinishTrackData>();
  const put = (sail: string, patch: FinishTrackData) => {
    const entries = Object.entries(patch).filter(([, v]) => v != null);
    if (entries.length === 0) return;
    const key = sail.toUpperCase();
    bySail.set(key, { ...bySail.get(key), ...Object.fromEntries(entries) });
  };
  for (const s of source.starters) {
    if (s.dtlAtStartM !== null) put(s.sailNumber, { dtlAtStartM: s.dtlAtStartM });
  }
  for (const f of source.finishes ?? []) {
    put(f.sailNumber, {
      ...(f.distanceKm !== null ? { distanceKm: f.distanceKm } : {}),
      ...(f.maxSpeedKts !== null ? { maxSpeedKts: f.maxSpeedKts } : {}),
    });
  }
  return bySail;
}

/** Hang each boat's track data on her parsed finish row. The rows come out of
 *  the finish-sheet parser keyed by competitor, so the sail number is read
 *  back through the same keys the parser matched on. */
function attachTrackData(
  finishes: readonly Omit<Finish, 'id' | 'raceId'>[],
  bySail: Map<string, FinishTrackData>,
  eligible: Candidate[],
): Omit<Finish, 'id' | 'raceId'>[] {
  if (bySail.size === 0) return [...finishes];
  const byId = new Map(eligible.map((c) => [c.id, c]));
  return finishes.map((f) => {
    const candidate = f.competitorId ? byId.get(f.competitorId) : undefined;
    const keys = candidate
      ? sailNumberKeys(candidate)
      : f.unknownSailNumber ? [f.unknownSailNumber] : [];
    for (const key of keys) {
      const trackData = bySail.get(key.toUpperCase());
      if (trackData) return { ...f, trackData };
    }
    return f;
  });
}

// ---------------------------------------------------------------------------
// Matching a sheet to a race
// ---------------------------------------------------------------------------

/** The races a workbook's division could have sailed, in order. */
function candidateRaces(races: SeriesRace[], fleetId: string | null): SeriesRace[] {
  const ordered = [...races].sort((a, b) => a.raceNumber - b.raceNumber);
  if (fleetId === null) return ordered;
  return ordered.filter((r) => r.starts.some((s) => s.fleetIds.includes(fleetId)));
}

/** A regatta's division, as a workbook names it: the part of a RaceSense race
 *  that isn't its number. */
export interface RaceSenseSource {
  regattaId: string | null;
  regatta: string | null;
  division: string | null;
}

export function raceSenseSourceOf(workbook: RaceSenseWorkbook): RaceSenseSource {
  return { regattaId: workbook.regattaId, regatta: workbook.regatta, division: workbook.division };
}

/**
 * Whether a link names this regatta and division. The regatta goes by its id
 * when both sides carry one; the club-series export predates the `Regatta ID`
 * row, and only there does the name have to stand in for it.
 */
function sameSource(link: RaceSenseSource, source: RaceSenseSource): boolean {
  const regatta = link.regattaId !== null && source.regattaId !== null
    ? link.regattaId === source.regattaId
    : link.regatta !== null && link.regatta === source.regatta;
  return regatta && link.division === source.division;
}

/** The links on a race that this fleet's import from this source wrote. */
function linksFrom(race: SeriesRace, source: RaceSenseSource, fleetId: string | null): RaceSenseLink[] {
  return (race.raceSenseLinks ?? []).filter((l) => l.fleetId === fleetId && sameSource(l, source));
}

/** Whether another regatta or division has already put this fleet's results
 *  in the race — the Elimination Series' race, seen from the Finals. */
function claimedByAnother(race: SeriesRace, source: RaceSenseSource, fleetId: string | null): boolean {
  return (race.raceSenseLinks ?? []).some((l) => l.fleetId === fleetId && !sameSource(l, source));
}

/**
 * The fleet a regatta's division was imported as last time, or `undefined`
 * when no race remembers it. A fleet named by the most links wins, which only
 * matters if a scorer has moved a division from one fleet to another.
 */
export function rememberedFleet(
  races: SeriesRace[],
  source: RaceSenseSource,
): string | null | undefined {
  const counts = new Map<string | null, number>();
  for (const race of races) {
    for (const link of race.raceSenseLinks ?? []) {
      if (sameSource(link, source)) counts.set(link.fleetId, (counts.get(link.fleetId) ?? 0) + 1);
    }
  }
  let best: string | null | undefined;
  let most = 0;
  for (const [fleetId, n] of counts) {
    if (n > most) { best = fleetId; most = n; }
  }
  return best;
}

/**
 * Where each sheet lands, before anything is read from it.
 *
 * In order: the race the scorer pointed it at; the race an earlier import of
 * this RaceSense race went to; the race it counts to. Counting is over the
 * fleet's races less those another regatta has already claimed for the fleet,
 * and it counts on from the last remembered race before the sheet, so a resail
 * the scorer allowed for once stays allowed for. A count that lands on a race
 * already holding a different race of this regatta finds nothing: matching it
 * would put two RaceSense races in one.
 */
function matchSheets(
  sheets: readonly RaceSenseRace[],
  races: SeriesRace[],
  source: RaceSenseSource,
  fleetId: string | null,
  offset: number,
  overrides: Record<string, string>,
): Map<string, { race: SeriesRace | null; matchedBy: RaceMatchedBy | null; heldBy?: number }> {
  const byId = new Map(races.map((r) => [r.id, r]));
  const counted = candidateRaces(races, fleetId).filter((r) => !claimedByAnother(r, source, fleetId));
  /** RaceSense race number → the race it was imported into. */
  const linked = new Map<number, SeriesRace>();
  for (const race of races) {
    for (const link of linksFrom(race, source, fleetId)) linked.set(link.raceNumber, race);
  }

  const out = new Map<string, { race: SeriesRace | null; matchedBy: RaceMatchedBy | null; heldBy?: number }>();
  for (const sheet of sheets) {
    const override = overrides[sheet.sheetName];
    if (override) {
      const race = byId.get(override) ?? null;
      out.set(sheet.sheetName, { race, matchedBy: race ? 'override' : null });
      continue;
    }
    const remembered = linked.get(sheet.number);
    if (remembered) {
      out.set(sheet.sheetName, { race: remembered, matchedBy: 'link' });
      continue;
    }
    // Count on from the nearest remembered race before this one.
    let anchor: { number: number; index: number } | null = null;
    for (const [number, race] of linked) {
      const index = counted.indexOf(race);
      if (number < sheet.number && index >= 0 && (anchor === null || number > anchor.number)) {
        anchor = { number, index };
      }
    }
    const index = anchor
      ? anchor.index + (sheet.number - anchor.number) + offset
      : sheet.number - 1 + offset;
    const race = counted[index] ?? null;
    const held = race ? linksFrom(race, source, fleetId).find((l) => l.raceNumber !== sheet.number) : undefined;
    out.set(sheet.sheetName, held
      ? { race: null, matchedBy: null, heldBy: held.raceNumber }
      : { race, matchedBy: race ? 'position' : null });
  }
  return out;
}

/**
 * The links to write once a plan's races are imported, as the full new list
 * for each race whose list changes.
 *
 * `linked` is every planned race the scorer confirmed: the ones imported, and
 * the ones that read back `unchanged`, which confirm the match as surely as an
 * import would. Each RaceSense race is recorded once per fleet, so a link it
 * held on another race goes — the scorer pointed it somewhere new — and so
 * does any link this race held for a different race of the same regatta.
 */
export function raceSenseLinksAfterImport(args: {
  races: SeriesRace[];
  linked: readonly PlannedRace[];
  source: RaceSenseSource;
  fleetId: string | null;
}): Map<string, RaceSenseLink[]> {
  const { source, fleetId } = args;
  const lists = new Map(args.races.map((r) => [r.id, [...(r.raceSenseLinks ?? [])]]));
  const changed = new Set<string>();
  const ours = (l: RaceSenseLink) => l.fleetId === fleetId && sameSource(l, source);

  for (const planned of args.linked) {
    if (!planned.race || !lists.has(planned.race.id)) continue;
    const link: RaceSenseLink = { ...source, raceNumber: planned.raceNumber, fleetId };
    for (const [raceId, list] of lists) {
      const kept = list.filter((l) =>
        !(ours(l) && (l.raceNumber === planned.raceNumber || raceId === planned.race!.id)));
      if (kept.length !== list.length) {
        lists.set(raceId, kept);
        changed.add(raceId);
      }
    }
    lists.get(planned.race.id)!.push(link);
    changed.add(planned.race.id);
  }

  // Compared field by field rather than as JSON: a link read back from
  // storage needn't keep its keys in the order this one was built in.
  const spell = (links: readonly RaceSenseLink[]) =>
    links.map((l) => [l.regattaId, l.regatta, l.division, l.raceNumber, l.fleetId].join('\u0000')).join('\n');
  const before = new Map(args.races.map((r) => [r.id, spell(r.raceSenseLinks ?? [])]));
  return new Map(
    [...changed]
      .map((id) => [id, lists.get(id)!] as const)
      .filter(([id, list]) => spell(list) !== before.get(id)),
  );
}

/** The competitors eligible to appear on a race's sheet, each under the
 *  sail number she carries in it: where boats are drawn per fleet, that is
 *  the boat — which is what the device fixed to it reports. */
function candidatesFor(
  race: SeriesRace,
  competitors: Candidate[],
  fleetId: string | null,
): Candidate[] {
  const fleetIds = new Set(race.starts.flatMap((s) => s.fleetIds));
  if (fleetIds.size === 0) return competitors;
  const eligible =
    fleetId !== null
      ? competitors.filter((c) => c.fleetIds.includes(fleetId))
      : competitors.filter((c) => c.fleetIds.some((id) => fleetIds.has(id)));
  return eligible.map((c) => {
    const sailNumber = sailNumberInRace(c, fleetIds);
    return sailNumber === c.sailNumber ? c : { ...c, sailNumber };
  });
}

// ---------------------------------------------------------------------------
// Diffing against what's stored
// ---------------------------------------------------------------------------

type Key = string;

/** Identify a finish across the stored and incoming sides. An unresolved
 *  crossing has no competitor, so it goes by the number written down. */
function keyOf(f: { competitorId: string | null; unknownSailNumber?: string | null }): Key {
  return f.competitorId ?? `?${f.unknownSailNumber ?? ''}`;
}

/** The slice of a finish the preview reads. The signature is built from the
 *  very strings `describe` renders, so any difference that can make a race
 *  `differs` is by construction one the change list can show. */
interface DiffFinish {
  sortOrder: number | null;
  finishTime: string | null;
  resultCode: string | null;
  tiedWithPrevious: boolean;
  penaltyCode: string | null;
  penaltyOverride: number | null;
  redressMethod: string | null;
  redressPoints: number | null;
  elapsedSecs: number | null;
  trackData: FinishTrackData | null;
}

function penaltyText(f: DiffFinish): string {
  if (f.penaltyCode === 'SCP' && f.penaltyOverride !== null) return `SCP ${f.penaltyOverride}%`;
  if (f.penaltyCode === 'DPI' && f.penaltyOverride !== null) return `DPI +${f.penaltyOverride}`;
  return f.penaltyCode ?? '';
}

function redressText(f: DiffFinish): string {
  const detail =
    f.redressMethod === 'stated' && f.redressPoints !== null ? `${f.redressPoints} pts`
      : f.redressMethod === 'all_races' ? 'average of other races'
      : f.redressMethod === 'all_races_excl_dnc' ? 'average excl. DNC'
      : f.redressMethod === 'races_before' ? 'average of earlier races'
      : '';
  return detail ? `RDG (${detail})` : 'RDG';
}

/** What the device captured, phrased for the change list. */
function capturedText(f: DiffFinish): string {
  const t = f.trackData;
  return [
    ...(t?.distanceKm != null ? [`${t.distanceKm} km sailed`] : []),
    ...(f.elapsedSecs != null ? [`${f.elapsedSecs}s elapsed`] : []),
    ...(t?.maxSpeedKts != null ? [`max ${t.maxSpeedKts} kn`] : []),
    ...(t?.dtlAtStartM != null ? [`DTL ${t.dtlAtStartM} m`] : []),
  ].join(', ');
}

function describe(f: DiffFinish | undefined, place: number | null): string {
  if (!f) return '—';
  // The capture rides along so that recording it for an already-imported
  // race reads `differs` (with the addition on show) rather than being
  // unwritable: `unchanged` races are never re-applied.
  const track = capturedText(f);
  const withTrack = (text: string) => (track ? `${text}, ${track}` : text);
  if (f.sortOrder === null && f.resultCode) {
    return withTrack(f.resultCode === 'RDG' ? redressText(f) : f.resultCode);
  }
  // A row with neither a place nor a code records a start check-in only.
  if (f.sortOrder === null) return withTrack('checked in at the start');
  const at = f.finishTime ? ` at ${f.finishTime}` : '';
  const base = place === null ? `finished${at}` : `${ordinal(place)}${at}`;
  return withTrack([
    base,
    ...(f.tiedWithPrevious ? ['tied'] : []),
    ...(f.penaltyCode ? [penaltyText(f)] : []),
    ...(f.resultCode === 'RDG' ? [redressText(f)] : []),
  ].join(', '));
}

interface Sided {
  byKey: Map<Key, DiffFinish>;
  /** Key → 1-based finishing place, for phrasing. */
  place: Map<Key, number>;
  /** The full ordered signature: finishers in order, then codes sorted. */
  signature: string;
}

function side(finishes: readonly {
  competitorId: string | null;
  unknownSailNumber?: string | null;
  sortOrder: number | null;
  finishTime?: string | null;
  resultCode: string | null;
  tiedWithPrevious: boolean;
  penaltyCode: string | null;
  penaltyOverride: number | null;
  redressMethod: string | null;
  redressPoints: number | null;
  elapsedSecs?: number | null;
  trackData?: FinishTrackData | null;
}[]): Sided {
  const byKey = new Map<Key, DiffFinish>();
  const place = new Map<Key, number>();
  for (const f of finishes) {
    byKey.set(keyOf(f), {
      sortOrder: f.sortOrder,
      finishTime: f.finishTime ?? null,
      resultCode: f.resultCode,
      tiedWithPrevious: f.tiedWithPrevious,
      penaltyCode: f.penaltyCode,
      penaltyOverride: f.penaltyOverride,
      redressMethod: f.redressMethod,
      redressPoints: f.redressPoints,
      elapsedSecs: f.elapsedSecs ?? null,
      trackData: f.trackData ?? null,
    });
  }
  const finishers = finishes
    .filter((f) => f.sortOrder !== null)
    .sort((a, b) => a.sortOrder! - b.sortOrder!);
  finishers.forEach((f, i) => place.set(keyOf(f), i + 1));

  const rendered = (f: { competitorId: string | null; unknownSailNumber?: string | null }) => {
    const key = keyOf(f);
    return `${key}:${describe(byKey.get(key), place.get(key) ?? null)}`;
  };
  const signature = [
    ...finishers.map(rendered),
    '|',
    ...finishes.filter((f) => f.sortOrder === null).map(rendered).sort(),
  ].join(',');
  return { byKey, place, signature };
}

/** Every boat whose result would change, phrased for the preview. */
function changesBetween(
  stored: Sided,
  incoming: Sided,
  label: (key: Key) => string,
): FinishChange[] {
  const changes: FinishChange[] = [];
  for (const key of new Set([...stored.byKey.keys(), ...incoming.byKey.keys()])) {
    const a = describe(stored.byKey.get(key), stored.place.get(key) ?? null);
    const b = describe(incoming.byKey.get(key), incoming.place.get(key) ?? null);
    if (a !== b) changes.push({ sailNumber: label(key), stored: a, incoming: b });
  }
  return changes.sort((a, b) => a.sailNumber.localeCompare(b.sailNumber, undefined, { numeric: true }));
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/** Anomaly kinds the parser raises about the workbook rather than one race.
 *
 *  `finish-time-drift` is here because it is a fact about the file, not a
 *  decision about a race: the value it flags is one this import doesn't read,
 *  so hanging it on a race would put a note the scorer can do nothing with
 *  against a race there is nothing wrong with. */
const WORKBOOK_KINDS = new Set([
  'app-version', 'summary-mismatch', 'unknown-sheet', 'duplicate-race', 'finish-time-drift',
  'player-read', 'race-skipped',
]);

export function planRaceSenseImport(input: RaceSensePlanInput): RaceSensePlan {
  const { workbook, fleetId, competitors, finishes, offset = 0, overrides = {} } = input;

  const matches = matchSheets(
    workbook.races, input.races, raceSenseSourceOf(workbook), fleetId, offset, overrides,
  );
  const finishesByRace = new Map<string, Finish[]>();
  for (const f of finishes) {
    finishesByRace.set(f.raceId, [...(finishesByRace.get(f.raceId) ?? []), f]);
  }
  const sailById = new Map(competitors.map((c) => [c.id, c.sailNumber]));
  const label = (key: Key) => (key.startsWith('?') ? key.slice(1) : sailById.get(key) ?? key);

  const anomaliesBySheet = new Map<string, RaceSenseAnomaly[]>();
  const workbookNotes: RaceSenseAnomaly[] = [];
  for (const a of workbook.anomalies) {
    if (WORKBOOK_KINDS.has(a.kind)) workbookNotes.push(a);
    else anomaliesBySheet.set(a.sheet, [...(anomaliesBySheet.get(a.sheet) ?? []), a]);
  }

  const races: PlannedRace[] = workbook.races.map((source) => {
    const notes = [...(anomaliesBySheet.get(source.sheetName) ?? [])];
    const { race, matchedBy, heldBy } = matches.get(source.sheetName)!;

    if (!race) {
      notes.push({
        severity: 'warning',
        kind: 'no-race',
        sheet: source.sheetName,
        message: overrides[source.sheetName]
          ? 'The race this sheet was pointed at is no longer in the series.'
          : heldBy !== undefined
            ? `The race this sheet counts to already holds RaceSense race ${heldBy}. Point the sheet at a race by hand.`
            : 'This series has no race for that sheet yet. Create it first, or point the sheet at an existing race.',
      });
      return {
        sheetName: source.sheetName,
        raceNumber: source.number,
        race: null,
        matchedBy: null,
        state: 'unmatched',
        recommended: false,
        result: null,
        startLine: startLineCounts(source),
        trackData: 0,
        changes: [],
        notes,
      };
    }

    const built = buildRows(source);
    notes.push(...built.notes);

    const eligible = candidatesFor(race, competitors, fleetId);
    const parsed = parseFinishSheetCsv({
      rows: built.rows,
      columnMap: COLUMN_MAP,
      candidates: eligible,
    });
    // What the workbook can't express — penalties, redress, ties, start
    // check-ins — is carried across from the stored race before diffing: a
    // race whose only distinguishing state carries cleanly still reads back
    // `unchanged`, and one whose state can't carry shows that in the change
    // list rather than shedding it silently on commit.
    const storedFinishes = finishesByRace.get(race.id) ?? [];
    const result: ParseFinishSheetResult = {
      ...parsed,
      finishes: attachTrackData(
        carryAcrossImport(storedFinishes, parsed.finishes),
        trackDataFor(source),
        eligible,
      ),
    };

    // A boat entitled to be on this sheet whom RaceSense never saw. When the
    // race carries a fleet this workbook doesn't cover, that's every boat in
    // it — and importing one fleet's export over the race would wipe theirs,
    // which is worth saying outright rather than listing 40 sail numbers.
    const onSheet = new Set(source.starters.map((s) => s.sailNumber.toUpperCase()));
    const missing = eligible.filter(
      (c) => !sailNumberKeys(c).some((k) => onSheet.has(k.toUpperCase())),
    );
    if (missing.length > 0) {
      const raceFleets = new Set(race.starts.flatMap((s) => s.fleetIds));
      const otherFleets = fleetId === null
        ? raceFleets.size > 1
        : [...raceFleets].some((id) => id !== fleetId);
      const one = missing.length === 1;
      const boats = `${missing.length} boat${one ? '' : 's'}`;
      const are = one ? 'is' : 'are';
      notes.push({
        severity: 'warning',
        kind: 'roster',
        sheet: source.sheetName,
        value: missing.map((c) => c.sailNumber).join(', '),
        message: otherFleets
          ? `${boats} in this race ${are} not on this sheet, because the race holds more than one fleet's start. Importing here replaces every fleet's finishes, not just this one's.`
          : `${boats} entered in this race ${are} not on this sheet: ${missing.map((c) => c.sailNumber).join(', ')}.`,
      });
    }

    const stored = side(storedFinishes);
    const incoming = side(result.finishes);
    const state: RaceMatchState = stored.byKey.size === 0
      ? 'new'
      : stored.signature === incoming.signature ? 'unchanged' : 'differs';

    return {
      sheetName: source.sheetName,
      raceNumber: source.number,
      race,
      matchedBy,
      state,
      recommended: state === 'new'
        && notes.every((n) => !blocksRecommendation(n))
        && result.errors.length === 0,
      result,
      startLine: startLineCounts(source),
      trackData: result.finishes.filter((f) => hasTrackData(f.trackData)).length,
      changes: state === 'differs' ? changesBetween(stored, incoming, label) : [],
      notes,
    };
  });

  return {
    regatta: workbook.regatta,
    division: workbook.division,
    races,
    workbookNotes,
  };
}
