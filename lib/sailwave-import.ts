/**
 * Sailwave `.blw` → SeriesFile importer.
 *
 * Source of truth for the Sailwave conversion. (It was originally ported from a
 * standalone Python converter, since removed.) It's been used in anger on real
 * HYC Sailwave 2.38 files, and the choices here (alias collapse, scoring-suffix
 * detection, start fan-out, DNF inference, etc.) are documented in
 * `docs/notes/sailwave/import-behaviour.md`.
 *
 * A Sailwave `.blw` file is the native series document — a flat, four-column
 * CSV of `key,value,compHandle,raceHandle` records. `parseSailwaveBlw` pivots
 * it into the `SailwaveRaw` shape (the same nested structure Sailwave's own
 * JSON export produced) and every downstream step works off that unchanged.
 * Reading `.blw` directly skips the brittle intermediate JSON export, whose
 * trailing commas and bare control chars used to need repairing.
 *
 * Pure module — no DOM, no repository access. The wizard page hands the result
 * to `openSeriesFromFile` from `lib/series-file.ts` so every existing write
 * path, ID remap, and name-disambiguation rule applies unchanged.
 */
import Papa from 'papaparse';
import type {
  DiscardThreshold,
  Fleet,
  PrimaryPersonLabel,
  Prize,
  PrizeClause,
  ResultCode,
  SubdivisionAxis,
} from './types';
import {
  FORMAT_VERSION,
  type SeriesFile,
} from './series-file';
import {
  DEFAULT_PRIMARY_PERSON_LABEL,
  DEFAULT_SUBDIVISION_LABEL,
  defaultEnabledCompetitorFields,
  newSubdivisionAxis,
} from './competitor-fields';
import { getCodeDefinition } from './scoring-codes';
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
  /** Sailwave's native division field. Often unused; when populated it maps to
   *  our subdivision attribute. */
  compdivision?: string;
  /** Helm age band (e.g. "GGM"/"GM"/"M"). Scorers frequently repurpose this as
   *  a prize category and retitle the column (e.g. "Category"). */
  comphelmagegroup?: string;
  /** Helm gender, "Female"/"Male" in the wild. Feeds `Competitor.gender` —
   *  the field gendered prizes ("Lady 1st, 2nd, 3rd") filter on. */
  comphelmsex?: string;
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
  /** CSV of cumulative discard counts indexed by races-sailed − 1, e.g.
   *  `"0,0,0,1,1,1,1,2,..."`. Lives on the root scoring system that
   *  `globals.serscoringhandle` points at; per-fleet child systems set
   *  `scrfollowdiscards: "1"` and inherit it. */
  scrdiscardlist?: string;
  /** Parent scoring-system handle, or `"0"` for the root system. */
  scrparent?: string;
  /** `"1"` when a child system inherits the parent's discard profile. */
  scrfollowdiscards?: string;
  /** `"1"` when a child system inherits the parent's scoring codes. When `"0"`
   *  the child defines its own codes, which may diverge from the root — not
   *  representable, since our `dnfScoring` is a single series-wide setting. */
  scrfollowcodes?: string;
  /** For a per-fleet child system, the fleet value it scopes to (e.g. the class
   *  name). Used to name the fleet in per-fleet divergence warnings. */
  scrvalue?: string;
  scrname?: string;
}

export interface SailwaveRaw {
  header?: { version?: string; generator?: string };
  globals?: Record<string, string>;
  competitors?: Record<string, SailwaveCompetitorRaw>;
  races?: Record<string, SailwaveRaceRaw>;
  results?: Record<string, SailwaveResultRaw>;
  'scoring-systems'?: Record<string, SailwaveScoringSystemRaw>;
  /** Column definitions. Each value is pipe-delimited:
   *  `enabled|FieldName|fieldId|showInGrid|publish|width|customTitle|`.
   *  We read it only to recover a scorer's custom column titles (e.g. a
   *  `HelmAgeGroup` column retitled "Category"). */
  columns?: Record<string, string>;
  /** Prize definitions, one raw row each: `count|label|expr` where `expr` is
   *  six caret-separated field/value pairs followed by six per-clause
   *  operators. In file order (Sailwave freezes prize order at entry). */
  prizes?: string[];
}

// ---- Constants (mirror Python) ----

export type ScoringSystem = Fleet['scoringSystem'];

/** Fleet name used for competitors whose `compfleet` is blank. Sailwave lets a
 *  scorer enter boats without ever creating a named fleet — the normal shape
 *  for a single one-design class or a pre-event entry list. Without this they
 *  resolve to no fleet and get silently dropped on import. Matches the CSV
 *  importer's no-fleet fallback (`PLAN_DEFAULT_FLEET_NAME`). */
const DEFAULT_FLEET_NAME = 'Default';

/** A competitor's fleet name, falling back to the default fleet when Sailwave
 *  left `compfleet` blank. */
function fleetNameOf(c: SailwaveCompetitorRaw): string {
  return (c.compfleet ?? '').trim() || DEFAULT_FLEET_NAME;
}

/** Sailwave appends one of these suffixes to compfleet to encode the scoring
 *  system for that fleet. Bare names (no suffix) default to NHC.
 *
 *  HYC abbreviates the scratch fleet as " Scr" in their 2026 files but spells
 *  it out as " Scratch" in the 2024/2025 files — both must resolve to scratch.
 *  Longer suffixes are listed first so endsWith() matches " Scratch" before its
 *  " Scr" prefix would (it never would here — endsWith is anchored at the end —
 *  but the ordering keeps fleetBaseName's strip unambiguous). */
const SCORING_SUFFIX_TO_SYSTEM: ReadonlyArray<readonly [string, ScoringSystem]> = [
  [' HPH', 'nhc'],
  [' IRC', 'irc'],
  [' Scratch', 'scratch'],
  [' Scr', 'scratch'],
];

const VALID_SCORING_SYSTEMS: ReadonlySet<ScoringSystem> = new Set([
  'scratch', 'irc', 'py', 'nhc', 'echo',
]);

const SAILWAVE_METHOD_SERIES_PLUS = 'Boats in series +';
const SAILWAVE_METHOD_RACE_PLUS = 'Boats in race +';
const SAILWAVE_METHOD_FINISHERS_PLUS = 'Finishers +';
const SAILWAVE_METHOD_SCORE_LIKE = 'Score like';

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

// ---- Parse ----

/** Row scopes in a `.blw` file, decided by the record key and which handle
 *  columns are populated. `scr*` (scoring-system) rows carry their system
 *  handle in the *same* column competitors use for theirs, so the key prefix —
 *  not the column layout — is what disambiguates them. */

/** Parse a Sailwave `.blw` file into the `SailwaveRaw` shape.
 *
 *  The file is a four-column CSV — `key,value,compHandle,raceHandle` — with one
 *  flat record per row. We decode windows-1252 (Sailwave saves on Windows and
 *  helm names may carry non-UTF-8 bytes), parse the CSV, then pivot rows into
 *  the nested structure by key prefix and handle columns:
 *    - `comp*`    → `competitors[compHandle][key]`
 *    - `race*`    → `races[raceHandle][key]` (`racestart` → that race's starts)
 *    - `scrcode`  → a scoring code; its system handle is embedded in the
 *                   pipe-delimited value (field 14), not the handle columns
 *    - `scr*`     → `scoring-systems[compHandle][key]` (the system handle lives
 *                   in the competitor-handle column)
 *    - both handles set → a result cell (`comHandle`/`racHandle` recovered from
 *                   the columns so the builder can join it to comp + race)
 *    - `column`   → appended to `columns` in file order
 *    - otherwise  → a series-level `globals[key]` */
export function parseSailwaveBlw(bytes: ArrayBuffer): SailwaveRaw {
  const text = new TextDecoder('windows-1252').decode(bytes);
  const { data } = Papa.parse<string[]>(text, {
    delimiter: ',',
    skipEmptyLines: true,
  });

  const globals: Record<string, string> = {};
  const columns: Record<string, string> = {};
  const prizeRows: string[] = [];
  const competitors: Record<string, Record<string, string>> = {};
  const races: Record<string, Record<string, string>> = {};
  const raceStarts: Record<string, string[]> = {};
  const results: Record<string, SailwaveResultRaw> = {};
  const systemFields: Record<string, Record<string, string>> = {};
  const systemCodes: Record<string, Record<string, { method?: string; value?: string }>> = {};

  let columnSeq = 0;

  for (const row of data) {
    if (!row || row.length === 0) continue;
    const key = (row[0] ?? '').trim();
    if (!key) continue;
    const value = row[1] ?? '';
    const compHandle = (row[2] ?? '').trim();
    const raceHandle = (row[3] ?? '').trim();

    if (key === 'column') {
      columns[String(++columnSeq)] = value;
      continue;
    }
    if (key === 'prize') {
      prizeRows.push(value);
      continue;
    }
    if (key === 'scrcode') {
      // Pipe-delimited: `code|method|value|...|systemHandle(idx 14)|...`. The
      // builder only reads method + value (for A5.2/A5.3 DNF inference); the
      // rest of the row is carried by Sailwave but unused here.
      const parts = value.split('|');
      const code = (parts[0] ?? '').trim();
      const handle = (parts[14] ?? '').trim();
      if (code && handle) {
        (systemCodes[handle] ??= {})[code] = { method: parts[1] ?? '', value: parts[2] ?? '' };
      }
      continue;
    }
    if (key.startsWith('scr')) {
      if (compHandle) (systemFields[compHandle] ??= {})[key] = value;
      continue;
    }
    if (key.startsWith('comp')) {
      if (compHandle) (competitors[compHandle] ??= {})[key] = value;
      continue;
    }
    if (key === 'racestart') {
      if (raceHandle) (raceStarts[raceHandle] ??= []).push(value);
      continue;
    }
    if (key.startsWith('race')) {
      if (raceHandle) (races[raceHandle] ??= {})[key] = value;
      continue;
    }
    if (compHandle && raceHandle) {
      const resultKey = `${compHandle}:${raceHandle}`;
      const cell = (results[resultKey] ??= { comHandle: compHandle, racHandle: raceHandle });
      (cell as Record<string, string>)[key] = value;
      continue;
    }
    globals[key] = value;
  }

  // A `.blw` carries no `header` section to identify it; instead require at
  // least one series-level (`ser*`) record, which every Sailwave file writes.
  // A non-Sailwave CSV won't carry those keys.
  if (!Object.keys(globals).some((k) => k.startsWith('ser'))) {
    throw new SailwaveImportError(
      "This doesn't look like a Sailwave .blw file — no Sailwave series records were found.",
    );
  }

  const scoringSystems: Record<string, SailwaveScoringSystemRaw> = {};
  for (const handle of new Set([...Object.keys(systemFields), ...Object.keys(systemCodes)])) {
    const system = { ...(systemFields[handle] ?? {}) } as SailwaveScoringSystemRaw;
    if (systemCodes[handle]) system['scoring-codes'] = systemCodes[handle];
    scoringSystems[handle] = system;
  }

  const racesOut: Record<string, SailwaveRaceRaw> = {};
  for (const handle of new Set([...Object.keys(races), ...Object.keys(raceStarts)])) {
    const race = { ...(races[handle] ?? {}) } as SailwaveRaceRaw;
    const starts = raceStarts[handle];
    if (starts) {
      const startsByIndex: Record<string, string> = {};
      starts.forEach((s, i) => { startsByIndex[String(i + 1)] = s; });
      race.starts = startsByIndex;
    }
    racesOut[handle] = race;
  }

  return {
    header: { version: globals.serversion, generator: 'sailwave' },
    globals,
    competitors: competitors as Record<string, SailwaveCompetitorRaw>,
    races: racesOut,
    results,
    'scoring-systems': scoringSystems,
    columns,
    ...(prizeRows.length > 0 ? { prizes: prizeRows } : {}),
  };
}

// ---- Column definitions & subdivision detection ----

/** A parsed Sailwave column definition. We only need the custom title; the
 *  visibility flags are kept for completeness / future use. */
export interface SailwaveColumn {
  fieldName: string;
  /** Scorer-set custom title; empty string when the column uses its default. */
  title: string;
  visible: boolean;
  publish: boolean;
}

/** Parse the `columns` section into a map keyed by Sailwave field name. Each
 *  raw value is `enabled|FieldName|fieldId|showInGrid|publish|width|title|`. */
export function parseSailwaveColumns(raw: SailwaveRaw): Map<string, SailwaveColumn> {
  const out = new Map<string, SailwaveColumn>();
  for (const def of Object.values(raw.columns ?? {})) {
    const parts = def.split('|');
    const fieldName = (parts[1] ?? '').trim();
    if (!fieldName) continue;
    out.set(fieldName, {
      fieldName,
      title: (parts[6] ?? '').trim(),
      visible: (parts[3] ?? '').trim().toLowerCase() === 'yes',
      publish: (parts[4] ?? '').trim().toLowerCase() === 'yes',
    });
  }
  return out;
}

/** One detected subdivision axis: the raw competitor key feeding it and the
 *  label to head it. */
export interface SubdivisionAxisSource {
  sourceKey: 'compdivision' | 'comphelmagegroup' | 'compclass';
  label: string;
}

/** Custom `Class` titles that signal the column holds a prize category, not a
 *  boat class. Deliberately a narrow vocabulary: a cosmetic rename that keeps
 *  the boat-class meaning (HYC retitles it "Model" for Puppeteer 22 / J/24
 *  keelboats) must stay `boatClass`, and an unrecognised title falls back to
 *  the same — no worse than before, and visible in the wizard either way. */
const CATEGORY_CLASS_TITLES = new Set(['cat', 'category', 'division', 'div', 'group', 'grade', 'band']);

/** True when the scorer retitled the `Class` column with category vocabulary —
 *  the signal that the field has been repurposed (the 2026 ILCA Leinsters
 *  retitles it "Cat" and stores the prize age category there). A repurposed
 *  Class imports as a subdivision axis labelled by that title, not as
 *  `boatClass`. */
export function classColumnRepurposed(columns: Map<string, SailwaveColumn>): boolean {
  const title = (columns.get('Class')?.title ?? '').trim();
  return CATEGORY_CLASS_TITLES.has(title.toLowerCase());
}

/** Detect the subdivision axes a Sailwave file carries — Sailwave's native
 *  Division field, the helm age-group field (commonly repurposed as a prize
 *  category and retitled, e.g. "Category"), and a retitled Class column (see
 *  {@link classColumnRepurposed}) — each as an independent axis when
 *  populated. Each label comes from the column's custom title when the scorer
 *  set one, else a sensible per-source default. Empty when the file carries no
 *  subdivision data. */
export function resolveSubdivisionAxes(
  comps: Record<string, SailwaveCompetitorRaw>,
  columns: Map<string, SailwaveColumn>,
): SubdivisionAxisSource[] {
  const anyPopulated = (key: keyof SailwaveCompetitorRaw): boolean =>
    Object.values(comps).some(
      (c) => c.compexclude !== '1' && !!(c[key] ?? '').trim(),
    );
  const titleFor = (field: string, fallback: string): string =>
    columns.get(field)?.title || fallback;

  const axes: SubdivisionAxisSource[] = [];
  if (anyPopulated('compdivision')) {
    axes.push({ sourceKey: 'compdivision', label: titleFor('Division', DEFAULT_SUBDIVISION_LABEL) });
  }
  if (anyPopulated('comphelmagegroup')) {
    axes.push({ sourceKey: 'comphelmagegroup', label: titleFor('HelmAgeGroup', 'Category') });
  }
  if (classColumnRepurposed(columns) && anyPopulated('compclass')) {
    axes.push({ sourceKey: 'compclass', label: columns.get('Class')!.title });
  }
  return axes;
}

// ---- Prize definitions (#240) ----

/** A prize resolved from a Sailwave `prize` row, id-free: fleet clauses by
 *  name and axis clauses by source field, so the same resolution drives both
 *  the wizard preview and the builder (which mints the actual ids). */
export interface SailwavePrizeSpec {
  label: string;
  count: number;
  clauses: Array<
    | { kind: 'fleet'; fleetName: string }
    | { kind: 'axis'; sourceKey: SubdivisionAxisSource['sourceKey']; label: string; value: string }
    | { kind: 'rank'; max: number }
    | { kind: 'gender'; value: 'M' | 'F' }
    | { kind: 'nationality'; value: string }
    | { kind: 'club'; value: string }
  >;
}

/** A prize row our predicate can't faithfully express. The import proceeds
 *  without the prize (never with a widened predicate); the wizard surfaces
 *  these so the scorer knows to recreate it in-app. */
export interface SailwavePrizeWarning {
  label: string;
  detail: string;
}

/**
 * Resolve Sailwave's prize rows (`count|label|expr`, expr = six field^value
 * pairs then six per-clause operators) into id-free prize specs. Field
 * mapping: `Fleet` (by name), `Rank` (`<=`, or `=` against 1), `Division` /
 * `HelmAgeGroup` → their subdivision axes, `Class` → its axis only when the
 * column is category-retitled (see {@link classColumnRepurposed}), `HelmSex`
 * → gender, `Nat` → nationality, `Club` → club. A row with any unmappable
 * clause is skipped whole with a warning.
 */
export function resolveSailwavePrizes(
  prizeRows: string[],
  columns: Map<string, SailwaveColumn>,
  fleetNames: ReadonlySet<string>,
): { specs: SailwavePrizeSpec[]; warnings: SailwavePrizeWarning[] } {
  const specs: SailwavePrizeSpec[] = [];
  const warnings: SailwavePrizeWarning[] = [];
  const titleFor = (field: string, fallback: string): string =>
    columns.get(field)?.title || fallback;

  for (const row of prizeRows) {
    const [countRaw, labelRaw, expr = ''] = row.split('|');
    const label = (labelRaw ?? '').trim();
    const count = Number.parseInt((countRaw ?? '').trim(), 10);
    if (!label || !Number.isInteger(count) || count < 1) {
      warnings.push({ label: label || row, detail: 'malformed prize row' });
      continue;
    }

    const slots = expr.split('^');
    const clauses: SailwavePrizeSpec['clauses'] = [];
    let skip: string | null = null;
    for (let i = 0; i < 6 && skip === null; i++) {
      const field = (slots[i * 2] ?? '').trim();
      const value = (slots[i * 2 + 1] ?? '').trim();
      const op = (slots[12 + i] ?? '=').trim();
      if (!field) continue;

      if (field === 'Rank') {
        const max = Number.parseInt(value, 10);
        if (!Number.isInteger(max) || max < 1) skip = `rank condition against "${value}"`;
        else if (op === '<=' || (op === '=' && max === 1)) clauses.push({ kind: 'rank', max });
        else skip = `rank operator "${op}"`;
        continue;
      }
      // Everything below is an equality test.
      if (op !== '=') {
        skip = `operator "${op}" on ${field}`;
        continue;
      }
      switch (field) {
        case 'Fleet':
          if (fleetNames.has(value)) clauses.push({ kind: 'fleet', fleetName: value });
          else skip = `unknown fleet "${value}"`;
          break;
        case 'Division':
          clauses.push({ kind: 'axis', sourceKey: 'compdivision', label: titleFor('Division', DEFAULT_SUBDIVISION_LABEL), value });
          break;
        case 'HelmAgeGroup':
          clauses.push({ kind: 'axis', sourceKey: 'comphelmagegroup', label: titleFor('HelmAgeGroup', 'Category'), value });
          break;
        case 'Class':
          if (classColumnRepurposed(columns)) {
            clauses.push({ kind: 'axis', sourceKey: 'compclass', label: columns.get('Class')!.title, value });
          } else {
            skip = `condition on the Class column (a boat class here, not a category)`;
          }
          break;
        case 'HelmSex': {
          const gender = genderFromHelmSex(value);
          if (gender === '') skip = `helm gender "${value}"`;
          else clauses.push({ kind: 'gender', value: gender });
          break;
        }
        case 'Nat':
          clauses.push({ kind: 'nationality', value });
          break;
        case 'Club':
          clauses.push({ kind: 'club', value });
          break;
        default:
          skip = `condition on the ${field} field`;
      }
    }

    if (skip !== null) {
      warnings.push({ label, detail: `not imported — ${skip} can't be expressed` });
      continue;
    }
    specs.push({ label, count, clauses });
  }

  return { specs, warnings };
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
  /** Discard profile detected from Sailwave's root scoring system. Empty when
   *  Sailwave defines no discards (or its config is missing). Shown as a
   *  detected default the scorer can override in Settings after import. */
  detectedDiscardThresholds: DiscardThreshold[];
  hasResults: boolean;
  /** Labels of the detected subdivision axes (custom column title, else a
   *  per-source default), in order. Empty when the file carries no subdivision
   *  data. Shown in the wizard as the columns that will be imported. */
  detectedSubdivisionLabels: string[];
  /** True when at least one competitor carries a recognisable `comphelmsex`
   *  value — the wizard notes that helm gender will be imported. */
  hasHelmGender: boolean;
  /** Prizes that will import (#240) — the expressible rows of Sailwave's
   *  prize table. */
  detectedPrizeCount: number;
  /** Prize rows our predicate can't express, skipped with a reason. */
  prizeWarnings: SailwavePrizeWarning[];
  /** Warnings for scoring-code configuration our engine can't faithfully
   *  reproduce (finishers base, mixed A5.2/A5.3, per-fleet overrides, …).
   *  Empty when the config is fully representable. The import still proceeds
   *  with the closest mode; the wizard surfaces these so the scorer knows. */
  scoringWarnings: SailwaveScoringWarning[];
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
    const name = fleetNameOf(c);
    if (!fleetNames.includes(name)) fleetNames.push(name);
  }
  // Sort so the wizard's proposed fleet list reads naturally and matches the
  // alphabetical order buildFleets() produces for the imported series.
  fleetNames.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

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

  const subdivisionAxisSources = resolveSubdivisionAxes(comps, parseSailwaveColumns(raw));
  const scoring = analyzeSailwaveScoring(raw);
  const prizeResolution = resolveSailwavePrizes(
    raw.prizes ?? [],
    parseSailwaveColumns(raw),
    new Set(fleetNames),
  );

  return {
    name: (globals.serevent ?? '').trim(),
    venue: (globals.servenue ?? '').trim(),
    competitorCount,
    raceCount: Object.keys(races).length,
    fleets,
    detectedDnfScoring: scoring.dnfScoring,
    detectedDiscardThresholds: parseDiscardThresholds(raw),
    // A `.blw` carries a cell for every competitor×race even when nothing has
    // been sailed (rrestyp=0), so "any cell exists" overcounts. Only report
    // results when at least one is actually entered.
    hasResults: Object.values(results).some(
      (r) => (r.rrestyp ?? SAILWAVE_RRESTYP_NO_RESULT) !== SAILWAVE_RRESTYP_NO_RESULT,
    ),
    detectedSubdivisionLabels: subdivisionAxisSources.map((a) => a.label),
    hasHelmGender: Object.values(comps).some(
      (c) => c.compexclude !== '1' && genderFromHelmSex(c.comphelmsex) !== '',
    ),
    detectedPrizeCount: prizeResolution.specs.length,
    prizeWarnings: prizeResolution.warnings,
    scoringWarnings: scoring.warnings,
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
    const name = fleetNameOf(c);
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

// ---- Scoring-code configuration analysis (A5.2 / A5.3 & representability) ----

/** Resolve a Sailwave scoring code to the entry that actually defines its
 *  method, following `Score like` redirects (DNS → DNF → …). Returns null when
 *  the code is undefined or the chain loops. */
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

/** The scoring base a Sailwave method resolves to. `series`/`race`/`finishers`
 *  are the count the `+ N` places is added to; `nonpositional` is a recognised
 *  penalty/average/manual method (how RRS penalty and redress codes are set,
 *  which our engine models separately); `unknown` is a method string we can't
 *  read. */
type SailwaveCodeBase =
  | { kind: 'series' | 'race' | 'finishers'; n: number }
  | { kind: 'nonpositional' }
  | { kind: 'unknown'; method: string };

/** Recognised Sailwave methods that don't score from a fleet-count base —
 *  penalties, averages, and manual points. These configure RRS penalty/redress
 *  codes (SCP, ZFP, DPI, RDG, OOD), which our engine handles on their own terms,
 *  so they need no A5.2/A5.3 base. Matched by prefix — `Percentage penalty DNF`,
 *  `Average (all)`, `Average (before)`. */
function isRecognisedNonPositionalMethod(method: string): boolean {
  return method === 'Fixed penalty'
    || method === 'Set points by hand'
    || method.startsWith('Percentage penalty')
    || method.startsWith('Average');
}

function classifySailwaveMethod(entry: { method?: string; value?: string }): SailwaveCodeBase {
  const method = (entry.method ?? '').trim();
  const value = (entry.value ?? '').trim();
  const n = Number.parseInt(value, 10);
  const positional = (kind: 'series' | 'race' | 'finishers'): SailwaveCodeBase =>
    Number.isFinite(n) ? { kind, n } : { kind: 'unknown', method: `${method} ${value}`.trim() };
  if (method === SAILWAVE_METHOD_SERIES_PLUS) return positional('series');
  if (method === SAILWAVE_METHOD_RACE_PLUS) return positional('race');
  if (method === SAILWAVE_METHOD_FINISHERS_PLUS) return positional('finishers');
  if (isRecognisedNonPositionalMethod(method)) return { kind: 'nonpositional' };
  return { kind: 'unknown', method: method || '(none)' };
}

/** A stable key identifying a base, for grouping and cross-system comparison. */
function baseSignature(base: SailwaveCodeBase): string {
  switch (base.kind) {
    case 'series':
    case 'race':
    case 'finishers':
      return `${base.kind}:${base.n}`;
    case 'nonpositional':
      return 'nonpositional';
    case 'unknown':
      return `unknown:${base.method}`;
  }
}

/** Scorer-facing description of a base, e.g. "race finishers + 2". */
function describeBase(base: SailwaveCodeBase): string {
  switch (base.kind) {
    case 'series': return `series entries + ${base.n}`;
    case 'race': return `boats in the race + ${base.n}`;
    case 'finishers': return `race finishers + ${base.n}`;
    case 'nonpositional': return 'a penalty/average method';
    case 'unknown': return `an unrecognised method (${base.method})`;
  }
}

/** The series-wide `dnfScoring` a starters-base code implies, or null when the
 *  code's base isn't one our engine can represent. */
function baseToDnfChoice(base: SailwaveCodeBase): 'seriesEntries' | 'startingArea' | null {
  if (base.kind === 'series' && base.n === 1) return 'seriesEntries';
  if (base.kind === 'race' && base.n === 1) return 'startingArea';
  return null;
}

function describeDnfChoice(choice: 'seriesEntries' | 'startingArea' | null): string {
  if (choice === 'seriesEntries') return 'A5.2 — series entries + 1';
  if (choice === 'startingArea') return 'A5.3 — boats that came to the start + 1';
  return 'A5.2 — series entries + 1';
}

/** The Sailwave codes we map to a Sail Scoring code scored by a fleet-count base
 *  (`fixed_penalty`), paired with that code's engine base. These are the codes
 *  whose Sailwave configuration must line up with one of our A5.2/A5.3 modes.
 *  Codes our engine scores as additive penalties or redress (SCP/ZFP/DPI/RDG)
 *  are excluded — their Sailwave method is recognised but handled separately.
 *  Read from the engine's own registry so the bases can't drift out of sync
 *  (e.g. BFD is a starters-base code, not entries). */
const SAILWAVE_FIXED_PENALTY_CODES: ReadonlyArray<{ sailwave: string; base: 'entries' | 'starters' }> =
  Object.entries(SAILWAVE_TO_SAILSCORING_CODE).flatMap(([sailwave, sc]) => {
    const method = getCodeDefinition(sc)?.pointsMethod;
    return method?.type === 'fixed_penalty' ? [{ sailwave, base: method.penaltyBase }] : [];
  });

/** A warning that the Sailwave scoring-code configuration can't be faithfully
 *  reproduced by our engine. Surfaced in the import wizard; never blocks the
 *  import (the closest representable mode is applied). */
export interface SailwaveScoringWarning {
  /** `unrepresentable` — a recognised method with no engine equivalent (a
   *  finishers base, a `+ N` with N≠1, a mixed A5.2/A5.3 config).
   *  `unrecognised` — a scoring method string we don't know how to read.
   *  `perFleet` — a per-fleet scoring system whose codes diverge from the root;
   *  we apply one series-wide setting. */
  kind: 'unrepresentable' | 'unrecognised' | 'perFleet';
  /** The Sailwave code the warning concerns, when it's about a single code. */
  code?: string;
  /** The fleet whose scoring system diverges, for `perFleet` warnings. */
  fleet?: string;
  /** Scorer-facing explanation. */
  detail: string;
}

export interface SailwaveScoringAnalysis {
  /** The closest representable series-wide DNF base, or null when Sailwave's
   *  config is missing/unrecognised (the caller then defaults to seriesEntries). */
  dnfScoring: 'seriesEntries' | 'startingArea' | null;
  warnings: SailwaveScoringWarning[];
}

/** Analyse one system's scoring codes: which A5.2/A5.3 choices its
 *  starters-base codes imply, and warnings for any code whose base our engine
 *  can't reproduce. Warnings are grouped by base so a set of `Score like DNF`
 *  codes collapse into one line rather than nine near-identical ones. */
function analyzeSystemCodes(
  codes: Record<string, { method?: string; value?: string }>,
): { choices: Set<'seriesEntries' | 'startingArea'>; warnings: SailwaveScoringWarning[] } {
  const choices = new Set<'seriesEntries' | 'startingArea'>();
  const groups = new Map<
    string,
    { kind: 'unrepresentable' | 'unrecognised'; base: SailwaveCodeBase; engineBase: 'entries' | 'starters'; codes: string[] }
  >();

  for (const { sailwave, base: engineBase } of SAILWAVE_FIXED_PENALTY_CODES) {
    const resolved = resolveSailwaveCode(codes, sailwave);
    if (!resolved) continue;
    const base = classifySailwaveMethod(resolved);

    const representable = engineBase === 'entries'
      ? base.kind === 'series' && base.n === 1
      : baseToDnfChoice(base) !== null;
    if (representable) {
      if (engineBase === 'starters') choices.add(baseToDnfChoice(base)!);
      continue;
    }

    const sig = `${engineBase}|${baseSignature(base)}`;
    const group = groups.get(sig)
      ?? { kind: base.kind === 'unknown' ? 'unrecognised' as const : 'unrepresentable' as const, base, engineBase, codes: [] };
    group.codes.push(sailwave);
    groups.set(sig, group);
  }

  const warnings = [...groups.values()].map((g): SailwaveScoringWarning => {
    const list = [...g.codes].sort();
    const codeList = list.join(', ');
    const subject = list.length === 1 ? list[0] : `Codes ${codeList}`;
    const verb = list.length === 1 ? 'is' : 'are';
    let detail: string;
    if (g.kind === 'unrecognised') {
      detail = `${subject} ${verb} configured with a scoring method Sail Scoring doesn't recognise (${g.base.kind === 'unknown' ? g.base.method : describeBase(g.base)}).`;
    } else if (g.engineBase === 'entries') {
      detail = `${subject} ${verb} scored as ${describeBase(g.base)}; Sail Scoring always scores ${list.length === 1 ? 'it' : 'them'} as series entries + 1.`;
    } else {
      detail = `${subject} ${verb} scored as ${describeBase(g.base)}, which Sail Scoring can't reproduce — it scores ${list.length === 1 ? 'it' : 'them'} as either series entries + 1 (A5.2) or boats that came to the start + 1 (A5.3).`;
    }
    return { kind: g.kind, ...(list.length === 1 ? { code: list[0] } : {}), detail };
  });

  return { choices, warnings };
}

/** Whether a child system's codes resolve any representable-base code
 *  differently from the root — including a code defined in one but not the
 *  other. */
function codesDifferFromRoot(
  childCodes: Record<string, { method?: string; value?: string }>,
  rootCodes: Record<string, { method?: string; value?: string }>,
): boolean {
  const sigOf = (codes: Record<string, { method?: string; value?: string }>, code: string): string => {
    const resolved = resolveSailwaveCode(codes, code);
    return resolved ? baseSignature(classifySailwaveMethod(resolved)) : 'absent';
  };
  return SAILWAVE_FIXED_PENALTY_CODES.some(
    ({ sailwave }) => sigOf(childCodes, sailwave) !== sigOf(rootCodes, sailwave),
  );
}

/** Inspect a Sailwave file's full scoring-code configuration — the root system
 *  and any per-fleet child systems — reporting the closest representable
 *  series-wide DNF base plus warnings for anything our engine can't reproduce.
 *  Pure inspection: it never runs the scoring engine or blocks the import. */
export function analyzeSailwaveScoring(raw: SailwaveRaw): SailwaveScoringAnalysis {
  const globals = raw.globals ?? {};
  const rootHandle = globals.serscoringhandle;
  const systems = raw['scoring-systems'] ?? {};
  if (!rootHandle || !(rootHandle in systems)) {
    return { dnfScoring: null, warnings: [] };
  }
  const rootCodes = systems[rootHandle]?.['scoring-codes'] ?? {};
  const warnings: SailwaveScoringWarning[] = [];

  // DNF drives the series-wide choice — it's the code scorers read A5.2/A5.3
  // off. Codes that `Score like DNF` follow it; independent codes are checked
  // for agreement below.
  const dnfResolved = resolveSailwaveCode(rootCodes, 'DNF');
  const dnfChoice = dnfResolved ? baseToDnfChoice(classifySailwaveMethod(dnfResolved)) : null;

  const { choices, warnings: codeWarnings } = analyzeSystemCodes(rootCodes);
  warnings.push(...codeWarnings);

  const chosen = dnfChoice ?? [...choices][0] ?? null;
  if (choices.size > 1) {
    warnings.push({
      kind: 'unrepresentable',
      detail: `Scoring codes disagree on the penalty base — some use series entries + 1 (A5.2), others boats in the race + 1 (A5.3). Sail Scoring applies one setting series-wide (${describeDnfChoice(chosen)}).`,
    });
  }

  // Per-fleet child systems that define their own codes differing from the root.
  // A child that follows the root (`scrfollowcodes: "1"`) inherits it — fine.
  for (const [handle, sys] of Object.entries(systems)) {
    if (handle === rootHandle) continue;
    if (sys.scrparent !== rootHandle) continue;
    if (sys.scrfollowcodes === '1') continue;
    const childCodes = sys['scoring-codes'];
    if (!childCodes || !codesDifferFromRoot(childCodes, rootCodes)) continue;
    const fleet = (sys.scrvalue ?? sys.scrname ?? '').trim() || handle;
    warnings.push({
      kind: 'perFleet',
      fleet,
      detail: `Fleet "${fleet}" uses its own scoring-code configuration that differs from the rest of the series. Sail Scoring applies one series-wide setting, so this fleet may score differently.`,
    });
  }

  return { dnfScoring: chosen, warnings };
}

// ---- Discard profile detection ----

/** Detect the series-wide discard profile from Sailwave's root scoring system.
 *
 *  `globals.serscoringhandle` points at the root system (`scrparent: "0"`),
 *  whose `scrdiscardlist` is a CSV indexed by races-sailed − 1: the value is
 *  the number of discards once that many races have been sailed. Per-fleet
 *  child systems carry `scrfollowdiscards: "1"` and inherit the root, so the
 *  root list is complete — and our `discardThresholds` is series-wide anyway,
 *  so per-fleet variation isn't representable.
 *
 *  Run-length compress the list into `DiscardThreshold[]` — emit a threshold at
 *  each step-up, matching how `getDiscardCount` picks the highest
 *  `minRaces ≤ raceCount`. Returns `[]` when the list is absent or all-zero. */
export function parseDiscardThresholds(raw: SailwaveRaw): DiscardThreshold[] {
  const globals = raw.globals ?? {};
  const handle = globals.serscoringhandle;
  const systems = raw['scoring-systems'] ?? {};
  if (!handle || !(handle in systems)) return [];
  const list = systems[handle]?.scrdiscardlist;
  if (!list) return [];

  const counts: number[] = [];
  for (const token of list.split(',')) {
    const trimmed = token.trim();
    if (trimmed === '') continue;
    const n = Number.parseInt(trimmed, 10);
    // Malformed list — fall back to no discards; the scorer sets them in
    // Settings. Position is significant, so we can't skip a bad token.
    if (!Number.isFinite(n)) return [];
    counts.push(n);
  }

  const thresholds: DiscardThreshold[] = [];
  let prev = 0;
  counts.forEach((v, i) => {
    if (v !== prev) {
      thresholds.push({ minRaces: i + 1, discardCount: v });
      prev = v;
    }
  });
  return thresholds;
}

// ---- Race dates ----

/** Parse a Sailwave `racedate` string into ISO `YYYY-MM-DD`, given the
 *  series-level `serdatespec` hint (e.g. `"d-m-y"`, `"m-d-y"`, `"y-m-d"`).
 *  Returns null for blank or unparseable values — the wizard falls back to
 *  its optional default date in that case.
 *
 *  Supported separators: `-` `/` `.` `,` `<space>`. Word-month forms like
 *  "May 19th", "19 May", or "May 19 2026" are recognised, including ordinal
 *  suffixes. Two-digit years are pinned to the 21st century (`26` → `2026`).
 *  Year-less variants like "May 5th" or "07-05" carry no year of their own;
 *  pass `yearHint` (typically the import's default/series year) to resolve
 *  them — without it they parse as null. */
export function parseSailwaveRaceDate(
  racedate: string | undefined,
  datespec: string | undefined,
  yearHint?: number,
): string | null {
  if (!racedate) return null;
  const trimmed = racedate.trim();
  if (!trimmed) return null;

  // Word-month forms ("May 19th", "19 May 2026") never look like a numeric
  // triple, so try them first; this returns null for all-numeric input and
  // falls through to the numeric path below.
  const wordParsed = parseWordMonthDate(trimmed, yearHint);
  if (wordParsed) return wordParsed;

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

const MONTH_BY_PREFIX: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Parse a word-month date such as "May 19th", "19 May", "May 19 2026", or
 *  "19th May 2026". The day may carry an ordinal suffix (st/nd/rd/th). When
 *  the text omits a year, `yearHint` supplies it; without a hint, a year-less
 *  word-month date is unresolvable and returns null. Returns null for any
 *  input that doesn't contain a month name (numeric triples fall through to
 *  the numeric parser). */
function parseWordMonthDate(input: string, yearHint?: number): string | null {
  const tokens = input.split(/[-/.,\s]+/).filter(Boolean);
  if (tokens.length < 2) return null;

  let month: number | undefined;
  let day: number | undefined;
  let year: number | undefined;

  for (const tok of tokens) {
    const lower = tok.toLowerCase();
    if (/^[a-z]+$/.test(lower)) {
      const m = MONTH_BY_PREFIX[lower.slice(0, 3)];
      if (m === undefined || month !== undefined) return null;
      month = m;
      continue;
    }
    const numMatch = lower.match(/^(\d+)(?:st|nd|rd|th)?$/);
    if (!numMatch) return null;
    const n = Number.parseInt(numMatch[1], 10);
    if (numMatch[1].length >= 3 || n > 31) {
      if (year !== undefined) return null;
      year = n;
    } else if (day === undefined) {
      day = n;
    } else if (year === undefined) {
      year = n;
    } else {
      return null;
    }
  }

  if (month === undefined || day === undefined) return null;
  if (year === undefined) {
    if (yearHint === undefined) return null;
    year = yearHint;
  }
  if (year < 100) year += 2000;
  if (day < 1 || day > 31) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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

/** Seconds-since-midnight for a normalised HH:MM:SS string, or null if it
 *  isn't a clean three-part time. Used to order finishes by crossing time. */
function colonTimeToSeconds(t: string | null): number | null {
  if (!t) return null;
  const parts = t.split(':').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [h, m, s] = parts;
  return h * 3600 + m * 60 + s;
}

// ---- Start string parsing ----

/** Sailwave starts payload format:
 *    'Fleet^Puppeteer HPH^...^=^=...|19.15.00|Finish time|Start 1|||0|...'
 *  Pipe-segment 0 lists the fleet(s) the gun covers as repeated 'Fleet^<NAME>'
 *  pairs; segment 1 is the gun time. One gun can cover several fleets, which
 *  Sailwave writes by chaining the pairs — the 2024/2025 HYC files share a
 *  single Puppeteer gun across both scoring fleets as
 *  'Fleet^Puppeteer Scratch^^^Fleet^Puppeteer HPH^...'. A combined start (one
 *  gun for every fleet in the race, as cruiser divisions usually share) has an
 *  empty segment 0 — no 'Fleet^...' prefix at all — e.g.
 *  '|10.35.00|Finish time|Start 1|...'. We return every named fleet in
 *  `fleetNames` (empty for the combined case, so the caller fans it out to all
 *  fleets). Returns null only when there's no parseable gun time. */
export function parseStartString(s: string): { fleetNames: string[]; startTime: string } | null {
  const parts = s.split('|');
  if (parts.length < 2) return null;
  const startTime = sailwaveTimeToColon(parts[1]);
  if (!startTime) return null;
  const head = parts[0].split('^');
  const fleetNames: string[] = [];
  for (let i = 0; i + 1 < head.length; i++) {
    if (head[i] !== 'Fleet') continue;
    const name = head[i + 1].trim();
    if (name && !fleetNames.includes(name)) fleetNames.push(name);
  }
  return { fleetNames, startTime };
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
  /** Override the label for the imported subdivision column. When omitted, the
   *  detected label (custom column title, else a per-source default) is used.
   *  Ignored when the file carries no subdivision data. */
  subdivisionLabel?: string;
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
  subdivisions?: Record<string, string>;
  gender: 'M' | 'F' | '';
  // Sailwave has no numeric helm-age column — ages live as categorisations
  // (comphelmagegroup, imported as a subdivision axis), so there is nothing
  // to feed `Competitor.age` from.
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
  // Year hint for word-month, year-less racedates ("May 19th"): use the
  // default date's year, which is the scorer-provided series year (or today).
  const yearHint = Number.parseInt(defaultDate.slice(0, 4), 10) || undefined;

  const dnfScoring = resolveDnfScoring(raw, opts);

  const { fleets, fleetIdByName, fleetSystemByName, baseToFleetIds } = buildFleets(
    rawComps, opts.fleetScoringOverrides, opts.includeScratchCompanions,
  );

  // Each detected source becomes one axis with a stable id. The optional label
  // override from the wizard applies to the first axis (the others keep their
  // detected labels, renameable in-app).
  const axisSources = resolveSubdivisionAxes(rawComps, parseSailwaveColumns(raw));
  const builtAxes: Array<{ axis: SubdivisionAxis; sourceKey: SubdivisionAxisSource['sourceKey'] }> =
    axisSources.map((src, i) => ({
      axis: newSubdivisionAxis(
        i === 0 ? (opts.subdivisionLabel?.trim() || src.label) : src.label,
      ),
      sourceKey: src.sourceKey,
    }));

  const { competitors, compIdByHandle } = buildCompetitors(
    rawComps, fleetIdByName, fleetSystemByName, builtAxes,
  );

  const sortedRaces = sortedRaceHandles(rawRaces);
  const resultsByRace = groupResultsByRace(rawResults, opts.includeResults);

  const built: RaceBuild[] = [];
  for (let i = 0; i < sortedRaces.length; i++) {
    const [handle, race] = sortedRaces[i];
    const resolvedDate = parseSailwaveRaceDate(race.racedate, datespec, yearHint) ?? defaultDate;
    const starts = buildRaceStarts(race.starts ?? {}, fleetIdByName, baseToFleetIds);
    const finishes = opts.includeResults
      ? buildRaceFinishes(resultsByRace[handle] ?? [], compIdByHandle)
      : [];
    built.push({
      id: cryptoUuid(),
      raceNumber: parseRaceNumber(race.racerank, i + 1),
      date: resolvedDate,
      starts,
      finishes,
    });
  }

  // Drop races with no finishers, but only when some other race was sailed —
  // they'd score as implicit DNC and pollute a partially-scored series with
  // placeholder rows for the scheduled-but-unsailed remainder. When the file
  // has no results at all (a pre-event entry list), keep every race so the
  // full schedule survives. The --no-results path keeps everything too.
  const anyFinishes = built.some((r) => r.finishes.length > 0);
  const races = opts.includeResults && anyFinishes
    ? built.filter((r) => r.finishes.length > 0)
    : built;

  const seriesId = cryptoUuid();
  const sortedRaceDates = races.map((r) => r.date).filter(Boolean).sort();
  const startDateIso = (opts.startDate?.trim() || sortedRaceDates[0] || defaultDate);
  const endDateIso = (opts.endDate?.trim() || sortedRaceDates[sortedRaceDates.length - 1] || startDateIso);

  // Default the optional competitor fields to those Sailwave actually has data
  // for in this file — leaving "Class", "Helm", and "Club" enabled on a file
  // that never populates them just gives the scorer empty columns to clean up.
  const enabledFields = buildEnabledFields(opts.primaryLabel, dataFlagsFor(competitors));

  // Prizes (#240): materialise the expressible prize rows onto the series.
  // An axis clause may reference a source field no competitor populates (the
  // 2026 ILCA Leinsters' Silver prizes filter on a Division nobody carries) —
  // synthesise the axis so the predicate stays faithful and the Prizes tab's
  // "field has no data" warning surfaces it, rather than dropping or widening.
  const { specs: prizeSpecs } = resolveSailwavePrizes(
    raw.prizes ?? [],
    parseSailwaveColumns(raw),
    new Set(fleets.map((f) => f.name)),
  );
  const fleetIdByBuiltName = new Map(fleets.map((f) => [f.name, f.id]));
  const axisBySource = new Map(builtAxes.map((b) => [b.sourceKey, b.axis]));
  const prizes: Prize[] = prizeSpecs.map((spec) => ({
    id: cryptoUuid(),
    name: spec.label,
    recipientCount: spec.count,
    clauses: spec.clauses.map((c): PrizeClause => {
      if (c.kind === 'fleet') {
        // resolveSailwavePrizes only emits fleets it verified against this set.
        return { kind: 'fleet', fleetId: fleetIdByBuiltName.get(c.fleetName)! };
      }
      if (c.kind === 'axis') {
        let axis = axisBySource.get(c.sourceKey);
        if (!axis) {
          axis = newSubdivisionAxis(c.label);
          axisBySource.set(c.sourceKey, axis);
          builtAxes.push({ axis, sourceKey: c.sourceKey });
        }
        return { kind: 'axis', axisId: axis.id, value: c.value };
      }
      return c;
    }),
  }));

  // Scratch series (every fleet position-scored, e.g. a one-design class) record
  // no finish times, so the finish sheet needs no start. Only call it handicap
  // when at least one fleet uses a time-based system — matching how the CSV
  // import and Scoring mode card keep the series-level fork in sync with fleets.
  const scoringMode = fleets.some((f) => f.scoringSystem !== 'scratch')
    ? 'handicap'
    : 'scratch';

  const file: SeriesFile = {
    formatVersion: FORMAT_VERSION,
    seriesId,
    exportedAt: new Date().toISOString(),
    series: {
      id: seriesId,
      name: opts.name.trim() || (globals.serevent ?? '').trim() || 'Sailwave import',
      venue: opts.venue.trim(),
      startDate: startDateIso,
      endDate: endDateIso,
      // Carry the venue/event logos and website links from Sailwave's Series
      // properties. Global names confirmed against real exports. Sailwave often
      // stores the website without a scheme (e.g. "www.hyc.ie"); the renderer
      // prefixes https:// when building links, so we keep the raw value here.
      venueLogoUrl: (globals.servenueburgee ?? '').trim(),
      eventLogoUrl: (globals.sereventburgee ?? '').trim(),
      venueUrl: (globals.servenuewebsite ?? '').trim(),
      eventUrl: (globals.sereventwebsite ?? '').trim(),
      discardThresholds: parseDiscardThresholds(raw),
      dnfScoring,
      ftpHost: '',
      ftpPath: '',
      includeJsonExport: true,
      enabledCompetitorFields: enabledFields,
      primaryPersonLabel: opts.primaryLabel,
      subdivisionAxes: builtAxes.map((b) => b.axis),
      scoringMode,
      ...(prizes.length > 0 ? { prizes } : {}),
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
      ...(c.subdivisions && Object.keys(c.subdivisions).length > 0
        ? { subdivisions: c.subdivisions }
        : {}),
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

/** The series-wide DNF base to import with: the scorer's explicit override, else
 *  the closest representable base the analyzer inferred, else A5.2 (the RRS
 *  default). Any config the analyzer can't represent is surfaced as a wizard
 *  warning (see `analyzeSailwaveScoring`), not an error — the import proceeds
 *  with this closest mode. */
function resolveDnfScoring(
  raw: SailwaveRaw,
  opts: SailwaveImportOptions,
): 'seriesEntries' | 'startingArea' {
  if (opts.dnfScoring) return opts.dnfScoring;
  return analyzeSailwaveScoring(raw).dnfScoring ?? 'seriesEntries';
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
    const name = fleetNameOf(c);
    if (!seen.includes(name)) seen.push(name);
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
  axes: Array<{ axis: SubdivisionAxis; sourceKey: SubdivisionAxisSource['sourceKey'] }>,
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
      const compfleet = fleetNameOf(rec);
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
      gender: genderFromHelmSex(v.comphelmsex),
      age: null,
    };
    if (v.compboat?.trim()) built.boatName = v.compboat.trim();
    // A repurposed Class column feeds its subdivision axis (below), not
    // boatClass — the values are prize categories, not boat classes.
    const classIsAxis = axes.some((a) => a.sourceKey === 'compclass');
    if (!classIsAxis && v.compclass?.trim()) built.boatClass = v.compclass.trim();
    if (v.compcrewname?.trim()) built.crewName = v.compcrewname.trim();
    // Nationality: uppercase, fold Sailwave aliases (BVI → IVB), keep only
    // well-formed 3-letter values. Unknown but well-formed codes pass
    // through so future dataset bumps surface naturally.
    const rawNat = (v.compnat ?? '').trim().toUpperCase();
    if (rawNat) {
      const canonical = lookupAlias(rawNat)?.canonical ?? rawNat;
      if (/^[A-Z]{3}$/.test(canonical)) built.nationality = canonical;
    }
    // Subdivisions: each axis imported verbatim from its source field (the
    // codes Sailwave stores, e.g. "GGM"), keyed by the axis id. The scorer can
    // rename the values in-app.
    const subdivisions: Record<string, string> = {};
    for (const { axis, sourceKey } of axes) {
      const sub = (v[sourceKey] ?? '').trim();
      if (sub) subdivisions[axis.id] = sub;
    }
    if (Object.keys(subdivisions).length > 0) built.subdivisions = subdivisions;
    if (ircTcc != null) built.ircTcc = ircTcc;
    if (nhcTcf != null) built.nhcStartingTcf = nhcTcf;
    if (pyNumber != null) built.pyNumber = pyNumber;
    out.push(built);
  }

  return { competitors: out, compIdByHandle };
}

/** Normalise Sailwave's `comphelmsex` to our typed gender. Sailwave stores
 *  free text; "Female"/"Male" (and bare "F"/"M") are the forms seen in real
 *  files — anything else is deliberately dropped to '' rather than guessed. */
function genderFromHelmSex(raw: string | undefined): 'M' | 'F' | '' {
  const v = (raw ?? '').trim().toUpperCase();
  if (v === 'F' || v === 'FEMALE') return 'F';
  if (v === 'M' || v === 'MALE') return 'M';
  return '';
}

function buildRaceStarts(
  startsRaw: Record<string, string>,
  fleetIdByName: Map<string, string>,
  baseToFleetIds: Map<string, string[]>,
): StartBuild[] {
  const out: StartBuild[] = [];
  const seenFleetIds = new Set<string>();
  const parsedStarts = Object.values(startsRaw)
    .map((raw) => parseStartString(raw))
    .filter((p): p is { fleetNames: string[]; startTime: string } => p !== null);

  // Pass 1: named starts claim every fleet they name plus any companion sharing
  // a base name with one of them. Sailwave encodes a shared gun two ways across
  // HYC files — by naming each fleet explicitly ('Fleet^Puppeteer Scratch^^^
  // Fleet^Puppeteer HPH', the 2024/2025 form) or by naming only one and leaving
  // the companion implicit (the 2026 form). The base-name fan-out covers the
  // implicit case; the loop over fleetNames covers the explicit one. Process
  // named starts first so they take precedence over a combined start.
  for (const parsed of parsedStarts) {
    if (parsed.fleetNames.length === 0) continue;
    const fleetIds: string[] = [];
    const claim = (fid: string | undefined): void => {
      if (fid && !seenFleetIds.has(fid) && !fleetIds.includes(fid)) fleetIds.push(fid);
    };
    for (const name of parsed.fleetNames) {
      claim(fleetIdByName.get(name));
      for (const fid of baseToFleetIds.get(fleetBaseName(name)) ?? []) claim(fid);
    }
    if (fleetIds.length === 0) continue;
    for (const fid of fleetIds) seenFleetIds.add(fid);
    out.push({ id: cryptoUuid(), fleetIds, startTime: parsed.startTime });
  }

  // Pass 2: a combined start (no fleet prefix — one gun for everyone, as
  // cruiser divisions share) applies to every series fleet not already claimed
  // by a named start above. Fleets that don't actually race this race simply
  // carry an unused start time (they auto-DNC and the race is excluded for them).
  for (const parsed of parsedStarts) {
    if (parsed.fleetNames.length !== 0) continue;
    const fleetIds = [...fleetIdByName.values()].filter((fid) => !seenFleetIds.has(fid));
    if (fleetIds.length === 0) continue;
    for (const fid of fleetIds) seenFleetIds.add(fid);
    out.push({ id: cryptoUuid(), fleetIds, startTime: parsed.startTime });
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

  const finished: { pos: number; finishSecs: number | null; rft: string; compId: string; raw: SailwaveResultRaw }[] = [];
  const coded: { compId: string; raw: SailwaveResultRaw }[] = [];
  for (const [compId, r] of byCompetitor) {
    const rrestyp = r.rrestyp ?? '';
    if (rrestyp === SAILWAVE_RRESTYP_FINISHED || rrestyp === SAILWAVE_RRESTYP_POSITION_ONLY) {
      const pos = Number.parseInt(r.rpos ?? '9999', 10);
      finished.push({
        pos: Number.isFinite(pos) ? pos : 9999,
        finishSecs: colonTimeToSeconds(sailwaveTimeToColon(r.rft)),
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

  // `sortOrder` is the crossing order (ADR-007): the order boats cross the
  // line — finish-time order for a common start. Sailwave's `rpos` is a
  // per-scoring-system placing (corrected time on handicap fleets), so for a
  // dual-scored boat the kept primary row carries the *handicap* position,
  // which a scratch companion fleet would then wrongly inherit. When every
  // finisher has a finish time, rank by it; only fall back to `rpos` for
  // position-only races (rrestyp=1) that carry no times at all.
  const allTimed = finished.every((f) => f.finishSecs !== null);
  finished.sort(
    allTimed
      ? (a, b) => a.finishSecs! - b.finishSecs! || a.pos - b.pos
      : (a, b) => a.pos - b.pos || a.rft.localeCompare(b.rft),
  );

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
  hasGender: boolean;
  hasSubdivision: boolean;
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
    hasGender: competitors.some((c) => !!c.gender),
    hasSubdivision: competitors.some((c) => c.subdivisions && Object.keys(c.subdivisions).length > 0),
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
  if (flags.hasGender) fields.push('gender');
  if (flags.hasSubdivision) fields.push('subdivision');
  // Fall back to project defaults only if Sailwave gave us nothing — keeps
  // newly-imported series consistent with manually-created ones.
  return fields.length > 0 ? fields : defaultEnabledCompetitorFields();
}

function cryptoUuid(): string {
  return crypto.randomUUID();
}

// Re-export DEFAULT for the wizard form
export { DEFAULT_PRIMARY_PERSON_LABEL };
