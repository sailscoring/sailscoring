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
import {
  startStatusCode,
  type RaceSenseAnomaly,
  type RaceSenseRace,
  type RaceSenseWorkbook,
} from './racesense-workbook';
import type { SeriesStage } from './split-fleets';
import { hasTrackData } from './track-data';
import type { Finish, FinishTrackData } from './types';

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

/** A race in the series a sheet might land in. Starts carry the fleet and
 *  stage identity; a series with no fleets has one start naming none. */
export interface SeriesRace {
  id: string;
  name: string | null;
  raceNumber: number;
  starts: {
    fleetIds: string[];
    stage?: SeriesStage | null;
    stageRaceNumber?: number | null;
  }[];
}

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
  state: RaceMatchState;
  /** Whether to tick this race by default. Only a `new` race with nothing
   *  flagged against it: anything else is the scorer's call. */
  recommended: boolean;
  /** The finishes that would be written, ready for the CSV import's own
   *  commit path. `null` when there's no race to write them to. */
  result: ParseFinishSheetResult | null;
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
  /** Shift the match: RaceSense's race `n` becomes the `n + offset`-th race
   *  this fleet sailed. An abandonment desynchronises the two numberings and
   *  the workbook gives no way to see it, so this is the scorer's to set. */
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

  const rows: string[][] = [];
  const placed = new Set<string>();

  if (race.finishes === null) {
    // RaceSense omits the block when nobody finished. Its own Summary reads
    // DNF for every boat, so that is what this writes — but a race nobody
    // finished is as likely to have been abandoned, which is a decision no
    // import should make on the committee's behalf.
    note('warning', 'nobody-finished',
      'Nobody finished this race, so every starter is being read as DNF. If the race was abandoned instead, don’t import it — abandon it in the app.');
    for (const starter of race.starters) {
      rows.push([starter.sailNumber, '', statusCodes.get(starter.sailNumber) ?? 'DNF']);
      placed.add(starter.sailNumber);
    }
    return { rows, notes };
  }

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
      rows.push([finish.sailNumber, '', status ?? finish.code ?? 'DNF']);
    }
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

/** The competitors eligible to appear on a race's sheet. */
function candidatesFor(
  race: SeriesRace,
  competitors: Candidate[],
  fleetId: string | null,
): Candidate[] {
  const fleetIds = new Set(race.starts.flatMap((s) => s.fleetIds));
  if (fleetIds.size === 0) return competitors;
  if (fleetId !== null) return competitors.filter((c) => c.fleetIds.includes(fleetId));
  return competitors.filter((c) => c.fleetIds.some((id) => fleetIds.has(id)));
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
]);

export function planRaceSenseImport(input: RaceSensePlanInput): RaceSensePlan {
  const { workbook, fleetId, competitors, finishes, offset = 0, overrides = {} } = input;

  const candidates = candidateRaces(input.races, fleetId);
  const byId = new Map(input.races.map((r) => [r.id, r]));
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
    const override = overrides[source.sheetName];
    const race = override
      ? byId.get(override) ?? null
      : candidates[source.number - 1 + offset] ?? null;

    if (!race) {
      notes.push({
        severity: 'warning',
        kind: 'no-race',
        sheet: source.sheetName,
        message: override
          ? 'The race this sheet was pointed at is no longer in the series.'
          : 'This series has no race for that sheet yet. Create it first, or point the sheet at an existing race.',
      });
      return {
        sheetName: source.sheetName,
        raceNumber: source.number,
        race: null,
        state: 'unmatched',
        recommended: false,
        result: null,
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
      state,
      recommended: state === 'new'
        && notes.every((n) => n.severity !== 'warning')
        && result.errors.length === 0,
      result,
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
