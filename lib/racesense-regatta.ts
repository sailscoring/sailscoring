/**
 * The regatta document behind a RaceSense player replay, read as a workbook.
 *
 * `player.vakaros.com/watch/{regattaId}/{division}` is a viewer over one
 * Firestore document per regatta, and that document holds the same record
 * the `RaceSense-Report` workbook is exported from: the same starts, OCS
 * calls, finishes to the millisecond, and non-finishers. Reading it directly
 * means a race can be imported the moment it finishes, without waiting for
 * the committee to export. `docs/notes/racesense/player-document.md`
 * describes the document; this module turns it into the same
 * `RaceSenseWorkbook` the workbook parser produces, so everything downstream
 * — the plan, the preview, the commit — is shared and neither source can
 * drift from the other.
 *
 * Three things are decided here rather than read, each verified against the
 * workbook exported from the same regatta:
 *
 * - **The start is floored to the minute.** Every recorded `startTime` is a
 *   second past the minute and the workbook measures `Total Time` from the
 *   whole minute, so that is what elapsed times are measured from here.
 * - **Every participant is a starter**, as in the workbook's Starts block;
 *   a boat absent from the start's check-in list carries `Not Checked-In`,
 *   and every participant without a finish record is a `DNF` tail row. The
 *   plan's reading of those (a never-checked-in boat with no distance to the
 *   line is DNC, not DNF) then applies to both sources alike.
 * - **The workbook's precision.** Distance to the line to the centimetre,
 *   max speed to a tenth of a knot, distance sailed to the metre, elapsed
 *   time to the millisecond. A race imported from the player and then from
 *   the committee's export must read back `unchanged`, and it only can if
 *   both sources store the same figures.
 *
 * Fetching the document is `lib/racesense-player.ts` (server-only); this
 * module is pure so the browser, the desk script and the tests can all read
 * a captured document the same way.
 */

import {
  checkPreparatorySignal,
  checkShortCourseFinishes,
  START_STATUSES,
  type RaceSenseAnomaly,
  type RaceSenseFinish,
  type RaceSenseRace,
  type RaceSenseStarter,
  type RaceSenseWorkbook,
} from './racesense-workbook';

// ---------------------------------------------------------------------------
// The player URL
// ---------------------------------------------------------------------------

export interface RaceSensePlayerRef {
  regattaId: string;
  /** The division the URL was watching, when it names one. */
  division: string | null;
}

/** Firestore document ids as Vakaros mints them: 20 URL-safe characters. A
 *  little slack either side, since nothing says they must stay that way. */
const REGATTA_ID = /^[A-Za-z0-9_-]{12,40}$/;

/**
 * Read a regatta id out of what a scorer pastes: a watch URL with or without
 * its scheme, the division segment and any query, or the bare id the
 * workbook prints as `Regatta ID`. `null` when it is none of those.
 */
export function parseRaceSensePlayerRef(input: string): RaceSensePlayerRef | null {
  const text = input.trim();
  if (text === '') return null;
  if (REGATTA_ID.test(text)) return { regattaId: text, division: null };

  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const segments = url.pathname.split('/').filter((s) => s !== '');
  if (segments[0] !== 'watch' || segments.length < 2) return null;
  const regattaId = segments[1];
  if (!REGATTA_ID.test(regattaId)) return null;
  let division: string | null = null;
  if (segments.length > 2) {
    try {
      division = decodeURIComponent(segments[2]).trim() || null;
    } catch {
      division = segments[2];
    }
  }
  return { regattaId, division };
}

// ---------------------------------------------------------------------------
// Firestore's JSON
// ---------------------------------------------------------------------------

/**
 * A value as the Firestore REST API writes it: one key naming the type.
 * Integers arrive as strings, timestamps as RFC 3339, and maps and arrays
 * nest the same shape.
 */
export type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { timestampValue: string }
  | { bytesValue: string }
  | { referenceValue: string }
  | { geoPointValue: { latitude?: number; longitude?: number } }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

export interface FirestoreDocument {
  name?: string;
  fields?: Record<string, FirestoreValue>;
  createTime?: string;
  updateTime?: string;
}

/** One Firestore value as a plain JavaScript value. Integers become numbers
 *  (nothing in this document approaches 2^53), timestamps stay strings. */
export function decodeFirestoreValue(value: FirestoreValue): unknown {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return value.timestampValue;
  if ('bytesValue' in value) return value.bytesValue;
  if ('referenceValue' in value) return value.referenceValue;
  if ('geoPointValue' in value) return value.geoPointValue;
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decodeFirestoreValue);
  if ('mapValue' in value) return decodeFirestoreFields(value.mapValue.fields ?? {});
  return undefined;
}

export function decodeFirestoreFields(
  fields: Record<string, FirestoreValue>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) out[key] = decodeFirestoreValue(value);
  return out;
}

/**
 * Fields of the document that the import never reads and that make up most
 * of its size: per-boat positions and headings, line geometry, device
 * serials, the course, the committee's own devices. Pruned before a document
 * is saved as a capture, so a fixture holds the record and not the telemetry
 * — and none of the device identifiers.
 */
export const PRUNED_FIELDS: ReadonlySet<string> = new Set([
  'positionAtStart', 'positionAtFinish', 'headingAtStartDeg', 'heading',
  'lineLeftLocation', 'lineRightLocation', 'lineLeftAge', 'lineRightAge',
  'startLine', 'startTriangleConfig', 'mask', 'serialNumber',
  'gpsCorrectionAge', 'gpsCorrectionType',
  'rcDevices', 'deviceSubs', 'courses', 'achievements',
  'adminId', 'atlasSn', 'primarySn', 'secondarySns', 'platformId', 'color',
  'raceSenseEvent', 'eventId',
]);

/** The document with `PRUNED_FIELDS` removed at every depth. */
export function pruneFirestoreDocument(doc: FirestoreDocument): FirestoreDocument {
  const pruneValue = (value: FirestoreValue): FirestoreValue => {
    if ('mapValue' in value) return { mapValue: { fields: pruneFields(value.mapValue.fields ?? {}) } };
    if ('arrayValue' in value) {
      return { arrayValue: { values: (value.arrayValue.values ?? []).map(pruneValue) } };
    }
    return value;
  };
  const pruneFields = (fields: Record<string, FirestoreValue>) => {
    const out: Record<string, FirestoreValue> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (!PRUNED_FIELDS.has(key)) out[key] = pruneValue(value);
    }
    return out;
  };
  return { ...doc, fields: pruneFields(doc.fields ?? {}) };
}

// ---------------------------------------------------------------------------
// The regatta, narrowed to what the import reads
// ---------------------------------------------------------------------------

export interface RaceSenseParticipant {
  sailNumber: string;
  boatName: string;
  bowNumber: string;
}

/** One boat's distance to the line at the gun, from the start's
 *  `startingStats`. Millimetres, sign as the device wrote it. */
export interface RaceSenseStartingStat {
  sailNumber: string;
  dtlMm: number | null;
}

export interface RaceSenseRegattaStart {
  startNumber: number | null;
  /** UTC, RFC 3339. */
  startTime: string | null;
  /** `finished` for a start that ran to the finish; a general recall or an
   *  abandonment leaves something else, which the reading reports. */
  stopReason: string | null;
  /** Verbatim: `p`, `i`, `u`, `black`… */
  prepFlag: string | null;
  checkedIn: string[];
  ocs: string[];
  exonerated: string[];
  clearedOcs: string[];
  startingStats: RaceSenseStartingStat[];
}

export interface RaceSenseRegattaFinish {
  sailNumber: string;
  /** UTC, RFC 3339, to the millisecond. */
  finishingTime: string;
  /** Knots, as the document already stores it. */
  maxSpeedKts: number | null;
  /** Metres. */
  distanceM: number | null;
}

export interface RaceSenseRegattaRace {
  raceNumber: number;
  /** `Race 1`, or whatever the committee renamed it to. */
  name: string | null;
  /** `finished` once the race is over; earlier stages are what a race in
   *  progress carries and the reading leaves them out. */
  stage: string | null;
  isPractice: boolean;
  /** The race's local offset from UTC, in milliseconds (the document stores
   *  microseconds). */
  timezoneOffsetMs: number | null;
  endTime: string | null;
  protestingBoats: string[];
  /** Every start attempted, in order — a general recall adds one. */
  starts: RaceSenseRegattaStart[];
  /** In crossing order. */
  finishes: RaceSenseRegattaFinish[];
}

export interface RaceSenseDivision {
  name: string;
  fleetIndex: number | null;
  boatClass: string | null;
  participants: RaceSenseParticipant[];
  races: RaceSenseRegattaRace[];
}

export interface RaceSenseRegatta {
  id: string;
  name: string | null;
  startDate: string | null;
  endDate: string | null;
  /** When the committee's device last wrote the document. */
  modifiedTs: string | null;
  sequenceNumber: number | null;
  divisions: RaceSenseDivision[];
}

type Plain = Record<string, unknown>;

const isPlain = (v: unknown): v is Plain => typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (o: Plain, key: string): string | null => {
  const v = o[key];
  return typeof v === 'string' ? v : null;
};
const num = (o: Plain, key: string): number | null => {
  const v = o[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};
const bool = (o: Plain, key: string): boolean => o[key] === true;
const list = (o: Plain, key: string): Plain[] => {
  const v = o[key];
  return Array.isArray(v) ? v.filter(isPlain) : [];
};
const strings = (o: Plain, key: string): string[] => {
  const v = o[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
};

/**
 * Narrow a decoded regatta document to the shape above. Tolerant by design:
 * a field that is missing or of an unexpected type reads as absent, and
 * what that costs is reported when the workbook is built, against the race
 * it affects — the document is Vakaros's to change, and a reading that
 * throws on the first surprise would tell the scorer nothing.
 */
export function readRaceSenseRegatta(document: Plain, id: string): RaceSenseRegatta {
  return {
    id: str(document, 'id') ?? id,
    name: str(document, 'name'),
    startDate: str(document, 'startDate'),
    endDate: str(document, 'endDate'),
    modifiedTs: str(document, 'modifiedTs'),
    sequenceNumber: num(document, 'sequenceNumber'),
    divisions: list(document, 'divisions').map((d) => ({
      name: str(d, 'name') ?? '',
      fleetIndex: num(d, 'fleetIndex'),
      boatClass: str(d, 'boatClass'),
      participants: list(d, 'participants')
        .map((p) => ({
          sailNumber: (str(p, 'sailNumber') ?? '').trim(),
          boatName: (str(p, 'boatName') ?? '').trim(),
          bowNumber: (str(p, 'bowNumber') ?? '').trim(),
        }))
        .filter((p) => p.sailNumber !== ''),
      races: list(d, 'races').map((r) => ({
        raceNumber: num(r, 'raceNumber') ?? 0,
        name: str(r, 'name'),
        stage: str(r, 'currentStage'),
        isPractice: bool(r, 'isPractice'),
        timezoneOffsetMs: (() => {
          const micros = num(r, 'timezoneOffset');
          return micros === null ? null : micros / 1000;
        })(),
        endTime: str(r, 'endTime'),
        protestingBoats: strings(r, 'protestingBoats'),
        starts: list(r, 'starts').map((s) => ({
          startNumber: num(s, 'startNumber'),
          startTime: str(s, 'startTime'),
          stopReason: str(s, 'stopReason'),
          prepFlag: str(s, 'prepFlag'),
          checkedIn: strings(s, 'checkedInParticipants'),
          ocs: strings(s, 'ocsParticipants'),
          exonerated: strings(s, 'exoneratedParticipants'),
          clearedOcs: strings(s, 'clearedOcs'),
          startingStats: list(s, 'startingStats')
            .map((st) => ({ sailNumber: (str(st, 'sailNumber') ?? '').trim(), dtlMm: num(st, 'dtlMm') }))
            .filter((st) => st.sailNumber !== ''),
        })),
        finishes: list(r, 'finishes')
          .map((f) => ({
            sailNumber: (str(f, 'sailNumber') ?? '').trim(),
            finishingTime: str(f, 'finishingTime') ?? '',
            maxSpeedKts: num(f, 'maxSpeed'),
            distanceM: num(f, 'distanceTraveled'),
          }))
          .filter((f) => f.sailNumber !== '' && f.finishingTime !== ''),
      })),
    })),
  };
}

/** The regatta straight from the REST response. `id` is the last segment of
 *  the document's resource name unless the document says otherwise. */
export function readRaceSenseRegattaDocument(doc: FirestoreDocument, id: string): RaceSenseRegatta {
  return readRaceSenseRegatta(decodeFirestoreFields(doc.fields ?? {}), id);
}

// ---------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------

/** RFC 3339 as Firestore writes it, with any number of fractional digits —
 *  `endTime` carries six, `Date.parse` is only promised three. */
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|([+-])(\d{2}):(\d{2}))$/;

/** Milliseconds since the epoch, or `null` for anything that isn't a
 *  timestamp. Fractional seconds truncate to the millisecond. */
export function parseTimestampMs(value: string | null): number | null {
  if (value === null) return null;
  const m = RFC3339.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, frac, sign, oh, om] = m;
  const millis = frac ? Number(frac.slice(0, 3).padEnd(3, '0')) : 0;
  let ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), millis);
  if (sign) {
    const offset = (Number(oh) * 60 + Number(om)) * 60_000;
    ms -= sign === '+' ? offset : -offset;
  }
  return ms;
}

const MINUTE_MS = 60_000;

const pad = (n: number): string => String(n).padStart(2, '0');

/** `HH:MM:SS` of a UTC instant in the race's own zone, seconds truncated. */
export function localTimeOfDay(utcMs: number, offsetMs: number): string {
  const d = new Date(utcMs + offsetMs);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** `YYYY-MM-DD` of a UTC instant in the race's own zone. */
export function localDate(utcMs: number, offsetMs: number): string {
  const d = new Date(utcMs + offsetMs);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * To the workbook's precision, the workbook's way: the binary double
 * formatted to `places` decimals, as the export does. Not `Math.round`,
 * which puts a distance of 4925 mm at 4.93 m where the export — and every
 * language that formats the double 4.925 honestly — writes 4.92.
 */
const round = (value: number, places: number): number => Number(value.toFixed(places));

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** The document's preparatory flag → the workbook's `Preparatory Signal
 *  Used`, which is the spelling the code tables are keyed by. Only `p` has
 *  been seen; the rest follow the workbook's own spellings and are guesses
 *  in the same way. Anything else passes through verbatim, where the
 *  signal check reports it as unmapped. */
const PREP_FLAGS: Readonly<Record<string, string>> = {
  p: 'P',
  i: 'I',
  u: 'U',
  black: 'Black',
  z: 'Z',
};

/** A start that ran to the finish. */
const STOP_FINISHED = 'finished';

/** A race the committee has finished. */
const STAGE_FINISHED = 'finished';

/** How far past the minute a recorded start may be before it stops looking
 *  like the device's usual one-second lag and starts looking like a start
 *  that really wasn't on the minute. */
const START_LAG_TOLERANCE_S = 5;

// ---------------------------------------------------------------------------
// Building the workbook
// ---------------------------------------------------------------------------

interface Ctx {
  sheet: string;
  anomalies: RaceSenseAnomaly[];
}

function flag(
  ctx: Ctx,
  severity: 'info' | 'warning',
  kind: string,
  message: string,
  extra?: { where?: string; value?: string },
): void {
  ctx.anomalies.push({ severity, kind, sheet: ctx.sheet, message, ...extra });
}

/** What a boat's Starts-block `Status` cell would read, from the start's
 *  four lists. The workbook's own vocabulary, so `START_STATUSES` reads it. */
function statusFor(sailNumber: string, start: RaceSenseRegattaStart, checkedIn: Set<string>): string {
  if (start.ocs.includes(sailNumber)) {
    if (start.exonerated.includes(sailNumber)) return 'OCS (Cleared)';
    if (start.clearedOcs.includes(sailNumber)) return 'OCS *';
    return 'OCS';
  }
  return checkedIn.has(sailNumber) ? '' : 'Not Checked-In';
}

/** Why a race is left out of the workbook, or `null` to include it. */
function skipReason(race: RaceSenseRegattaRace): string | null {
  if (race.isPractice) return 'is a practice race';
  if (race.starts.length === 0) return 'has not been started';
  if (race.stage !== STAGE_FINISHED) {
    return race.stage
      ? `is still in progress on the water (RaceSense has it at “${race.stage}”)`
      : 'has not finished';
  }
  return null;
}

function buildRace(
  race: RaceSenseRegattaRace,
  division: RaceSenseDivision,
  anomalies: RaceSenseAnomaly[],
): RaceSenseRace {
  const sheetName = `Race ${race.raceNumber}`;
  const ctx: Ctx = { sheet: sheetName, anomalies };

  if (race.name && race.name !== sheetName) {
    flag(ctx, 'info', 'race-name', `RaceSense calls this race “${race.name}”.`, { value: race.name });
  }

  // The last start is the one that counted: a general recall leaves the
  // recalled start in the list ahead of the one that ran.
  const start = race.starts[race.starts.length - 1];
  if (race.starts.length > 1) {
    flag(ctx, 'info', 'general-recall',
      `Started ${race.starts.length} times; the last start is the one read here.`,
      { value: String(race.starts.length) });
  }
  if (start.stopReason !== STOP_FINISHED) {
    flag(ctx, 'warning', 'stop-reason',
      `The start that was read ended with “${start.stopReason ?? 'no reason recorded'}” rather than a finish, so what it holds may not be the race the committee scored.`,
      { where: `start ${start.startNumber ?? '?'}`, value: start.stopReason ?? '' });
  }

  const preparatorySignal = start.prepFlag === null
    ? null
    : PREP_FLAGS[start.prepFlag.toLowerCase()] ?? start.prepFlag;
  checkPreparatorySignal(ctx, preparatorySignal);

  const offsetMs = race.timezoneOffsetMs ?? 0;
  if (race.timezoneOffsetMs === null) {
    flag(ctx, 'warning', 'no-timezone',
      'The race carries no time zone, so its times of day are shown in UTC.');
  }

  const startMs = parseTimestampMs(start.startTime);
  if (startMs === null) {
    flag(ctx, 'warning', 'unreadable-time',
      `Couldn’t read the start time “${start.startTime ?? ''}”, so no elapsed times can be worked out for this race.`,
      { where: 'start time', value: start.startTime ?? '' });
  }
  const gunMs = startMs === null ? null : startMs - (startMs % MINUTE_MS);
  if (startMs !== null && gunMs !== null && startMs - gunMs > START_LAG_TOLERANCE_S * 1000) {
    flag(ctx, 'warning', 'start-seconds',
      `The start was recorded at ${localTimeOfDay(startMs, offsetMs)}, but elapsed times are measured from ${localTimeOfDay(gunMs, offsetMs)} — the whole minute, as the committee’s export measures them. Check which the committee means.`,
      { where: 'start time', value: start.startTime ?? '' });
  }

  const checkedIn = new Set(start.checkedIn);
  const dtlBySail = new Map(start.startingStats.map((s) => [s.sailNumber, s.dtlMm]));
  const lineRecorded = start.startingStats.some((s) => s.dtlMm !== null);

  const starters: RaceSenseStarter[] = division.participants.map((p) => {
    const status = statusFor(p.sailNumber, start, checkedIn);
    const dtlMm = dtlBySail.get(p.sailNumber) ?? null;
    return {
      sailNumber: p.sailNumber,
      boatName: p.boatName,
      bowNumber: p.bowNumber,
      status,
      meaning: START_STATUSES[status] ?? null,
      protest: race.protestingBoats.includes(p.sailNumber),
      dtlAtStartM: dtlMm === null ? null : round(dtlMm / 1000, 2),
    };
  });
  for (const s of starters) {
    if (s.protest) {
      flag(ctx, 'info', 'protest',
        'RaceSense recorded a protest against this boat. Protests are not imported — the race committee’s notes decide the outcome.',
        { where: `starter ${s.sailNumber}` });
    }
  }
  if (!lineRecorded) {
    flag(ctx, 'info', 'no-line',
      'No distances to the line were recorded for this start.');
  }

  const known = new Set(division.participants.map((p) => p.sailNumber));
  const ordered = race.finishes
    .map((f) => ({ ...f, ms: parseTimestampMs(f.finishingTime) }))
    .sort((a, b) => (a.ms ?? Infinity) - (b.ms ?? Infinity));

  const finishes: RaceSenseFinish[] = [];
  const seen = new Set<string>();
  for (const f of ordered) {
    if (seen.has(f.sailNumber)) {
      flag(ctx, 'warning', 'duplicate-sail', `${f.sailNumber} has two finish records.`,
        { where: `finish for ${f.sailNumber}`, value: f.sailNumber });
      continue;
    }
    seen.add(f.sailNumber);
    if (!known.has(f.sailNumber)) {
      flag(ctx, 'warning', 'unlisted-finisher',
        `${f.sailNumber} has a finish record but is not among the division’s participants.`,
        { where: `finish for ${f.sailNumber}`, value: f.sailNumber });
    }
    if (f.ms === null) {
      flag(ctx, 'warning', 'unreadable-time',
        `Couldn’t read ${f.sailNumber}’s finishing time “${f.finishingTime}”, so she is imported with a place and no time.`,
        { where: `finish for ${f.sailNumber}`, value: f.finishingTime });
    }
    finishes.push({
      position: finishes.length + 1,
      code: null,
      sailNumber: f.sailNumber,
      boatName: division.participants.find((p) => p.sailNumber === f.sailNumber)?.boatName ?? '',
      bowNumber: division.participants.find((p) => p.sailNumber === f.sailNumber)?.bowNumber ?? '',
      finishTime: f.ms === null ? null : localTimeOfDay(f.ms, offsetMs),
      totalTimeSecs: f.ms === null || gunMs === null ? null : round((f.ms - gunMs) / 1000, 3),
      maxSpeedKts: f.maxSpeedKts === null ? null : round(f.maxSpeedKts, 1),
      distanceKm: f.distanceM === null ? null : round(f.distanceM / 1000, 3),
    });
  }

  // The tail: every participant without a finish record, as the workbook
  // writes them. The plan reads each one's Starts row to decide what her
  // DNF really was.
  for (const p of division.participants) {
    if (seen.has(p.sailNumber)) continue;
    finishes.push({
      position: null,
      code: 'DNF',
      sailNumber: p.sailNumber,
      boatName: p.boatName,
      bowNumber: p.bowNumber,
      finishTime: null,
      totalTimeSecs: null,
      maxSpeedKts: null,
      distanceKm: null,
    });
  }

  checkShortCourseFinishes(ctx, finishes);

  return {
    sheetName,
    number: race.raceNumber,
    startNumber: start.startNumber === null ? null : String(start.startNumber),
    date: gunMs === null ? null : localDate(gunMs, offsetMs),
    preparatorySignal,
    startTime: gunMs === null ? null : localTimeOfDay(gunMs, offsetMs),
    starters,
    // The workbook omits the block when nobody finished and the plan reads
    // the omission; here the tail alone says the same thing.
    finishes: finishes.some((f) => f.position !== null) ? finishes : null,
  };
}

/** When the document was read, and what it said about itself — the note the
 *  plan shows at the top, so a scorer knows how fresh the read is. */
function readNote(regatta: RaceSenseRegatta): RaceSenseAnomaly {
  const modified = parseTimestampMs(regatta.modifiedTs);
  const offsetMs = regatta.divisions.flatMap((d) => d.races)
    .find((r) => r.timezoneOffsetMs !== null)?.timezoneOffsetMs ?? 0;
  const when = modified === null
    ? 'at an unknown time'
    : `at ${localTimeOfDay(modified, offsetMs)} on ${localDate(modified, offsetMs)}`;
  return {
    severity: 'info',
    kind: 'player-read',
    sheet: '',
    message: `Read from the RaceSense player. The committee’s device last wrote the regatta ${when}${
      regatta.sequenceNumber === null ? '' : ` (update ${regatta.sequenceNumber})`
    }; read it again after the next race finishes.`,
  };
}

/**
 * One division of the regatta as the workbook its export would be — the
 * sheets in race-number order, the races still on the water left out and
 * listed, the read itself on the record.
 */
export function regattaToWorkbook(
  regatta: RaceSenseRegatta,
  division: RaceSenseDivision,
): RaceSenseWorkbook {
  const anomalies: RaceSenseAnomaly[] = [readNote(regatta)];
  const races: RaceSenseRace[] = [];
  const seenNumbers = new Set<number>();

  for (const race of [...division.races].sort((a, b) => a.raceNumber - b.raceNumber)) {
    const sheetName = `Race ${race.raceNumber}`;
    const skipped = skipReason(race);
    if (skipped) {
      anomalies.push({
        severity: race.isPractice ? 'info' : 'warning',
        kind: 'race-skipped',
        sheet: sheetName,
        value: sheetName,
        message: `${race.name ?? sheetName} ${skipped}, so it is not offered here.`,
      });
      continue;
    }
    if (seenNumbers.has(race.raceNumber)) {
      anomalies.push({
        severity: 'warning',
        kind: 'duplicate-race',
        sheet: sheetName,
        value: sheetName,
        message: `Two races in this division are numbered ${race.raceNumber}; only the first is read.`,
      });
      continue;
    }
    seenNumbers.add(race.raceNumber);
    races.push(buildRace(race, division, anomalies));
  }

  const startMs = parseTimestampMs(regatta.startDate);
  const offsetMs = division.races.find((r) => r.timezoneOffsetMs !== null)?.timezoneOffsetMs ?? 0;

  return {
    regatta: regatta.name,
    regattaId: regatta.id,
    division: division.name,
    appVersion: null,
    regattaStartDate: startMs === null ? null : localDate(startMs, offsetMs),
    races,
    summary: null,
    anomalies,
  };
}

/** The division a player URL was watching, or the only one, or none. */
export function pickDivision(
  regatta: RaceSenseRegatta,
  name: string | null,
): RaceSenseDivision | null {
  if (name !== null) {
    const wanted = name.trim().toLowerCase();
    const match = regatta.divisions.find((d) => d.name.trim().toLowerCase() === wanted);
    if (match) return match;
  }
  return regatta.divisions.length === 1 ? regatta.divisions[0] : null;
}
