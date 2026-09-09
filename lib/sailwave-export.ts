/**
 * SeriesFile → Sailwave `.blw` exporter (spike).
 *
 * The mirror of `sailwave-import.ts`: it writes the flat four-column CSV
 * (`key,value,compHandle,raceHandle`) that Sailwave opens natively, so a
 * scorer who wants Sailwave as a fallback can carry a series across. Only
 * scoring inputs travel — entries, fleets, starts, finishes, codes, the
 * discard profile — never our computed results: Sailwave re-scores from
 * the inputs when the file is opened and "Score series" is run.
 *
 * Sailwave's own boilerplate (series defaults, the root scoring system, its
 * code table, the 213 column definitions) comes from
 * `sailwave-export-template.ts`, captured from a real 2.38.02 file.
 *
 * What the model cannot express in Sailwave terms is reported as a warning
 * rather than dropped silently — see `SailwaveExportWarning`.
 *
 * Pure module — no DOM, no repository access. Feed it the `SeriesFile` that
 * `buildSeriesFile` produces.
 */
import type { SeriesFile } from './series-file';
import type { DiscardThreshold, ProportionalDiscard, ResultCode } from './types';
import {
  SAILWAVE_COLUMN_DEFAULTS,
  SAILWAVE_GLOBAL_DEFAULTS,
  SAILWAVE_SCORING_CODE_DEFAULTS,
  SAILWAVE_SCORING_SYSTEM_DEFAULTS,
  SAILWAVE_TEMPLATE_VERSION,
} from './sailwave-export-template';

export interface SailwaveExportWarning {
  /** Stable identifier for the kind of loss, for tests and for grouping. */
  code: string;
  message: string;
}

export interface SailwaveExportResult {
  /** The `.blw` text: CRLF rows, every field quoted, as Sailwave writes it.
   *  Encode with `encodeWindows1252` before offering it as a download. */
  blw: string;
  warnings: SailwaveExportWarning[];
}

type FleetRow = SeriesFile['fleets'][number];
type CompetitorRow = SeriesFile['competitors'][number];
type RaceRow = SeriesFile['races'][number];
type FinishRow = RaceRow['finishes'][number];

/** Sailwave's rating-system token for each of our fleet scoring systems.
 *  `TCF` is Sailwave's plain time-on-time factor (IRC, VPRS); `NHC1` is its
 *  built-in RYA NHC; `PY` its Portsmouth Yardstick. Static ECHO is a Sailwave
 *  option but the token is unverified against a real file. ORC has no
 *  single-number rating to hand over, so an ORC fleet exports unrated. */
const RATING_SYSTEM_TOKEN: Record<FleetRow['scoringSystem'], string> = {
  scratch: 'None',
  irc: 'TCF',
  vprs: 'TCF',
  py: 'PY',
  nhc: 'NHC1',
  echo: 'ECHO',
  orc: 'None',
};

const ROOT_SYSTEM_HANDLE = 1;
/** Per-fleet child systems are numbered from here; competitor and race
 *  handles live in separate columns, so they need no offset. */
const FIRST_FLEET_SYSTEM_HANDLE = 100;

/** How many races' worth of discard profile to write beyond the races the
 *  series has, so a scorer adding races in Sailwave stays covered. */
const DISCARD_LIST_HEADROOM = 10;

// ---- CSV writing ----

function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

class BlwWriter {
  private readonly rows: string[] = [];

  row(key: string, value: string, compHandle = '', raceHandle = ''): void {
    this.rows.push(
      [key, value, compHandle, raceHandle].map(csvField).join(','),
    );
  }

  text(): string {
    return this.rows.join('\r\n') + '\r\n';
  }
}

// ---- Value formatting ----

/** `HH:MM:SS` → Sailwave's dotted `HH.MM.SS`. */
function dottedTime(hhmmss: string): string {
  return hhmmss.replace(/:/g, '.');
}

function secondsToDotted(totalSecs: number): string {
  const s = Math.round(totalSecs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, '0')).join('.');
}

function colonTimeToSeconds(hhmmss: string): number | null {
  const parts = hhmmss.split(':').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

/** ISO `YYYY-MM-DD` → `DD-MM-YYYY`, the `d-m-y` datespec the file declares. */
function sailwaveDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

function formatRating(value: number | undefined): string {
  return value == null ? '' : String(value);
}

/** Sailwave's start selector: six field/value pairs followed by six
 *  operators. A start scoped to one fleet fills the first pair; a start with
 *  no selector at all is one gun for every fleet in the race. Pipe and caret
 *  are the format's own delimiters, so they cannot appear in a fleet name. */
function fleetSelector(fleetName: string): string {
  return `Fleet^${fleetName}^^^^^^^^^^^=^=^=^=^=^=`;
}

function safeSelectorName(name: string): string {
  return name.replace(/[|^]/g, ' ');
}

// ---- Discard profile ----

/** Expand our threshold table (or a proportional rule) into Sailwave's
 *  cumulative list, indexed by races sailed − 1. */
export function discardListFor(
  thresholds: DiscardThreshold[],
  proportional: ProportionalDiscard | undefined,
  raceCount: number,
): string {
  const maxThreshold = thresholds.reduce((m, t) => Math.max(m, t.minRaces), 0);
  const length = Math.max(raceCount, maxThreshold, 1) + DISCARD_LIST_HEADROOM;
  const sorted = [...thresholds].sort((a, b) => a.minRaces - b.minRaces);
  const counts: number[] = [];
  for (let sailed = 1; sailed <= length; sailed++) {
    let n = 0;
    if (proportional) {
      n = sailed < proportional.firstAt
        ? 0
        : 1 + Math.floor((sailed - proportional.firstAt) / proportional.everyRaces);
    } else {
      for (const t of sorted) if (sailed >= t.minRaces) n = t.discardCount;
    }
    counts.push(n);
  }
  return counts.join(',');
}

// ---- Scoring codes ----

/** Our A5.2 / A5.3 choice as Sailwave's DNC / DNF base methods. Every other
 *  code in the template scores "like DNF", so setting these two sets all. */
function codeBases(dnfScoring: SeriesFile['series']['dnfScoring']): {
  dnc: [string, string];
  dnf: [string, string];
} {
  switch (dnfScoring) {
    case 'seriesEntries':
      return { dnc: ['Boats in series +', '1'], dnf: ['Boats in series +', '1'] };
    case 'startingArea':
      return { dnc: ['Boats in series +', '1'], dnf: ['Boats in race +', '1'] };
    case 'startingAreaInclDnc':
      return { dnc: ['Boats in race +', '1'], dnf: ['Boats in race +', '1'] };
  }
}

function scoringCodeRows(
  systemHandle: number,
  dnfScoring: SeriesFile['series']['dnfScoring'],
): string[] {
  const bases = codeBases(dnfScoring);
  return SAILWAVE_SCORING_CODE_DEFAULTS.map((row) => {
    const parts = row.split('|');
    parts[14] = String(systemHandle);
    const base = parts[0] === 'DNC' ? bases.dnc : parts[0] === 'DNF' ? bases.dnf : null;
    if (base) {
      parts[1] = base[0];
      parts[2] = base[1];
    }
    return parts.join('|');
  });
}

/** Sailwave code for one of ours. Sailwave's table has both RET and RAF;
 *  the template carries RET. */
const RESULT_CODE_TOKEN: Record<Exclude<ResultCode, 'RDG'>, string> = {
  DNC: 'DNC',
  DNS: 'DNS',
  OCS: 'OCS',
  NSC: 'NSC',
  DNF: 'DNF',
  RET: 'RET',
  DSQ: 'DSQ',
  DNE: 'DNE',
  UFD: 'UFD',
  BFD: 'BFD',
};

// ---- Encoding ----

const CP1252_HIGH: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};

/** Encode as windows-1252, the code page Sailwave reads a `.blw` in (the
 *  importer decodes the same way). Characters outside it become `?` —
 *  Sailwave could not show them anyway. */
export function encodeWindows1252(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  let n = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) out[n++] = cp;
    else if (CP1252_HIGH[cp] != null) out[n++] = CP1252_HIGH[cp];
    else out[n++] = 0x3f;
  }
  return out.subarray(0, n);
}

// ---- The export ----

interface AliasRecord {
  handle: number;
  competitor: CompetitorRow;
  fleet: FleetRow;
  /** Handle of the primary record, or null when this is the primary. */
  primaryHandle: number | null;
}

interface RaceStartInfo {
  fleetId: string;
  startTime?: string;
}

export function buildSailwaveBlw(file: SeriesFile): SailwaveExportResult {
  const warnings: SailwaveExportWarning[] = [];
  const warnOnce = new Set<string>();
  const warn = (code: string, message: string): void => {
    const key = `${code}:${message}`;
    if (warnOnce.has(key)) return;
    warnOnce.add(key);
    warnings.push({ code, message });
  };

  const w = new BlwWriter();
  const { series } = file;
  const fleets = [...file.fleets].sort((a, b) => a.displayOrder - b.displayOrder);
  const fleetById = new Map(fleets.map((f) => [f.id, f]));
  const fleetName = new Map(fleets.map((f) => [f.id, safeSelectorName(f.name)]));
  for (const f of fleets) {
    if (fleetName.get(f.id) !== f.name) {
      warn('fleet-name', `Fleet "${f.name}" renamed "${fleetName.get(f.id)}": Sailwave reserves | and ^.`);
    }
  }
  const races = [...file.races].sort((a, b) => a.raceNumber - b.raceNumber);

  // -- Series globals --
  for (const [k, v] of SAILWAVE_GLOBAL_DEFAULTS) w.row(k, v);
  w.row('serversion', SAILWAVE_TEMPLATE_VERSION);
  w.row('serdatespec', 'd-m-y');
  w.row('serevent', series.name);
  w.row('servenue', series.venue);
  w.row('serpubgroupvalues', fleets.map((f) => fleetName.get(f.id)!).join('|'));
  w.row('serscoringhandle', String(ROOT_SYSTEM_HANDLE));

  // -- Scoring systems: root, then one child per fleet whose rating system
  //    differs from the root's. The root takes the first fleet's system. --
  const rootSystem = fleets[0]?.scoringSystem ?? 'scratch';
  const discardList = discardListFor(
    series.discardThresholds,
    series.proportionalDiscard,
    races.length,
  );
  const systemRows = (handle: number, overrides: Record<string, string>): void => {
    const h = String(handle);
    for (const [k, v] of SAILWAVE_SCORING_SYSTEM_DEFAULTS) {
      w.row(k, overrides[k] ?? v, h);
    }
    for (const [k, v] of Object.entries(overrides)) {
      if (!SAILWAVE_SCORING_SYSTEM_DEFAULTS.some(([dk]) => dk === k)) w.row(k, v, h);
    }
  };
  systemRows(ROOT_SYSTEM_HANDLE, {
    scrparent: '0',
    scrratingsystem: RATING_SYSTEM_TOKEN[rootSystem],
    scrdiscardlist: discardList,
  });
  const childSystems: { handle: number; fleet: FleetRow }[] = [];
  fleets.forEach((fleet, i) => {
    if (RATING_SYSTEM_TOKEN[fleet.scoringSystem] === RATING_SYSTEM_TOKEN[rootSystem]) return;
    const handle = FIRST_FLEET_SYSTEM_HANDLE + i;
    childSystems.push({ handle, fleet });
    const follow: Record<string, string> = {};
    for (const [k] of SAILWAVE_SCORING_SYSTEM_DEFAULTS) {
      if (k.startsWith('scrfollow')) follow[k] = '1';
    }
    systemRows(handle, {
      ...follow,
      scrfollowratingsystem: '0',
      scrfollowratingmode: '0',
      scrparent: String(ROOT_SYSTEM_HANDLE),
      scrfield: 'Fleet',
      scrsfield: 'Fleet',
      scrvalue: fleetName.get(fleet.id)!,
      scrratingsystem: RATING_SYSTEM_TOKEN[fleet.scoringSystem],
      scrdiscardlist: discardList,
    });
  });
  for (const handle of [ROOT_SYSTEM_HANDLE, ...childSystems.map((c) => c.handle)]) {
    for (const row of scoringCodeRows(handle, series.dnfScoring)) w.row('scrcode', row);
  }
  w.row('ui', '0|0|0|1|0|0|0|0|0|0|0|0|0|0|0');

  for (const fleet of fleets) {
    if (fleet.scoringSystem === 'orc') {
      warn('orc', `Fleet "${fleet.name}" is ORC-scored; Sailwave gets it unrated (scratch).`);
    }
    if (fleet.scoringSystem === 'echo') {
      warn('echo', `Fleet "${fleet.name}" exports as static ECHO with the starting TCFs; the progressive adjustments are not carried.`);
    }
    if (fleet.nhcProfile) {
      warn('nhc-profile', `Fleet "${fleet.name}" has a customised NHC profile; Sailwave applies its built-in RYA NHC parameters.`);
    }
  }

  // -- Competitors: one Sailwave record per fleet membership, the first the
  //    primary and the rest aliases of it, the way Sailwave models a boat
  //    scored under two systems. --
  const aliasRecords: AliasRecord[] = [];
  const recordsByCompetitor = new Map<string, AliasRecord[]>();
  let nextHandle = 1;
  for (const c of file.competitors) {
    const memberFleets = c.fleetIds
      .map((id) => fleetById.get(id))
      .filter((f): f is FleetRow => f != null)
      .sort((a, b) => a.displayOrder - b.displayOrder);
    if (memberFleets.length === 0) {
      warn('no-fleet', `${c.sailNumber} is in no fleet and was left out.`);
      continue;
    }
    let primaryHandle: number | null = null;
    for (const fleet of memberFleets) {
      const rec: AliasRecord = { handle: nextHandle++, competitor: c, fleet, primaryHandle };
      if (primaryHandle === null) primaryHandle = rec.handle;
      aliasRecords.push(rec);
      (recordsByCompetitor.get(c.id) ?? recordsByCompetitor.set(c.id, []).get(c.id)!).push(rec);
    }
    if (c.subdivisions && Object.keys(c.subdivisions).length > 0) {
      warn('subdivisions', 'Subdivision / category values are not carried.');
    }
    if ((c.owners?.length ?? 0) > 0 || (c.helms?.length ?? 0) > 0) {
      warn('secondary-people', 'Only the primary person and crew are carried; separate owner / helm columns are not.');
    }
  }

  // A boat in a rated fleet without that fleet's rating: the app leaves it
  // off the fleet's table; Sailwave scores it unrated, tied with the others
  // like it. Say so once per fleet.
  const unrated = new Map<string, string[]>();
  for (const rec of aliasRecords) {
    const system = rec.fleet.scoringSystem;
    if (system === 'scratch' || system === 'orc') continue;
    if (ratingFor(rec.competitor, rec.fleet) == null) {
      (unrated.get(rec.fleet.id) ?? unrated.set(rec.fleet.id, []).get(rec.fleet.id)!).push(rec.competitor.sailNumber);
    }
  }
  for (const [fleetId, sails] of unrated) {
    warn('no-rating', `Fleet "${fleetById.get(fleetId)!.name}": ${sails.join(', ')} ${sails.length === 1 ? 'has' : 'have'} no rating for it, so Sailwave scores ${sails.length === 1 ? 'it' : 'them'} unrated where the app leaves ${sails.length === 1 ? 'it' : 'them'} off the table.`);
  }

  for (const rec of aliasRecords) {
    const c = rec.competitor;
    const h = String(rec.handle);
    const names = c.names.length > 0 ? c.names : c.name ? [c.name] : [];
    w.row('compsailno', c.sailNumber, h);
    if (c.alternativeSailNumbers?.length) w.row('compaltsailno', c.alternativeSailNumbers.join(', '), h);
    if (c.bowNumber) w.row('compbownumber', c.bowNumber, h);
    if (c.boatName) w.row('compboat', c.boatName, h);
    if (c.boatClass) w.row('compclass', c.boatClass, h);
    w.row('comphelmname', names.join(' & '), h);
    const crew = c.crewNames ?? (c.crewName ? [c.crewName] : []);
    if (crew.length > 0) w.row('compcrewname', crew.join(', '), h);
    const clubs = c.clubs ?? (c.club ? [c.club] : []);
    if (clubs.length > 0) w.row('compclub', clubs.join(' / '), h);
    if (c.nationality) w.row('compnat', c.nationality, h);
    if (c.tallyNumber) w.row('comptally', c.tallyNumber, h);
    if (c.gender) w.row('comphelmsex', c.gender === 'F' ? 'Female' : 'Male', h);
    w.row('compfleet', fleetName.get(rec.fleet.id)!, h);
    const rating = formatRating(ratingFor(c, rec.fleet));
    if (rating) w.row('comprating', rating, h);
    w.row('compexclude', c.excluded ? '1' : '0', h);
    w.row('compalias', rec.primaryHandle === null ? '0' : String(rec.primaryHandle), h);
    w.row('compmedicalflag', '0', h);
    w.row('comphigh', '0', h);
  }

  // -- Races, starts, results --
  if (file.subSeries?.length) {
    warn('sub-series', 'Sub-series are not carried; Sailwave gets the whole series as one.');
  }
  if (file.splitFleets) {
    warn('split-fleets', 'Split-fleet rounds are not carried; Sailwave sees the fleets as plain fleets.');
  }
  if (series.raceFleetExclusions?.length) {
    warn('race-exclusions', 'Per-fleet race exclusions are not carried.');
  }

  races.forEach((race, i) => {
    const rh = String(i + 1);
    const starts = new Map<string, RaceStartInfo>();
    for (const s of race.starts) {
      for (const fid of s.fleetIds) starts.set(fid, { fleetId: fid, startTime: s.startTime });
    }
    const elapsedMode = race.finishRecording === 'elapsed';

    w.row('racerank', String(race.raceNumber), '', rh);
    w.row('racesailed', '1', '', rh);
    w.row('racename', race.name?.trim() || `R${race.raceNumber}`, '', rh);
    w.row('racedate', sailwaveDate(race.date), '', rh);
    // A fleet whose finishes carry no times is place-scored, whatever gun
    // time its start records — Sailwave's "Place" mode keeps the time too.
    const timedFleets = new Set<string>();
    for (const f of race.finishes) {
      if (f.sortOrder == null || !f.competitorId || (f.finishTime == null && f.elapsedSecs == null)) continue;
      for (const rec of recordsByCompetitor.get(f.competitorId) ?? []) timedFleets.add(rec.fleet.id);
    }
    let startIndex = 0;
    for (const fleet of fleets) {
      const start = starts.get(fleet.id);
      if (!start) continue;
      startIndex++;
      const mode = elapsedMode
        ? 'Elapsed time'
        : start.startTime && timedFleets.has(fleet.id) ? 'Finish time' : 'Place';
      const gun = start.startTime ? dottedTime(start.startTime) : '';
      w.row(
        'racestart',
        `${fleetSelector(fleetName.get(fleet.id)!)}|${gun}|${mode}|Start ${startIndex}|||0||0|0||||1`,
        '',
        rh,
      );
    }
    if (race.discardPolicy === 'mustCount') {
      warn('discard-policy', `Race ${race.raceNumber} must count; Sailwave may discard it.`);
    } else if (race.discardPolicy === 'discardFirst') {
      warn('discard-policy', `Race ${race.raceNumber} is discarded first; Sailwave discards by points alone.`);
    }
    if (race.pointsMultiplier != null && race.pointsMultiplier !== 1) {
      warn('points-multiplier', `Race ${race.raceNumber}'s points multiplier is not carried.`);
    }

    const overrides = new Map<string, number>();
    for (const o of race.ratingOverrides ?? []) overrides.set(o.competitorId, o.value);

    // Crossing order within each fleet, for place-scored starts.
    const finishers = race.finishes
      .filter((f) => f.sortOrder != null && f.competitorId)
      .sort((a, b) => a.sortOrder! - b.sortOrder!);
    const placeByRecord = new Map<number, number>();
    for (const fleet of fleets) {
      let place = 0;
      let lastPlace = 0;
      for (const f of finishers) {
        const rec = recordsByCompetitor.get(f.competitorId!)?.find((r) => r.fleet.id === fleet.id);
        if (!rec) continue;
        place++;
        placeByRecord.set(rec.handle, f.tiedWithPrevious && lastPlace > 0 ? lastPlace : place);
        lastPlace = placeByRecord.get(rec.handle)!;
      }
    }

    const written = new Set<number>();
    for (const f of race.finishes) {
      if (!f.competitorId) {
        warn('unknown-finish', `Race ${race.raceNumber}: an unresolved finish (${f.unknownSailNumber ?? '?'}) was left out.`);
        continue;
      }
      const recs = recordsByCompetitor.get(f.competitorId) ?? [];
      for (const rec of recs) {
        const start = starts.get(rec.fleet.id);
        if (!start) continue; // the fleet is not in this race; blank = DNC to Sailwave
        const wrote = writeResult(
          w, f, rec,
          timedFleets.has(rec.fleet.id) ? start : { fleetId: start.fleetId },
          race, elapsedMode, placeByRecord.get(rec.handle), overrides.get(f.competitorId), rh, warn,
        );
        if (wrote) written.add(rec.handle);
      }
    }
    // Sailwave keeps a cell for every record in every race and repairs a
    // file that lacks one ("missing results"), so the boats with nothing
    // recorded get an empty cell — which Sailwave scores as DNC.
    for (const rec of aliasRecords) {
      if (written.has(rec.handle)) continue;
      const ch = String(rec.handle);
      w.row('rrestyp', '0', ch, rh);
      w.row('rrset', '0', ch, rh);
      w.row('rdisc', '0', ch, rh);
      w.row('srat', '0', ch, rh);
    }
  });

  // -- Column definitions --
  for (const col of SAILWAVE_COLUMN_DEFAULTS) w.row('column', col);

  return { blw: w.text(), warnings };
}

function ratingFor(c: CompetitorRow, fleet: FleetRow): number | undefined {
  switch (fleet.scoringSystem) {
    case 'irc': return c.ircTcc;
    case 'vprs': return c.vprsTcc;
    case 'py': return c.pyNumber;
    case 'nhc': return c.nhcStartingTcf;
    case 'echo': return c.echoStartingTcf;
    case 'scratch':
    case 'orc':
      return undefined;
  }
}

/** Write one result cell. Returns false when the finish amounts to nothing
 *  Sailwave needs a cell for (a DNC, or nothing recorded). */
function writeResult(
  w: BlwWriter,
  f: FinishRow,
  rec: AliasRecord,
  start: RaceStartInfo,
  race: RaceRow,
  elapsedMode: boolean,
  place: number | undefined,
  ratingOverride: number | undefined,
  rh: string,
  warn: (code: string, message: string) => void,
): boolean {
  const ch = String(rec.handle);
  const raceLabel = `Race ${race.raceNumber}`;
  const boat = rec.competitor.sailNumber;

  const isFinish = f.sortOrder != null && (f.resultCode === null || f.resultCode === 'RDG');
  if (isFinish && f.resultCode === 'RDG') {
    warn('rdg-with-finish', `${raceLabel}: ${boat} has both a finish and redress; Sailwave gets the redress only.`);
  }

  if (isFinish && f.resultCode === null) {
    const startSecs = start.startTime ? colonTimeToSeconds(start.startTime) : null;
    const elapsed = f.elapsedSecs ?? (
      f.finishTime && startSecs != null && colonTimeToSeconds(f.finishTime) != null
        ? ((colonTimeToSeconds(f.finishTime)! - startSecs) + 86400) % 86400
        : null
    );
    const finishSecs = f.finishTime
      ? colonTimeToSeconds(f.finishTime)
      : elapsed != null && startSecs != null ? (startSecs + Math.round(elapsed)) % 86400 : null;

    if (startSecs != null && (finishSecs != null || elapsed != null)) {
      w.row('rrestyp', '4', ch, rh);
      w.row('rst', dottedTime(start.startTime!), ch, rh);
      if (finishSecs != null) w.row('rft', secondsToDotted(finishSecs), ch, rh);
      if (elapsed != null) w.row('rele', secondsToDotted(elapsed), ch, rh);
      // Sailwave recomputes the place when it scores; writing the crossing
      // order keeps a mixed race (one fleet timed, another place-scored)
      // ordered sensibly in any reader that trusts the stored place.
      if (place != null) w.row('rpos', String(place), ch, rh);
      if (f.tiedWithPrevious) {
        warn('tie', `${raceLabel}: ${boat} is marked tied with the boat before; Sailwave ties on identical times only.`);
      }
    } else {
      if (elapsedMode || start.startTime) {
        warn('untimed-finish', `${raceLabel}: ${boat} has no usable time and goes across as a recorded place.`);
      }
      w.row('rrestyp', '1', ch, rh);
      w.row('rrecpos', String(place ?? 0), ch, rh);
      w.row('rpos', String(place ?? 0), ch, rh);
    }
    if (f.penaltyCode) {
      const pct = f.penaltyOverride;
      if (f.penaltyCode === 'DPI') {
        const points = f.penaltyOverrideByFleet?.[rec.fleet.id] ?? pct ?? 1;
        w.row('rcod', 'DPI1', ch, rh);
        if (points !== 1) {
          warn('dpi-points', `${raceLabel}: ${boat}'s discretionary penalty of ${points} points goes across as Sailwave's 1-point DPI1.`);
        }
      } else {
        w.row('rcod', f.penaltyCode, ch, rh);
        if (f.penaltyCode === 'SCP' && pct != null && pct !== 20) {
          warn('scp-percent', `${raceLabel}: ${boat}'s ${pct}% scoring penalty goes across as Sailwave's 20% SCP.`);
        }
      }
    }
  } else if (f.resultCode === 'RDG') {
    w.row('rrestyp', '3', ch, rh);
    const method = f.redressMethod ?? 'all_races';
    if (method === 'stated') {
      const points = f.redressPointsByFleet?.[rec.fleet.id] ?? f.redressPoints;
      w.row('rcod', 'RDG', ch, rh);
      if (points != null) w.row('rpts', String(points), ch, rh);
      else warn('rdg-points', `${raceLabel}: ${boat}'s stated redress has no points; Sailwave needs them set by hand.`);
    } else {
      w.row('rcod', method === 'races_before' ? 'RDGb' : 'RDGa', ch, rh);
      if (method === 'all_races_excl_dnc') {
        warn('rdg-excl-dnc', `${raceLabel}: ${boat}'s redress excludes DNCs from the average; Sailwave's RDGa averages every other race.`);
      }
      if (f.redressExcludeRaces?.length || f.redressIncludeRaces?.length) {
        warn('rdg-race-list', `${raceLabel}: ${boat}'s redress race list is not carried; Sailwave averages by its own rule.`);
      }
    }
  } else if (f.resultCode) {
    if (f.resultCode === 'DNC') return false; // blank is DNC to Sailwave
    w.row('rrestyp', '3', ch, rh);
    w.row('rcod', RESULT_CODE_TOKEN[f.resultCode], ch, rh);
  } else {
    return false; // nothing recorded
  }

  if (ratingOverride != null) {
    w.row('rrat', String(ratingOverride), ch, rh);
    w.row('rrset', '1', ch, rh);
  } else {
    w.row('rrset', '0', ch, rh);
  }
  w.row('rdisc', '0', ch, rh);
  w.row('srat', '0', ch, rh);
  return true;
}
