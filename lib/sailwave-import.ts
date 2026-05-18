/**
 * Sailwave JSON → SeriesFile importer.
 *
 * Port of `reference/data/2026-hyc-club-racing/sailwave-to-sailscoring.py`.
 * Keep behaviour in step with that script — it's been used in anger on real
 * HYC Sailwave 2.38 files and the choices here (alias collapse, scoring-suffix
 * detection, start fan-out, DNF inference, etc.) are documented inline there
 * and in the sibling README.
 *
 * Pure module — no DOM, no repository access. The wizard page hands the result
 * to `openSeriesFromFile` from `lib/series-file.ts` so every existing write
 * path, ID remap, and name-disambiguation rule applies unchanged.
 */
import type {
  Fleet,
  PrimaryPersonLabel,
  ResultCode,
} from './types';
import {
  FORMAT_VERSION,
  type SeriesFile,
} from './series-file';
import {
  DEFAULT_PRIMARY_PERSON_LABEL,
  defaultEnabledCompetitorFields,
} from './competitor-fields';
import { lookupAlias } from './nationality';

// ---- Raw Sailwave shape ----

export interface SailwaveCompetitorRaw {
  compboat?: string;
  compsailno?: string;
  compaltsailno?: string;
  comphelmname?: string;
  compcrewname?: string;
  compclub?: string;
  compnat?: string;
  compfleet?: string;
  compclass?: string;
  comprating?: string;
  compnewrating?: string;
  compalias?: string;
  compexclude?: string;
  comptotal?: string;
  compnett?: string;
  comprank?: string;
}

export interface SailwaveRaceRaw {
  racerank?: string;
  /** Sailwave date string. Formats seen in HYC files: `DD-MM-YY`, `DD-MM-YYYY`,
   *  `YYYY-MM-DD`, or human-readable variants like "May 5th" / "Aug 16" (no
   *  year). The parser handles the with-year forms; year-less variants fall
   *  back to the wizard's optional default. */
  racedate?: string;
  starts?: Record<string, string>;
}

export interface SailwaveResultRaw {
  comHandle?: string;
  racHandle?: string;
  rrestyp?: string;
  rpos?: string;
  rft?: string;
  rst?: string;
  rcor?: string;
  rele?: string;
  rcod?: string;
  rdisc?: string;
}

export interface SailwaveScoringSystemRaw {
  'scoring-codes'?: Record<string, { method?: string; value?: string }>;
}

export interface SailwaveRaw {
  header?: { version?: string; generator?: string };
  globals?: Record<string, string>;
  competitors?: Record<string, SailwaveCompetitorRaw>;
  races?: Record<string, SailwaveRaceRaw>;
  results?: Record<string, SailwaveResultRaw>;
  'scoring-systems'?: Record<string, SailwaveScoringSystemRaw>;
}

// ---- Constants (mirror Python) ----

export type ScoringSystem = Fleet['scoringSystem'];

/** Sailwave appends one of these suffixes to compfleet to encode the scoring
 *  system for that fleet. Bare names (no suffix) default to NHC. */
const SCORING_SUFFIX_TO_SYSTEM: ReadonlyArray<readonly [string, ScoringSystem]> = [
  [' HPH', 'nhc'],
  [' IRC', 'irc'],
  [' Scr', 'scratch'],
];

const VALID_SCORING_SYSTEMS: ReadonlySet<ScoringSystem> = new Set([
  'scratch', 'irc', 'py', 'nhc', 'echo',
]);

const SAILWAVE_METHOD_SERIES_PLUS = 'Boats in series +';
const SAILWAVE_METHOD_RACE_PLUS = 'Boats in race +';
const SAILWAVE_METHOD_SCORE_LIKE = 'Score like';

/** Sailscoring's 'starters'-base codes — the ones toggled by series-level
 *  dnfScoring. 'entries'-base codes (DNC, BFD) are always series-entries+1 in
 *  both A5.2 and A5.3, so we don't consult them when inferring the series-level
 *  setting. */
const SAILWAVE_STARTERS_BASE_CODES = [
  'DNF', 'DNS', 'OCS', 'NSC', 'RET', 'DSQ', 'DNE', 'UFD',
] as const;

/** Sailwave rrestyp values we recognise:
 *    "0" = no result entered                  → skip
 *    "1" = position-only finish (no rft/rst)  → finish with no time
 *    "3" = coded result (rcod = DNC/DNF/...)  → coded finish
 *    "4" = clean finish with rft/rst/rcor/rele → finish with time */
const SAILWAVE_RRESTYP_NO_RESULT = '0';
const SAILWAVE_RRESTYP_POSITION_ONLY = '1';
const SAILWAVE_RRESTYP_FINISHED = '4';
const SAILWAVE_RRESTYP_CODED = '3';

const SAILWAVE_TO_SAILSCORING_CODE: Record<string, ResultCode> = {
  DNC: 'DNC',
  DNS: 'DNS',
  DNF: 'DNF',
  RET: 'RET',
  RAF: 'RET',
  OCS: 'OCS',
  NSC: 'NSC',
  DSQ: 'DSQ',
  DNE: 'DNE',
  UFD: 'UFD',
  BFD: 'BFD',
  RDG: 'RDG',
};

// ---- Error type ----

export class SailwaveImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SailwaveImportError';
  }
}

// ---- Parse + sanitize ----

/** Decode bytes (windows-1252 — Sailwave saves on Windows and may contain
 *  non-UTF-8 helm names), strip trailing commas, escape bare control chars
 *  inside string literals so the standard JSON parser accepts the result. */
export function parseSailwaveJson(bytes: ArrayBuffer): SailwaveRaw {
  const decoded = new TextDecoder('windows-1252').decode(bytes);
  const noTrailingCommas = decoded.replace(/,(\s*[}\]])/g, '$1');
  const sanitized = escapeBareControlCharsInStrings(noTrailingCommas);
  let parsed: unknown;
  try {
    parsed = JSON.parse(sanitized);
  } catch (e) {
    throw new SailwaveImportError(
      `Not a valid Sailwave JSON export: ${(e as Error).message}`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SailwaveImportError('Not a valid Sailwave JSON export: expected an object at the top level.');
  }
  const raw = parsed as SailwaveRaw;
  if (raw.header?.generator !== 'sailwave') {
    throw new SailwaveImportError(
      "This doesn't look like a Sailwave export — the file's header.generator isn't \"sailwave\".",
    );
  }
  return raw;
}

/** State-machine pass over raw JSON text: inside a string literal, replace
 *  bare ASCII control characters with their JSON escape forms. Outside strings
 *  the chars are valid whitespace (CR/LF/TAB) and left alone. */
function escapeBareControlCharsInStrings(text: string): string {
  let out = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        out += ch;
        escape = false;
        continue;
      }
      if (ch === '\\') {
        out += ch;
        escape = true;
        continue;
      }
      if (ch === '"') {
        out += ch;
        inString = false;
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        out += controlEscape(ch);
        continue;
      }
      out += ch;
    } else {
      if (ch === '"') {
        inString = true;
      }
      out += ch;
    }
  }
  return out;
}

function controlEscape(ch: string): string {
  switch (ch) {
    case '\n': return '\\n';
    case '\r': return '\\r';
    case '\t': return '\\t';
    case '\b': return '\\b';
    case '\f': return '\\f';
    default:
      return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
  }
}

// ---- Preview (drives the wizard form) ----

export interface SailwavePreviewFleet {
  name: string;
  detectedScoringSystem: ScoringSystem;
  isBareName: boolean;       // no recognised scoring suffix
}

export interface SailwavePreview {
  name: string;              // globals.serevent
  venue: string;             // globals.servenue
  competitorCount: number;   // after excluding `compexclude == "1"` and aliases
  raceCount: number;
  fleets: SailwavePreviewFleet[];
  detectedDnfScoring: 'seriesEntries' | 'startingArea' | null;
  hasResults: boolean;
}

export function inspectSailwave(raw: SailwaveRaw): SailwavePreview {
  const globals = raw.globals ?? {};
  const comps = raw.competitors ?? {};
  const races = raw.races ?? {};
  const results = raw.results ?? {};

  const fleetNames: string[] = [];
  let competitorCount = 0;
  for (const c of Object.values(comps)) {
    if (c.compexclude === '1') continue;
    if ((c.compalias ?? '0') === '0') competitorCount += 1;
    const name = c.compfleet;
    if (name && !fleetNames.includes(name)) fleetNames.push(name);
  }

  const ratingsByFleet = collectRatingsByFleet(comps);
  const fleets: SailwavePreviewFleet[] = fleetNames.map((name) => {
    const suffixDetected = detectScoringSystemForFleet(name);
    if (suffixDetected !== null) {
      return { name, detectedScoringSystem: suffixDetected, isBareName: false };
    }
    // Bare name (no scoring suffix): look at the fleet's rating distribution.
    return {
      name,
      detectedScoringSystem: inferBareNameSystem(ratingsByFleet.get(name) ?? []),
      isBareName: true,
    };
  });

  return {
    name: (globals.serevent ?? '').trim(),
    venue: (globals.servenue ?? '').trim(),
    competitorCount,
    raceCount: Object.keys(races).length,
    fleets,
    detectedDnfScoring: detectDnfScoring(raw),
    hasResults: Object.keys(results).length > 0,
  };
}

function detectScoringSystemForFleet(name: string): ScoringSystem | null {
  for (const [suffix, system] of SCORING_SUFFIX_TO_SYSTEM) {
    if (name.endsWith(suffix)) return system;
  }
  return null;
}

/** Collect the parsed `comprating` of every non-excluded competitor per fleet
 *  (including alias rows — they each carry their own rating for their own
 *  fleet, which is what we want for inference). */
function collectRatingsByFleet(
  comps: Record<string, SailwaveCompetitorRaw>,
): Map<string, (number | null)[]> {
  const out = new Map<string, (number | null)[]>();
  for (const c of Object.values(comps)) {
    if (c.compexclude === '1') continue;
    const name = c.compfleet;
    if (!name) continue;
    const list = out.get(name) ?? [];
    list.push(parseRating(c.comprating));
    out.set(name, list);
  }
  return out;
}

/** Choose a scoring system for a fleet whose Sailwave name has no recognised
 *  suffix, based on the shape of its ratings:
 *    - no ratings at all → scratch (Sailwave's bare-Scratch fleets and
 *      one-design dinghies without handicaps both look like this)
 *    - every rating is an integer ≥ 100 → py (Portsmouth Yardstick numbers
 *      are 600–1500ish; the wider 100+ band tolerates legacy values)
 *    - otherwise → nhc (decimal multipliers around 1.0)
 *  The scorer can always override per-fleet in the wizard. */
export function inferBareNameSystem(ratings: ReadonlyArray<number | null>): ScoringSystem {
  const nonNull = ratings.filter((r): r is number => r !== null);
  if (nonNull.length === 0) return 'scratch';
  if (nonNull.every((r) => Number.isInteger(r) && r >= 100)) return 'py';
  return 'nhc';
}

function fleetBaseName(name: string): string {
  for (const [suffix] of SCORING_SUFFIX_TO_SYSTEM) {
    if (name.endsWith(suffix)) return name.slice(0, -suffix.length);
  }
  return name;
}

// ---- DNF scoring inference (A5.2 vs A5.3) ----

function resolveSailwaveCode(
  codes: Record<string, { method?: string; value?: string }>,
  code: string,
  seen: Set<string> = new Set(),
): { method?: string; value?: string } | null {
  if (seen.has(code)) return null;
  seen.add(code);
  const entry = codes[code];
  if (!entry) return null;
  if (entry.method === SAILWAVE_METHOD_SCORE_LIKE) {
    return resolveSailwaveCode(codes, entry.value ?? '', seen);
  }
  return entry;
}

function detectDnfScoring(
  raw: SailwaveRaw,
): 'seriesEntries' | 'startingArea' | null {
  const globals = raw.globals ?? {};
  const handle = globals.serscoringhandle;
  const systems = raw['scoring-systems'] ?? {};
  if (!handle || !(handle in systems)) return null;
  const codes = systems[handle]?.['scoring-codes'] ?? {};

  const dnf = resolveSailwaveCode(codes, 'DNF');
  if (!dnf) return null;
  const choice = methodToDnfScoring(dnf.method, dnf.value);
  if (!choice) return null;

  // Verify peers resolve the same way — anything else is a mixed config we
  // can't represent. We surface this via inspectSailwave returning the
  // canonical choice; buildSeriesFileFromSailwave throws if the caller didn't
  // pick an explicit override and a peer disagrees.
  return choice;
}

function methodToDnfScoring(
  method: string | undefined,
  value: string | undefined,
): 'seriesEntries' | 'startingArea' | null {
  if (method === SAILWAVE_METHOD_RACE_PLUS && value === '1') return 'startingArea';
  if (method === SAILWAVE_METHOD_SERIES_PLUS && value === '1') return 'seriesEntries';
  return null;
}

function assertDnfScoringConsistent(
  raw: SailwaveRaw,
  inferred: 'seriesEntries' | 'startingArea',
): void {
  const globals = raw.globals ?? {};
  const handle = globals.serscoringhandle;
  const systems = raw['scoring-systems'] ?? {};
  if (!handle || !(handle in systems)) return;
  const codes = systems[handle]?.['scoring-codes'] ?? {};

  for (const peer of SAILWAVE_STARTERS_BASE_CODES) {
    if (peer === 'DNF') continue;
    const resolved = resolveSailwaveCode(codes, peer);
    if (!resolved) continue;
    const peerChoice = methodToDnfScoring(resolved.method, resolved.value);
    if (peerChoice && peerChoice !== inferred) {
      throw new SailwaveImportError(
        `Sailwave code ${peer} resolves to ${peerChoice} but DNF resolves to ${inferred}; ` +
        `Sailscoring can only represent a single A5.2 / A5.3 choice per series. ` +
        `Override with the DNF scoring picker in the wizard.`,
      );
    }
  }
}

// ---- Race dates ----

/** Parse a Sailwave `racedate` string into ISO `YYYY-MM-DD`, given the
 *  series-level `serdatespec` hint (e.g. `"d-m-y"`, `"m-d-y"`, `"y-m-d"`).
 *  Returns null for blank or unparseable values — the wizard falls back to
 *  its optional default date in that case.
 *
 *  Supported separators: `-` `/` `.` `<space>`. Two-digit years are pinned to
 *  the 21st century (`26` → `2026`). Year-less variants like "May 5th" or
 *  "Aug 16" can't be reliably resolved without a year hint, so they parse
 *  as null. */
export function parseSailwaveRaceDate(
  racedate: string | undefined,
  datespec: string | undefined,
): string | null {
  if (!racedate) return null;
  const trimmed = racedate.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(/[-/.\s]+/).filter(Boolean);
  if (parts.length !== 3) return null;
  if (!parts.every((p) => /^\d+$/.test(p))) return null;

  const [a, b, c] = parts.map((p) => Number.parseInt(p, 10));
  const order = parseDateOrder(datespec);

  let d: number; let m: number; let y: number;
  if (order === 'dmy') { d = a; m = b; y = c; }
  else if (order === 'mdy') { m = a; d = b; y = c; }
  else if (order === 'ymd') { y = a; m = b; d = c; }
  else {
    // No hint — fall back to the most likely ordering by inspecting magnitudes.
    if (a > 31) { y = a; m = b; d = c; }       // YYYY-MM-DD or YY-MM-DD
    else if (c >= 100) { d = a; m = b; y = c; } // DD-MM-YYYY
    else { d = a; m = b; y = c; }              // DD-MM-YY (Sailwave/UK default)
  }

  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseDateOrder(datespec: string | undefined): 'dmy' | 'mdy' | 'ymd' | null {
  if (!datespec) return null;
  const s = datespec.toLowerCase().replace(/[^dmy]/g, '');
  // First letter wins: "d-m-y" → 'dmy', "dd-mm-yyyy" → 'dmy', "m/d/y" → 'mdy'.
  if (s.startsWith('d')) return 'dmy';
  if (s.startsWith('y')) return 'ymd';
  if (s.startsWith('m')) return 'mdy';
  return null;
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayIso(): string {
  return isoDate(new Date());
}

// ---- Time normalisation ----

/** Sailwave times come in three shapes across HYC files; normalise all to
 *  the HH:MM:SS form `lib/scoring.ts`'s parseTimeToSeconds accepts. */
export function sailwaveTimeToColon(t: string | undefined): string | null {
  if (!t) return null;
  const trimmed = t.trim();
  if (!trimmed) return null;
  if (trimmed.includes(':')) return trimmed;
  if (trimmed.includes('.')) return trimmed.replace(/\./g, ':');
  if (trimmed.length === 6 && /^\d{6}$/.test(trimmed)) {
    return `${trimmed.slice(0, 2)}:${trimmed.slice(2, 4)}:${trimmed.slice(4, 6)}`;
  }
  return null;
}

// ---- Start string parsing ----

/** Sailwave starts payload format:
 *    'Fleet^Puppeteer HPH^...^=^=...|19.15.00|Finish time|Start 1|||0|...'
 *  Pipe-segment 0 holds 'Fleet^<NAME>^...'; segment 1 is the gun time. */
export function parseStartString(s: string): { fleetName: string; startTime: string } | null {
  const parts = s.split('|');
  if (parts.length < 2) return null;
  const head = parts[0].split('^');
  if (head.length < 2) return null;
  const fleetName = head[1].trim();
  const startTime = sailwaveTimeToColon(parts[1]);
  if (!fleetName || !startTime) return null;
  return { fleetName, startTime };
}

// ---- Build options ----

export interface SailwaveImportOptions {
  name: string;
  venue: string;
  /** Optional default race date used as the fallback for races where
   *  Sailwave's `racedate` is missing or unparseable (no year). When omitted,
   *  today's date is used. The scorer can always fix individual race dates
   *  in the Races tab after import. */
  defaultRaceDate?: string;   // YYYY-MM-DD
  /** Optional series start date. Defaults to the earliest resolved race date. */
  startDate?: string;
  /** Optional series end date. Defaults to the latest resolved race date. */
  endDate?: string;
  primaryLabel: PrimaryPersonLabel;
  fleetScoringOverrides: ReadonlyMap<string, ScoringSystem>;
  includeScratchCompanions: boolean;
  includeResults: boolean;
  /** Force-override the series-level DNF base. When omitted the importer
   *  uses inspectSailwave's inference, defaulting to seriesEntries (A5.2) if
   *  Sailwave's config is missing/unrecognised. */
  dnfScoring?: 'seriesEntries' | 'startingArea';
}

// ---- Build (the main conversion) ----

interface FleetBuild {
  id: string;
  name: string;
  scoringSystem: ScoringSystem;
  displayOrder: number;
}

interface CompetitorBuild {
  id: string;
  fleetIds: string[];
  sailNumber: string;
  boatName?: string;
  boatClass?: string;
  name: string;
  crewName?: string;
  club: string;
  nationality?: string;
  gender: '';
  age: null;
  ircTcc?: number;
  pyNumber?: number;
  nhcStartingTcf?: number;
}

interface FinishBuild {
  id: string;
  competitorId: string;
  sortOrder: number | null;
  finishTime?: string;
  resultCode: ResultCode | null;
  startPresent: null;
  penaltyCode: null;
  penaltyOverride: null;
}

interface StartBuild {
  id: string;
  fleetIds: string[];
  startTime: string;
}

interface RaceBuild {
  id: string;
  raceNumber: number;
  date: string;
  starts: StartBuild[];
  finishes: FinishBuild[];
}

export function buildSeriesFileFromSailwave(
  raw: SailwaveRaw,
  opts: SailwaveImportOptions,
): SeriesFile {
  const globals = raw.globals ?? {};
  const rawComps = raw.competitors ?? {};
  const rawRaces = raw.races ?? {};
  const rawResults = raw.results ?? {};
  const datespec = globals.serdatespec;
  const defaultDate = opts.defaultRaceDate?.trim() || todayIso();

  // Resolve DNF scoring early so we can fail fast on mixed configs.
  const dnfScoring = resolveDnfScoring(raw, opts);

  const { fleets, fleetIdByName, fleetSystemByName, baseToFleetIds } = buildFleets(
    rawComps, opts.fleetScoringOverrides, opts.includeScratchCompanions,
  );

  const { competitors, compIdByHandle } = buildCompetitors(
    rawComps, fleetIdByName, fleetSystemByName,
  );

  const sortedRaces = sortedRaceHandles(rawRaces);
  const resultsByRace = groupResultsByRace(rawResults, opts.includeResults);

  const races: RaceBuild[] = [];
  for (let i = 0; i < sortedRaces.length; i++) {
    const [handle, race] = sortedRaces[i];
    const resolvedDate = parseSailwaveRaceDate(race.racedate, datespec) ?? defaultDate;
    const starts = buildRaceStarts(race.starts ?? {}, fleetIdByName, baseToFleetIds);
    const finishes = opts.includeResults
      ? buildRaceFinishes(resultsByRace[handle] ?? [], compIdByHandle)
      : [];
    // Skip races with no finishers when we're importing results — they'd
    // score as implicit DNC and pollute the imported series with placeholder
    // rows for the scheduled-but-unsailed remainder. Keep them under
    // --no-results so the full schedule survives.
    if (opts.includeResults && finishes.length === 0) continue;
    races.push({
      id: cryptoUuid(),
      raceNumber: parseRaceNumber(race.racerank, i + 1),
      date: resolvedDate,
      starts,
      finishes,
    });
  }

  const seriesId = cryptoUuid();
  const snapshotId = cryptoUuid();
  const sortedRaceDates = races.map((r) => r.date).filter(Boolean).sort();
  const startDateIso = (opts.startDate?.trim() || sortedRaceDates[0] || defaultDate);
  const endDateIso = (opts.endDate?.trim() || sortedRaceDates[sortedRaceDates.length - 1] || startDateIso);

  // Default the optional competitor fields to those Sailwave actually has data
  // for in this file — leaving "Class", "Helm", and "Club" enabled on a file
  // that never populates them just gives the scorer empty columns to clean up.
  const enabledFields = buildEnabledFields(opts.primaryLabel, dataFlagsFor(competitors));

  const file: SeriesFile = {
    formatVersion: FORMAT_VERSION,
    seriesId,
    snapshotId,
    snapshotHistory: [snapshotId],
    exportedAt: new Date().toISOString(),
    series: {
      id: seriesId,
      name: opts.name.trim() || (globals.serevent ?? '').trim() || 'Sailwave import',
      venue: opts.venue.trim(),
      startDate: startDateIso,
      endDate: endDateIso,
      venueLogoUrl: '',
      eventLogoUrl: '',
      discardThresholds: [],
      dnfScoring,
      ftpHost: '',
      ftpPath: '',
      bilgeBundle: null,
      includeJsonExport: true,
      enabledCompetitorFields: enabledFields,
      primaryPersonLabel: opts.primaryLabel,
      scoringMode: 'handicap',
    },
    fleets: fleets.map((f) => ({
      id: f.id,
      name: f.name,
      displayOrder: f.displayOrder,
      scoringSystem: f.scoringSystem,
    })),
    competitors: competitors.map((c) => ({
      id: c.id,
      fleetIds: c.fleetIds,
      sailNumber: c.sailNumber,
      ...(c.boatName ? { boatName: c.boatName } : {}),
      ...(c.boatClass ? { boatClass: c.boatClass } : {}),
      name: c.name,
      ...(c.crewName ? { crewName: c.crewName } : {}),
      club: c.club,
      ...(c.nationality ? { nationality: c.nationality } : {}),
      gender: c.gender,
      age: c.age,
      ...(c.ircTcc != null ? { ircTcc: c.ircTcc } : {}),
      ...(c.pyNumber != null ? { pyNumber: c.pyNumber } : {}),
      ...(c.nhcStartingTcf != null ? { nhcStartingTcf: c.nhcStartingTcf } : {}),
    })),
    races: races.map((r) => ({
      id: r.id,
      raceNumber: r.raceNumber,
      date: r.date,
      starts: r.starts.map((s) => ({
        id: s.id,
        fleetIds: s.fleetIds,
        startTime: s.startTime,
      })),
      finishes: r.finishes.map((f) => ({
        id: f.id,
        competitorId: f.competitorId,
        sortOrder: f.sortOrder,
        ...(f.finishTime ? { finishTime: f.finishTime } : {}),
        resultCode: f.resultCode,
        startPresent: f.startPresent,
        penaltyCode: f.penaltyCode,
        penaltyOverride: f.penaltyOverride,
      })),
    })),
  };

  return file;
}

function resolveDnfScoring(
  raw: SailwaveRaw,
  opts: SailwaveImportOptions,
): 'seriesEntries' | 'startingArea' {
  if (opts.dnfScoring) return opts.dnfScoring;
  const inferred = detectDnfScoring(raw);
  if (inferred) {
    assertDnfScoringConsistent(raw, inferred);
    return inferred;
  }
  return 'seriesEntries';
}

function buildFleets(
  comps: Record<string, SailwaveCompetitorRaw>,
  overrides: ReadonlyMap<string, ScoringSystem>,
  includeScratch: boolean,
): {
  fleets: FleetBuild[];
  fleetIdByName: Map<string, string>;
  fleetSystemByName: Map<string, ScoringSystem>;
  baseToFleetIds: Map<string, string[]>;
} {
  const seen: string[] = [];
  for (const c of Object.values(comps)) {
    if (c.compexclude === '1') continue;
    const name = c.compfleet;
    if (name && !seen.includes(name)) seen.push(name);
  }

  const fleets: FleetBuild[] = [];
  const fleetIdByName = new Map<string, string>();
  const fleetSystemByName = new Map<string, ScoringSystem>();
  const baseToFleetIds = new Map<string, string[]>();

  const ratingsByFleet = collectRatingsByFleet(comps);
  // Sort alphabetically so the produced fleet list reads naturally in the UI;
  // Sailwave's iteration order follows competitor entry, which surfaces
  // arbitrary orderings like "Class C, Class B, Class A".
  const ordered = [...seen].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  for (const name of ordered) {
    const override = overrides.get(name);
    const system = override
      ?? detectScoringSystemForFleet(name)
      ?? inferBareNameSystem(ratingsByFleet.get(name) ?? []);
    if (!VALID_SCORING_SYSTEMS.has(system)) {
      throw new SailwaveImportError(
        `Unknown scoring system "${system}" for fleet "${name}"; ` +
        `choose one of ${[...VALID_SCORING_SYSTEMS].join(', ')}.`,
      );
    }
    if (!includeScratch && system === 'scratch') continue;
    const id = cryptoUuid();
    fleets.push({ id, name, scoringSystem: system, displayOrder: fleets.length });
    fleetIdByName.set(name, id);
    fleetSystemByName.set(name, system);
    const base = fleetBaseName(name);
    const list = baseToFleetIds.get(base);
    if (list) list.push(id);
    else baseToFleetIds.set(base, [id]);
  }

  return { fleets, fleetIdByName, fleetSystemByName, baseToFleetIds };
}

function parseRating(s: string | undefined): number | null {
  if (s === undefined) return null;
  const trimmed = s.trim();
  if (!trimmed || trimmed === '0') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function buildCompetitors(
  comps: Record<string, SailwaveCompetitorRaw>,
  fleetIdByName: Map<string, string>,
  fleetSystemByName: Map<string, ScoringSystem>,
): { competitors: CompetitorBuild[]; compIdByHandle: Map<string, string> } {
  const aliasesOf = new Map<string, string[]>();
  for (const [k, v] of Object.entries(comps)) {
    const target = v.compalias ?? '0';
    if (target !== '0') {
      const list = aliasesOf.get(target);
      if (list) list.push(k);
      else aliasesOf.set(target, [k]);
    }
  }

  const out: CompetitorBuild[] = [];
  const compIdByHandle = new Map<string, string>();
  for (const [k, v] of Object.entries(comps)) {
    if ((v.compalias ?? '0') !== '0') continue;
    if (v.compexclude === '1') continue;

    const records: [string, SailwaveCompetitorRaw][] = [[k, v]];
    for (const ak of aliasesOf.get(k) ?? []) {
      const alias = comps[ak];
      if (alias.compexclude !== '1') records.push([ak, alias]);
    }

    const fleetIds: string[] = [];
    let ircTcc: number | null = null;
    let nhcTcf: number | null = null;
    let pyNumber: number | null = null;

    for (const [, rec] of records) {
      const compfleet = rec.compfleet ?? '';
      const fid = fleetIdByName.get(compfleet);
      if (!fid) continue;
      fleetIds.push(fid);
      const rating = parseRating(rec.comprating);
      if (rating == null) continue;
      const system = fleetSystemByName.get(compfleet);
      if (system === 'nhc') nhcTcf = rating;
      else if (system === 'irc') ircTcc = rating;
      else if (system === 'py') pyNumber = rating;
    }

    if (fleetIds.length === 0) continue;

    const compUuid = cryptoUuid();
    for (const [handle] of records) compIdByHandle.set(handle, compUuid);

    const built: CompetitorBuild = {
      id: compUuid,
      fleetIds,
      sailNumber: (v.compsailno ?? '').trim(),
      name: (v.comphelmname ?? '').trim(),
      club: (v.compclub ?? '').trim(),
      gender: '',
      age: null,
    };
    if (v.compboat?.trim()) built.boatName = v.compboat.trim();
    if (v.compclass?.trim()) built.boatClass = v.compclass.trim();
    if (v.compcrewname?.trim()) built.crewName = v.compcrewname.trim();
    // Nationality: uppercase, fold Sailwave aliases (BVI → IVB), keep only
    // well-formed 3-letter values. Unknown but well-formed codes pass
    // through so future dataset bumps surface naturally.
    const rawNat = (v.compnat ?? '').trim().toUpperCase();
    if (rawNat) {
      const canonical = lookupAlias(rawNat)?.canonical ?? rawNat;
      if (/^[A-Z]{3}$/.test(canonical)) built.nationality = canonical;
    }
    if (ircTcc != null) built.ircTcc = ircTcc;
    if (nhcTcf != null) built.nhcStartingTcf = nhcTcf;
    if (pyNumber != null) built.pyNumber = pyNumber;
    out.push(built);
  }

  return { competitors: out, compIdByHandle };
}

function buildRaceStarts(
  startsRaw: Record<string, string>,
  fleetIdByName: Map<string, string>,
  baseToFleetIds: Map<string, string[]>,
): StartBuild[] {
  const out: StartBuild[] = [];
  const seenFleetIds = new Set<string>();
  for (const raw of Object.values(startsRaw)) {
    const parsed = parseStartString(raw);
    if (!parsed) continue;
    const namedId = fleetIdByName.get(parsed.fleetName);
    if (!namedId) continue;
    const base = fleetBaseName(parsed.fleetName);
    const candidates = (baseToFleetIds.get(base) ?? []).filter((fid) => !seenFleetIds.has(fid));
    const fleetIds = [namedId, ...candidates.filter((fid) => fid !== namedId)];
    if (fleetIds.length === 0) continue;
    for (const fid of fleetIds) seenFleetIds.add(fid);
    out.push({
      id: cryptoUuid(),
      fleetIds,
      startTime: parsed.startTime,
    });
  }
  return out;
}

function mapSailwaveCode(rcod: string | undefined): ResultCode {
  const trimmed = (rcod ?? '').trim().toUpperCase();
  const mapped = SAILWAVE_TO_SAILSCORING_CODE[trimmed];
  if (!mapped) {
    throw new SailwaveImportError(
      `Unknown Sailwave result code "${trimmed || '(empty)'}"; ` +
      `add it to the mapping or fix the source file.`,
    );
  }
  return mapped;
}

function buildRaceFinishes(
  resultsForRace: SailwaveResultRaw[],
  compIdByHandle: Map<string, string>,
): FinishBuild[] {
  // Collapse primary+alias rows for the same physical boat — Sailwave
  // duplicates the rft/rcod across alias rows; keep the first one we see.
  const byCompetitor = new Map<string, SailwaveResultRaw>();
  for (const r of resultsForRace) {
    const rrestyp = r.rrestyp ?? SAILWAVE_RRESTYP_NO_RESULT;
    if (rrestyp === SAILWAVE_RRESTYP_NO_RESULT) continue;
    const compId = compIdByHandle.get(r.comHandle ?? '');
    if (!compId) continue;
    if (byCompetitor.has(compId)) continue;
    byCompetitor.set(compId, r);
  }

  const finished: { pos: number; rft: string; compId: string; raw: SailwaveResultRaw }[] = [];
  const coded: { compId: string; raw: SailwaveResultRaw }[] = [];
  for (const [compId, r] of byCompetitor) {
    const rrestyp = r.rrestyp ?? '';
    if (rrestyp === SAILWAVE_RRESTYP_FINISHED || rrestyp === SAILWAVE_RRESTYP_POSITION_ONLY) {
      const pos = Number.parseInt(r.rpos ?? '9999', 10);
      finished.push({
        pos: Number.isFinite(pos) ? pos : 9999,
        rft: r.rft ?? '',
        compId,
        raw: r,
      });
    } else if (rrestyp === SAILWAVE_RRESTYP_CODED) {
      coded.push({ compId, raw: r });
    } else {
      throw new SailwaveImportError(
        `Unexpected Sailwave rrestyp "${rrestyp}" for race result; ` +
        `only 0 / 1 / 3 / 4 are recognised.`,
      );
    }
  }

  finished.sort((a, b) => (a.pos - b.pos) || a.rft.localeCompare(b.rft));

  const out: FinishBuild[] = [];
  finished.forEach(({ compId, raw }, sortOrder) => {
    const finishTime = sailwaveTimeToColon(raw.rft);
    const entry: FinishBuild = {
      id: cryptoUuid(),
      competitorId: compId,
      sortOrder,
      resultCode: null,
      startPresent: null,
      penaltyCode: null,
      penaltyOverride: null,
    };
    if (finishTime) entry.finishTime = finishTime;
    out.push(entry);
  });

  for (const { compId, raw } of coded) {
    const code = mapSailwaveCode(raw.rcod);
    // Treat DNC as implicit — Sailwave eagerly stamps every non-entered race
    // as an explicit DNC row, which on import would clutter Sailscoring's
    // race standings table with placeholder entries. Sailscoring's scoring
    // engine auto-DNCs competitors that don't appear in a race's finish
    // sheet, so dropping the row preserves the score and tidies the UI.
    if (code === 'DNC') continue;
    out.push({
      id: cryptoUuid(),
      competitorId: compId,
      sortOrder: null,
      resultCode: code,
      startPresent: null,
      penaltyCode: null,
      penaltyOverride: null,
    });
  }

  return out;
}

function sortedRaceHandles(
  rawRaces: Record<string, SailwaveRaceRaw>,
): [string, SailwaveRaceRaw][] {
  const entries = Object.entries(rawRaces);
  entries.sort(([ka, va], [kb, vb]) => {
    const ra = parseRaceNumber(va.racerank, Number.parseInt(ka, 10) || 0);
    const rb = parseRaceNumber(vb.racerank, Number.parseInt(kb, 10) || 0);
    return ra - rb;
  });
  return entries;
}

function parseRaceNumber(racerank: string | undefined, fallback: number): number {
  if (racerank === undefined) return fallback;
  const n = Number.parseInt(racerank, 10);
  return Number.isFinite(n) ? n : fallback;
}

function groupResultsByRace(
  rawResults: Record<string, SailwaveResultRaw>,
  includeResults: boolean,
): Record<string, SailwaveResultRaw[]> {
  const out: Record<string, SailwaveResultRaw[]> = {};
  if (!includeResults) return out;
  for (const r of Object.values(rawResults)) {
    const handle = r.racHandle ?? '';
    (out[handle] ??= []).push(r);
  }
  return out;
}

/** Per-field "did Sailwave actually give us a value for this anywhere"
 *  flags, derived from the built competitor list. The wizard uses these to
 *  default the series's `enabledCompetitorFields` to only the fields scorers
 *  will see populated — leaving Helm/Class/Club enabled on a file that never
 *  fills them in just gives blank columns to clean up. */
interface CompetitorDataFlags {
  hasBoatName: boolean;
  hasBoatClass: boolean;
  hasHelm: boolean;
  hasCrewName: boolean;
  hasClub: boolean;
  hasNationality: boolean;
}

function dataFlagsFor(competitors: ReadonlyArray<CompetitorBuild>): CompetitorDataFlags {
  return {
    hasBoatName: competitors.some((c) => !!c.boatName),
    hasBoatClass: competitors.some((c) => !!c.boatClass),
    // Helm is stored on `name` (the primary identifier slot); only flag it
    // if at least one competitor actually has a name string.
    hasHelm: competitors.some((c) => !!c.name),
    hasCrewName: competitors.some((c) => !!c.crewName),
    hasClub: competitors.some((c) => !!c.club),
    hasNationality: competitors.some((c) => !!c.nationality),
  };
}

function buildEnabledFields(
  primary: PrimaryPersonLabel,
  flags: CompetitorDataFlags,
): SeriesFile['series']['enabledCompetitorFields'] {
  // Only enable fields Sailwave populated for at least one competitor — empty
  // columns are a poor first impression after import. Honour the primary
  // label: 'helm'/'owner' as the primary slot means the matching role field
  // would duplicate the primary, so it stays disabled.
  const fields: SeriesFile['series']['enabledCompetitorFields'] = [];
  if (flags.hasBoatName) fields.push('boatName');
  if (flags.hasBoatClass) fields.push('boatClass');
  if (flags.hasHelm && primary !== 'helm' && primary !== 'owner') fields.push('helm');
  if (flags.hasCrewName) fields.push('crewName');
  if (flags.hasClub) fields.push('club');
  if (flags.hasNationality) fields.push('nationality');
  // Fall back to project defaults only if Sailwave gave us nothing — keeps
  // newly-imported series consistent with manually-created ones.
  return fields.length > 0 ? fields : defaultEnabledCompetitorFields();
}

function cryptoUuid(): string {
  return crypto.randomUUID();
}

// Re-export DEFAULT for the wizard form
export { DEFAULT_PRIMARY_PERSON_LABEL };
