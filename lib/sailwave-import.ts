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

  const fleets: SailwavePreviewFleet[] = fleetNames.map((name) => {
    const detected = detectScoringSystemForFleet(name);
    return {
      name,
      detectedScoringSystem: detected ?? 'nhc',
      isBareName: detected === null,
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

/** Walk forward from `start` and stop at each matching weekday until `count`
 *  dates are produced. Empty `weekdays` ⇒ every race uses `start`.
 *  `weekdays` uses JS Date.getDay() ordering: 0 = Sunday, 1 = Monday, ..., 6 = Saturday. */
export function raceDates(start: Date, count: number, weekdays: ReadonlySet<number>): Date[] {
  if (weekdays.size === 0) {
    return Array.from({ length: count }, () => new Date(start));
  }
  const out: Date[] = [];
  const cursor = new Date(start);
  while (out.length < count) {
    if (weekdays.has(cursor.getDay())) {
      out.push(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
  startDate: string;          // YYYY-MM-DD
  endDate?: string;           // YYYY-MM-DD; auto = last race date when omitted
  raceDays: ReadonlySet<number>; // JS getDay() ordering (0=Sun..6=Sat)
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

  // Resolve DNF scoring early so we can fail fast on mixed configs.
  const dnfScoring = resolveDnfScoring(raw, opts);

  const { fleets, fleetIdByName, fleetSystemByName, baseToFleetIds } = buildFleets(
    rawComps, opts.fleetScoringOverrides, opts.includeScratchCompanions,
  );

  const { competitors, compIdByHandle } = buildCompetitors(
    rawComps, fleetIdByName, fleetSystemByName,
  );

  const sortedRaces = sortedRaceHandles(rawRaces);
  const dates = raceDates(parseIsoDate(opts.startDate), sortedRaces.length, opts.raceDays);
  const resultsByRace = groupResultsByRace(rawResults, opts.includeResults);

  const races: RaceBuild[] = [];
  for (let i = 0; i < sortedRaces.length; i++) {
    const [handle, race] = sortedRaces[i];
    const raceDate = dates[i] ?? dates[dates.length - 1] ?? parseIsoDate(opts.startDate);
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
      date: isoDate(raceDate),
      starts,
      finishes,
    });
  }

  const seriesId = cryptoUuid();
  const snapshotId = cryptoUuid();
  const endDateIso = opts.endDate ?? (races.length > 0
    ? races[races.length - 1].date
    : opts.startDate);

  // Mirror buildSeriesFile's omit-when-empty / omit-when-default conventions.
  const anyHasNationality = competitors.some((c) => c.nationality);
  const enabledFields = buildEnabledFields(opts.primaryLabel, { hasNationality: anyHasNationality });

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
      startDate: opts.startDate,
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

  for (const name of seen) {
    const system = overrides.get(name)
      ?? detectScoringSystemForFleet(name)
      ?? 'nhc';
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
    out.push({
      id: cryptoUuid(),
      competitorId: compId,
      sortOrder: null,
      resultCode: mapSailwaveCode(raw.rcod),
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

function buildEnabledFields(
  primary: PrimaryPersonLabel,
  flags: { hasNationality: boolean } = { hasNationality: false },
): SeriesFile['series']['enabledCompetitorFields'] {
  // Sailwave files almost always carry boat name, class, and club. Include
  // helm as a role field only when the primary slot isn't already 'helm' or
  // 'owner' — otherwise it would duplicate the primary.
  const fields: SeriesFile['series']['enabledCompetitorFields'] = ['boatName', 'boatClass', 'club'];
  if (primary !== 'helm' && primary !== 'owner') {
    fields.splice(2, 0, 'helm');
  }
  if (flags.hasNationality) fields.push('nationality');
  // Use the project default if the caller has nothing to override.
  return fields.length > 0 ? fields : defaultEnabledCompetitorFields();
}

function parseIsoDate(s: string): Date {
  // Treat as a local-time midnight so getDay() matches the user's calendar
  // weekday (matching the Python script's date.fromisoformat behaviour).
  const [y, m, d] = s.split('-').map((x) => Number.parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    throw new SailwaveImportError(`Invalid start date "${s}"; expected YYYY-MM-DD.`);
  }
  return new Date(y, m - 1, d);
}

function cryptoUuid(): string {
  return crypto.randomUUID();
}

// Re-export DEFAULT for the wizard form
export { DEFAULT_PRIMARY_PERSON_LABEL };
