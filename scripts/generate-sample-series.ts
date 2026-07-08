/**
 * Generate the two synthetic sample series that new workspaces are seeded with.
 *
 * Output: `lib/sample-series/regatta.sailscoring` and
 * `lib/sample-series/club-racing.sailscoring` — valid format-v6 `.sailscoring`
 * files (the format is just JSON). These are the files a reviewer opens in the
 * app, and the same files `lib/sample-series/seed.ts` replays into every new
 * personal workspace at sign-up.
 *
 * Everything here is deterministic: a fixed-seed PRNG drives all "random"
 * choices and all IDs are stable strings, so re-running produces a byte-identical
 * file (no churn). The data is entirely synthetic for the regatta; the club
 * series draws *real* boats (names, owners, IRC TCC, ECHO rating) from the Irish
 * Sailing listing in `scripts/data/irc-echo-ratings.csv`.
 *
 * Pure data generation — no DB, no scoring engine. The engine recomputes
 * standings when the file is opened. Run via `pnpm generate:sample-series`.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { CompetitorFieldKey, PrimaryPersonLabel } from '../lib/types';

const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'lib', 'sample-series');

// ─── Deterministic PRNG ──────────────────────────────────────────────────────

/** mulberry32 — tiny seeded PRNG. Same seed ⇒ same stream ⇒ stable output. */
function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const randint = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
/** Fisher–Yates with the supplied RNG; returns a new array. */
function shuffle<T>(rng: Rng, xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
/** Gaussian-ish noise in [-1, 1] (sum of three uniforms), for time jitter. */
const noise = (rng: Rng) => (rng() + rng() + rng()) / 1.5 - 1;

// ─── File-format types (mirror lib/series-file.ts SeriesFile shape, v6) ───────

interface FileFleet {
  id: string;
  name: string;
  displayOrder: number;
  scoringSystem: 'scratch' | 'irc' | 'py' | 'nhc' | 'echo';
  echoAlpha?: number;
}
interface FileCompetitor {
  id: string;
  fleetIds: string[];
  sailNumber: string;
  boatName?: string;
  boatClass?: string;
  name: string;
  owner?: string;
  helm?: string;
  crewName?: string;
  club: string;
  nationality?: string;
  gender: 'M' | 'F' | '';
  age: number | null;
  subdivision?: string;
  ircTcc?: number;
  echoStartingTcf?: number;
}
interface FileFinish {
  id: string;
  competitorId: string | null;
  sortOrder: number | null;
  tiedWithPrevious?: boolean;
  finishTime?: string;
  resultCode: string | null;
  startPresent: boolean | null;
  penaltyCode: string | null;
  penaltyOverride: number | null;
}
interface FileRaceStart {
  id: string;
  fleetIds: string[];
  startTime: string;
}
interface FileRace {
  id: string;
  raceNumber: number;
  date: string;
  starts: FileRaceStart[];
  finishes: FileFinish[];
}
interface FileSeries {
  id: string;
  name: string;
  venue: string;
  startDate: string;
  endDate: string;
  venueLogoUrl: string;
  eventLogoUrl: string;
  venueUrl: string;
  eventUrl: string;
  discardThresholds: { minRaces: number; discardCount: number }[];
  dnfScoring: 'seriesEntries' | 'startingArea';
  ftpHost: string;
  ftpPath: string;
  includeJsonExport: boolean;
  enabledCompetitorFields: CompetitorFieldKey[];
  primaryPersonLabel: PrimaryPersonLabel;
  // v6–v12 files carry a single `subdivisionLabel` (upgraded to one axis on
  // load); v13+ files carry `subdivisionAxes` directly. The club-league sample
  // is born-modern (v19) with no subdivisions, so it emits an empty axis list.
  subdivisionLabel?: string;
  subdivisionAxes?: { id: string; label: string }[];
  scoringMode: 'scratch' | 'handicap';
  defaultStartSequence?: { fleetIds: string[]; intervalMinutes: number }[];
}
/** Sub-series (v9+): named blocks of races scored independently. */
interface FileSubSeries {
  id: string;
  name: string;
  displayOrder: number;
  raceIds: string[];
  fleetIds?: string[];
  raceFleetExclusions?: { raceId: string; fleetId: string }[];
  startingHandicapSource?: 'base' | 'continue';
  continueFromSubSeriesId?: string;
  excludeDncOnlyCompetitors?: boolean;
}
interface SeriesFile {
  formatVersion: number;
  seriesId: string;
  exportedAt: string;
  series: FileSeries;
  fleets: FileFleet[];
  competitors: FileCompetitor[];
  races: FileRace[];
  subSeries?: FileSubSeries[];
}

// Stable timestamp so the file is deterministic across runs.
const EXPORTED_AT = '2026-01-01T00:00:00.000Z';

/** Seconds-of-day → "HH:MM:SS". */
function hms(totalSeconds: number): string {
  const s = ((totalSeconds % 86400) + 86400) % 86400;
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(hh)}:${p(mm)}:${p(ss)}`;
}

// ─── Shared name / club pools (period-whimsical, à la the IODAI anon CSV) ─────

const FEMALE_NAMES = [
  'Attracta', 'Almha', 'Creidne', 'Cliodhna', 'Cecily', 'Clothra', 'Cora',
  'Caoimhe', 'Ethel', 'Eabha', 'Fionnuala', 'Gormlaith', 'Gertrude', 'Harriet',
  'Josephine', 'Jocasta', 'Kitty', 'Keavy', 'Luiseach', 'Lilian',
  'Lasairfhiona', 'Maighread', 'Peig', 'Siobhan', 'Scathach', 'Sive', 'Sadhbh',
  'Thomasina', 'Zelda', 'Aoibheann',
] as const;

const MALE_NAMES = [
  'Alphonsus', 'Aloysius', 'Augustine', 'Ambrose', 'Aindrias', 'Bertram',
  'Bartholomew', 'Breasal', 'Brendan', 'Ciaran', 'Cornelius', 'Donnchadha',
  'Dudley', 'Domhnall', 'Ethelbert', 'Ernest', 'Eoghan', 'Eamonn', 'Flannan',
  'Fergus', 'Flann', 'Giolla', 'Harold', 'Ignatius', 'Iarlaith', 'Jerome',
  'Jasper', 'Keane', 'Konrad', 'Lancelot', 'Lughaidh', 'Murchadh', 'Muiris',
  'Malachy', 'Mortimer', 'Norbert', 'Osbert', 'Oswald', 'Oengus', 'Rupert',
  'Ragnall', 'Roderick', 'Reginald', 'Seamus', 'Tadhg', 'Turlough', 'Walter',
] as const;

const SURNAMES = [
  'Hetherington', 'Brosnahan', 'Arkwright', 'Fogarty', 'Hobson', 'Donnelly',
  'Cribb', 'Henchion', 'Ruttledge', 'Devereaux', 'Shufflebottom', 'Wainwright',
  'Dinneen', 'Moriarty', 'Fitzmaurice', 'Jermyn', 'Crotty', 'Brennan',
  "O'Riordan", 'Drummond', 'Molloy', 'MacCormack', 'Tattersall', 'Kilpatrick',
  'Pemberton', 'Waterhouse', 'Bulkeley', 'Pickwick', 'Sarsfield', 'Villiers',
  'Cholmondeley', 'Makepeace', 'Keohane', 'Braithwaite', 'Smedley', 'Rushworth',
  'Naughton', 'Whittle', 'Kickham', 'Lydican', "O'Dwyer", 'Toomey', 'Gildea',
  "O'Malley", 'Shaughnessy', 'Hawthorn', 'Merriman', 'Fetherstonhaugh',
  'Connolly', 'Blackwood', 'Jenkinson', 'Throgmorton', 'Wolstenholme', 'Aherne',
  "O'Toole", 'Featherstone', 'Ramsbottom', 'Tyrrell',
] as const;

const IRISH_CLUBS = [
  'RSTGYC', 'HYC', 'NYC', 'RCYC', 'MBSC', 'LRYC', 'WHSC', 'GBSC', 'SLYC',
  'RIYC', 'RSGYC', 'KYC', 'SSC', 'MYC', 'BSC', 'LDYC', 'EABC', 'TBSC', 'SDC',
  'ISC', 'CBYC',
] as const;

const FOREIGN_CLUBS: Record<string, readonly string[]> = {
  GBR: ['HISC', 'ASYC', 'PYC', 'PSC', 'StMLSC', 'RHYC', 'LTSC', 'ESC', 'RLYMYC'],
  FRA: ['CVSQ', 'SNPH', 'YCC', 'CNBPP'],
  ITA: ['FVMalcesine', 'CVTorbole', 'CNBardolino', 'YCItaliano'],
  NZL: ['RNZYS'],
};

interface PersonPool {
  /** Draw a distinct full name whose given name matches `gender`. */
  takeName(rng: Rng, gender: 'M' | 'F'): string;
}
/** Draw distinct full names without repeats across the whole event. */
function makePersonPool(): PersonPool {
  const used = new Set<string>();
  return {
    takeName(rng: Rng, gender: 'M' | 'F') {
      const given = gender === 'F' ? FEMALE_NAMES : MALE_NAMES;
      for (let attempt = 0; attempt < 500; attempt++) {
        const name = `${pick(rng, given)} ${pick(rng, SURNAMES)}`;
        if (!used.has(name)) {
          used.add(name);
          return name;
        }
      }
      // Exhausted (won't happen at our scale) — fall back to a numbered name.
      const name = `${pick(rng, given)} ${pick(rng, SURNAMES)} ${used.size}`;
      used.add(name);
      return name;
    },
  };
}

// ─── Series A: 3-day junior scratch regatta ──────────────────────────────────

interface FleetSpec {
  id: string;
  name: string;
  size: number;
  sailLo: number;
  sailHi: number;
  ageLo: number;
  ageHi: number;
  twoHanded: boolean;
}

const REGATTA_FLEETS: FleetSpec[] = [
  { id: 'rf-opti', name: 'Optimist', size: 22, sailLo: 800, sailHi: 1700, ageLo: 9, ageHi: 14, twoHanded: false },
  { id: 'rf-ilca4', name: 'ILCA 4', size: 20, sailLo: 210000, sailHi: 219000, ageLo: 12, ageHi: 16, twoHanded: false },
  { id: 'rf-topper', name: 'Topper', size: 20, sailLo: 45000, sailHi: 49000, ageLo: 11, ageHi: 15, twoHanded: false },
  { id: 'rf-ilca6', name: 'ILCA 6', size: 18, sailLo: 215000, sailHi: 224000, ageLo: 14, ageHi: 18, twoHanded: false },
  { id: 'rf-ilca7', name: 'ILCA 7', size: 16, sailLo: 218000, sailHi: 226000, ageLo: 16, ageHi: 21, twoHanded: false },
  { id: 'rf-29er', name: '29er', size: 14, sailLo: 2400, sailHi: 3100, ageLo: 14, ageHi: 19, twoHanded: true },
];

const SUBDIVISIONS = ['Gold', 'Silver', 'Bronze'] as const;

/** Per-competitor scratch-racing record: a stable skill plus identity. */
interface Racer {
  comp: FileCompetitor;
  skill: number; // lower = faster; drives finishing order
}

function buildRegatta(): SeriesFile {
  const rng = makeRng(0x5a17a);
  const people = makePersonPool();
  const competitors: FileCompetitor[] = [];
  const racersByFleet = new Map<string, Racer[]>();

  // Exactly one NZL sailor across the whole event; a sprinkle of GBR/FRA/ITA.
  let nzlPlaced = false;
  let cidx = 0;

  for (const f of REGATTA_FLEETS) {
    const racers: Racer[] = [];
    const sails = shuffle(
      rng,
      Array.from({ length: f.sailHi - f.sailLo + 1 }, (_, i) => f.sailLo + i),
    ).slice(0, f.size);

    // Roughly even Gold/Silver/Bronze split per fleet.
    const subs = shuffle(
      rng,
      Array.from({ length: f.size }, (_, i) => SUBDIVISIONS[i % 3]),
    );

    for (let i = 0; i < f.size; i++) {
      cidx++;
      // Nationality: mostly IRL. ~1-in-7 foreign, and place the single NZL once.
      let nationality = 'IRL';
      const roll = rng();
      if (!nzlPlaced && f.id === 'rf-ilca6' && i === 4) {
        nationality = 'NZL';
        nzlPlaced = true;
      } else if (roll < 0.1) {
        nationality = 'GBR';
      } else if (roll < 0.13) {
        nationality = 'FRA';
      } else if (roll < 0.16) {
        nationality = 'ITA';
      }
      const club =
        nationality === 'IRL'
          ? pick(rng, IRISH_CLUBS)
          : pick(rng, FOREIGN_CLUBS[nationality]);

      const gender: 'M' | 'F' = rng() < 0.42 ? 'F' : 'M';
      const comp: FileCompetitor = {
        id: `rc-${String(cidx).padStart(3, '0')}`,
        fleetIds: [f.id],
        sailNumber: String(sails[i]),
        name: people.takeName(rng, gender),
        club,
        nationality,
        gender,
        age: randint(rng, f.ageLo, f.ageHi),
        subdivision: subs[i],
      };
      if (f.twoHanded) comp.crewName = people.takeName(rng, rng() < 0.5 ? 'F' : 'M');
      competitors.push(comp);
      racers.push({ comp, skill: rng() });
    }
    racersByFleet.set(f.id, racers);
  }

  // 3 days, 3+3+2 races.
  const raceDates = ['2026-04-18', '2026-04-19', '2026-04-20'];
  const racesPerDay = [3, 3, 2];
  const RESULT_CODES = ['DNF', 'DNC', 'OCS', 'DSQ', 'RET'] as const;

  const races: FileRace[] = [];
  let raceNumber = 0;
  for (let d = 0; d < raceDates.length; d++) {
    for (let r = 0; r < racesPerDay[d]; r++) {
      raceNumber++;
      const date = raceDates[d];
      const starts: FileRaceStart[] = [];
      const finishes: FileFinish[] = [];

      // Each class gets its own start, staggered 5 min apart from 11:00.
      let gun = 11 * 3600;
      let sortOrder = 0;
      for (const f of REGATTA_FLEETS) {
        starts.push({ id: `rs-${raceNumber}-${f.id}`, fleetIds: [f.id], startTime: hms(gun) });
        gun += 5 * 60;

        const racers = racersByFleet.get(f.id)!;
        // This race's order: skill + per-race noise.
        const ranked = [...racers].sort(
          (a, b) => a.skill + rng() * 0.6 - (b.skill + rng() * 0.6),
        );
        let prevPlaced = false;
        for (let p = 0; p < ranked.length; p++) {
          const { comp } = ranked[p];
          const fin: FileFinish = {
            id: `rfin-${raceNumber}-${comp.id}`,
            competitorId: comp.id,
            sortOrder: null,
            resultCode: null,
            startPresent: true,
            penaltyCode: null,
            penaltyOverride: null,
          };
          // ~4% of finishes get a code; otherwise a normal placed finish.
          const codeRoll = rng();
          if (codeRoll < 0.04) {
            const code = pick(rng, RESULT_CODES);
            fin.resultCode = code;
            fin.startPresent = code === 'DNC' ? false : true;
            prevPlaced = false;
          } else {
            sortOrder++;
            fin.sortOrder = sortOrder;
            // Occasional dead-heat with the previous placed boat.
            if (prevPlaced && rng() < 0.03) fin.tiedWithPrevious = true;
            prevPlaced = true;
          }
          finishes.push(fin);
        }
      }

      races.push({ id: `rr-${raceNumber}`, raceNumber, date, starts, finishes });
    }
  }

  const enabledCompetitorFields: CompetitorFieldKey[] = [
    'club',
    'nationality',
    'gender',
    'age',
    'subdivision',
    'crewName',
  ];

  return {
    formatVersion: 8,
    seriesId: 'sample-regatta',
    exportedAt: EXPORTED_AT,
    series: {
      id: 'sample-regatta',
      name: 'Sample Junior Regatta 2026',
      venue: 'Howth Yacht Club',
      startDate: raceDates[0],
      endDate: raceDates[raceDates.length - 1],
      venueLogoUrl: '',
      eventLogoUrl: '',
      venueUrl: '',
      eventUrl: '',
      discardThresholds: [{ minRaces: 5, discardCount: 1 }],
      dnfScoring: 'seriesEntries',
      ftpHost: '',
      ftpPath: '',
      includeJsonExport: true,
      enabledCompetitorFields,
      primaryPersonLabel: 'helm',
      subdivisionLabel: 'Division',
      scoringMode: 'scratch',
    },
    fleets: REGATTA_FLEETS.map((f, i) => ({
      id: f.id,
      name: f.name,
      displayOrder: i,
      scoringSystem: 'scratch' as const,
    })),
    competitors,
    races,
  };
}

// ─── Series B: 6-week mixed-cruiser club series (IRC + ECHO) ──────────────────

interface BoatRow {
  sailNumber: string;
  boatName: string;
  model: string;
  owner: string;
  club: string;
  echo: number;
  ircTcc: number;
}

/** RFC-4180-ish line split (handles quoted owners with embedded commas). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      out.push(field);
      field = '';
    } else field += ch;
  }
  out.push(field);
  return out;
}

const KNOWN_NATS = new Set(['IRL', 'GBR', 'FRA', 'ITA', 'NZL', 'USA', 'NED', 'GER', 'ESP']);
function natFromSail(sail: string): string {
  const m = sail.match(/^([A-Z]{3})\d/);
  if (m && KNOWN_NATS.has(m[1])) return m[1];
  return 'IRL';
}

function loadDualRatedBoats(): BoatRow[] {
  const csv = readFileSync(
    join(ROOT, 'scripts', 'data', 'irc-echo-ratings.csv'),
    'utf8',
  );
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '');
  const rows: BoatRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = splitCsvLine(lines[i]);
    const sailNumber = c[0]?.trim();
    const boatName = c[1]?.trim();
    const echo = Number(c[5]);
    const ircTcc = Number(c[9]);
    // Dual-rated only, and skip the "(SC)" secondary-config duplicate rows.
    if (!sailNumber || !boatName || boatName.includes('(SC)')) continue;
    if (!Number.isFinite(echo) || c[5].trim() === '') continue;
    if (!Number.isFinite(ircTcc) || c[9].trim() === '') continue;
    rows.push({
      sailNumber,
      boatName,
      model: c[2]?.trim() || '',
      owner: c[3]?.trim() || '',
      club: c[4]?.trim() || '',
      echo,
      ircTcc,
    });
  }
  return rows;
}

interface ClassSpec {
  num: 1 | 2 | 3;
  ircFleetId: string;
  echoFleetId: string;
  boats: BoatRow[];
  startOffsetMin: number; // gun offset from the first class
}

function buildClubRacing(): SeriesFile {
  const rng = makeRng(0xc1ab);

  // 45 dual-rated boats: sort by TCC, take top/middle/bottom 15 (data-driven
  // bands, because only 6 dual-rated boats exceed TCC 1.10 — see the plan).
  const all = loadDualRatedBoats().sort((a, b) => b.ircTcc - a.ircTcc);
  const n = all.length;
  const class1 = all.slice(0, 15);
  const midStart = Math.floor(n / 2) - 7;
  const class2 = all.slice(midStart, midStart + 15);
  const class3 = all.slice(n - 15);

  const classes: ClassSpec[] = [
    { num: 1, ircFleetId: 'cf-1-irc', echoFleetId: 'cf-1-echo', boats: class1, startOffsetMin: 0 },
    { num: 2, ircFleetId: 'cf-2-irc', echoFleetId: 'cf-2-echo', boats: class2, startOffsetMin: 5 },
    { num: 3, ircFleetId: 'cf-3-irc', echoFleetId: 'cf-3-echo', boats: class3, startOffsetMin: 10 },
  ];

  const fleets: FileFleet[] = [];
  let order = 0;
  for (const cl of classes) {
    fleets.push({ id: cl.ircFleetId, name: `Class ${cl.num} IRC`, displayOrder: order++, scoringSystem: 'irc' });
    fleets.push({
      id: cl.echoFleetId,
      name: `Class ${cl.num} ECHO`,
      displayOrder: order++,
      scoringSystem: 'echo',
      echoAlpha: 0.25,
    });
  }

  // Competitors: each boat joins its class's IRC and ECHO fleet.
  const competitors: FileCompetitor[] = [];
  interface ClubBoat {
    comp: FileCompetitor;
    cls: ClassSpec;
  }
  const boats: ClubBoat[] = [];
  let bi = 0;
  for (const cl of classes) {
    for (const b of cl.boats) {
      bi++;
      const comp: FileCompetitor = {
        id: `cc-${String(bi).padStart(2, '0')}`,
        fleetIds: [cl.ircFleetId, cl.echoFleetId],
        sailNumber: b.sailNumber,
        boatName: b.boatName,
        boatClass: b.model,
        name: b.owner || b.boatName,
        club: b.club,
        nationality: natFromSail(b.sailNumber),
        gender: '',
        age: null,
        ircTcc: b.ircTcc,
        echoStartingTcf: b.echo,
      };
      competitors.push(comp);
      boats.push({ comp, cls: cl });
    }
  }

  // Per-boat latent speed: corrected times should cluster, so elapsed ≈
  // targetCorrected / TCC. A small stable per-boat bias makes some boats
  // habitually quicker on handicap; per-race noise reshuffles the order.
  const speedBias = new Map<string, number>();
  for (const { comp } of boats) speedBias.set(comp.id, (rng() - 0.5) * 0.06);

  // 6 consecutive Tuesday evenings.
  const raceDates = [
    '2026-05-05', '2026-05-12', '2026-05-19', '2026-05-26', '2026-06-02', '2026-06-09',
  ];
  const FIRST_GUN = 18 * 3600 + 55 * 60; // 18:55:00
  const TARGET_CORRECTED = 3300; // ~55 min on corrected time

  // A couple of scripted non-finishes across the series (boatIndex → raceIdx).
  const dnfPlan = new Map<string, string>(); // `${compId}@${raceNumber}` → code
  dnfPlan.set(`${boats[3].comp.id}@2`, 'DNF');
  dnfPlan.set(`${boats[20].comp.id}@4`, 'RET');
  dnfPlan.set(`${boats[31].comp.id}@5`, 'DNC');

  const races: FileRace[] = [];
  for (let r = 0; r < raceDates.length; r++) {
    const raceNumber = r + 1;
    const date = raceDates[r];

    const starts: FileRaceStart[] = classes.map((cl) => ({
      id: `crs-${raceNumber}-${cl.num}`,
      fleetIds: [cl.ircFleetId, cl.echoFleetId],
      startTime: hms(FIRST_GUN + cl.startOffsetMin * 60),
    }));

    // Compute each boat's elapsed + finish time of day.
    interface Crossing {
      comp: FileCompetitor;
      finishSecondsOfDay: number;
      code?: string;
    }
    const crossings: Crossing[] = [];
    for (const { comp, cls } of boats) {
      const key = `${comp.id}@${raceNumber}`;
      const code = dnfPlan.get(key);
      const gun = FIRST_GUN + cls.startOffsetMin * 60;
      if (code === 'DNC') {
        crossings.push({ comp, finishSecondsOfDay: Number.POSITIVE_INFINITY, code });
        continue;
      }
      const bias = speedBias.get(comp.id)!;
      const targetCorrected = TARGET_CORRECTED * (1 + bias + noise(rng) * 0.05);
      const elapsed = Math.round(targetCorrected / comp.ircTcc!);
      if (code === 'DNF' || code === 'RET') {
        crossings.push({ comp, finishSecondsOfDay: gun + elapsed, code });
      } else {
        crossings.push({ comp, finishSecondsOfDay: gun + elapsed });
      }
    }

    // Crossing order is by wall-clock finish time across the whole fleet.
    const placed = crossings.filter((x) => !x.code).sort((a, b) => a.finishSecondsOfDay - b.finishSecondsOfDay);
    const finishes: FileFinish[] = [];
    let sortOrder = 0;
    for (const x of placed) {
      sortOrder++;
      finishes.push({
        id: `cfin-${raceNumber}-${x.comp.id}`,
        competitorId: x.comp.id,
        sortOrder,
        finishTime: hms(x.finishSecondsOfDay),
        resultCode: null,
        startPresent: true,
        penaltyCode: null,
        penaltyOverride: null,
      });
    }
    for (const x of crossings.filter((c) => c.code)) {
      finishes.push({
        id: `cfin-${raceNumber}-${x.comp.id}`,
        competitorId: x.comp.id,
        sortOrder: null,
        resultCode: x.code!,
        startPresent: x.code !== 'DNC',
        penaltyCode: null,
        penaltyOverride: null,
      });
    }

    races.push({ id: `cr-${raceNumber}`, raceNumber, date, starts, finishes });
  }

  const enabledCompetitorFields: CompetitorFieldKey[] = [
    'boatName',
    'boatClass',
    'club',
    'nationality',
  ];

  return {
    formatVersion: 8,
    seriesId: 'sample-club-racing',
    exportedAt: EXPORTED_AT,
    series: {
      id: 'sample-club-racing',
      name: 'Sample Tuesday Evening League 2026',
      venue: 'Howth Yacht Club',
      startDate: raceDates[0],
      endDate: raceDates[raceDates.length - 1],
      venueLogoUrl: '',
      eventLogoUrl: '',
      venueUrl: '',
      eventUrl: '',
      discardThresholds: [{ minRaces: 4, discardCount: 1 }],
      dnfScoring: 'seriesEntries',
      ftpHost: '',
      ftpPath: '',
      includeJsonExport: true,
      enabledCompetitorFields,
      primaryPersonLabel: 'owner',
      subdivisionLabel: 'Division',
      scoringMode: 'handicap',
    },
    fleets,
    competitors,
    races,
  };
}

// ─── Series C: 8-week club league demonstrating sub-series ────────────────────

/**
 * A compact ECHO club league (two divisions, 8 Tuesday evenings) whose whole
 * point is to show the sub-series feature doing real work. Kept small enough
 * that a scorer can read the standings by eye and see each mechanism:
 *
 *   - Season Overall — all 8 races, both fleets, full entry list.
 *   - Spring / Summer — race subsets (1-4 / 5-8), ranking only boats that
 *     sailed; Summer's progressive handicaps *continue* from Spring's.
 *   - Cruisers 1 Championship — scoped to one fleet, with race 6 struck for it
 *     (a per-fleet race exclusion, modelling an abandoned start for that class).
 *
 * One boat stops sailing after Spring, so it appears in the full-entry Season
 * Overall but drops out of the Summer block — the visible payoff of
 * `excludeDncOnlyCompetitors`.
 */
function buildClubLeague(): SeriesFile {
  const rng = makeRng(0x1ea6);

  const F1 = 'lf-cruisers-1';
  const F2 = 'lf-cruisers-2';
  const fleets: FileFleet[] = [
    { id: F1, name: 'Cruisers 1', displayOrder: 0, scoringSystem: 'echo', echoAlpha: 0.25 },
    { id: F2, name: 'Cruisers 2', displayOrder: 1, scoringSystem: 'echo', echoAlpha: 0.25 },
  ];

  // 14 real dual-rated boats, fastest-rated in Cruisers 1. Each boat sails one
  // division (unlike the club-racing sample's dual IRC+ECHO membership).
  const all = loadDualRatedBoats().sort((a, b) => b.echo - a.echo).slice(0, 14);
  const bands: { fleetId: string; boats: BoatRow[] }[] = [
    { fleetId: F1, boats: all.slice(0, 8) },
    { fleetId: F2, boats: all.slice(8, 14) },
  ];

  interface LeagueBoat {
    comp: FileCompetitor;
    fleetId: string;
  }
  const competitors: FileCompetitor[] = [];
  const boats: LeagueBoat[] = [];
  let bi = 0;
  for (const band of bands) {
    for (const b of band.boats) {
      bi++;
      const comp: FileCompetitor = {
        id: `lc-${String(bi).padStart(2, '0')}`,
        fleetIds: [band.fleetId],
        sailNumber: b.sailNumber,
        boatName: b.boatName,
        boatClass: b.model,
        name: b.owner || b.boatName,
        club: b.club,
        nationality: natFromSail(b.sailNumber),
        gender: '',
        age: null,
        echoStartingTcf: b.echo,
      };
      competitors.push(comp);
      boats.push({ comp, fleetId: band.fleetId });
    }
  }

  // The boat that stops sailing after Spring (races 5-8) — makes the
  // Season-Overall-vs-Summer DNC contrast visible. A Cruisers 1 boat.
  const retiredAfterSpringId = boats[6].comp.id;

  const speedBias = new Map<string, number>();
  for (const { comp } of boats) speedBias.set(comp.id, (rng() - 0.5) * 0.06);

  // 8 consecutive Tuesday evenings, both divisions off the same line 5 min apart.
  const raceDates = [
    '2026-05-05', '2026-05-12', '2026-05-19', '2026-05-26',
    '2026-06-02', '2026-06-09', '2026-06-16', '2026-06-23',
  ];
  const FIRST_GUN = 18 * 3600 + 55 * 60; // 18:55:00
  const OFFSET: Record<string, number> = { [F1]: 0, [F2]: 5 * 60 };
  const TARGET_CORRECTED = 3600; // ~60 min on corrected time

  const races: FileRace[] = [];
  for (let r = 0; r < raceDates.length; r++) {
    const raceNumber = r + 1;
    const date = raceDates[r];

    const starts: FileRaceStart[] = fleets.map((f) => ({
      id: `lrs-${raceNumber}-${f.id}`,
      fleetIds: [f.id],
      startTime: hms(FIRST_GUN + OFFSET[f.id]),
    }));

    interface Crossing {
      comp: FileCompetitor;
      finishSecondsOfDay: number;
    }
    const crossings: Crossing[] = [];
    for (const { comp, fleetId } of boats) {
      // The retired boat simply doesn't take the start from race 5 on — absence
      // is scored DNC, so it is all-DNC across the Summer block.
      if (comp.id === retiredAfterSpringId && raceNumber >= 5) continue;
      const gun = FIRST_GUN + OFFSET[fleetId];
      const bias = speedBias.get(comp.id)!;
      const targetCorrected = TARGET_CORRECTED * (1 + bias + noise(rng) * 0.05);
      const elapsed = Math.round(targetCorrected / comp.echoStartingTcf!);
      crossings.push({ comp, finishSecondsOfDay: gun + elapsed });
    }

    const placed = crossings.sort((a, b) => a.finishSecondsOfDay - b.finishSecondsOfDay);
    const finishes: FileFinish[] = placed.map((x, i) => ({
      id: `lfin-${raceNumber}-${x.comp.id}`,
      competitorId: x.comp.id,
      sortOrder: i + 1,
      finishTime: hms(x.finishSecondsOfDay),
      resultCode: null,
      startPresent: true,
      penaltyCode: null,
      penaltyOverride: null,
    }));

    races.push({ id: `lr-${raceNumber}`, raceNumber, date, starts, finishes });
  }

  const allRaceIds = races.map((r) => r.id);
  const subSeries: FileSubSeries[] = [
    {
      id: 'lss-overall',
      name: 'Season Overall',
      displayOrder: 0,
      raceIds: allRaceIds,
      // Full entry list: a boat that stops sailing is still ranked (DNC).
      excludeDncOnlyCompetitors: false,
    },
    {
      id: 'lss-spring',
      name: 'Spring Series',
      displayOrder: 1,
      raceIds: allRaceIds.slice(0, 4),
      excludeDncOnlyCompetitors: true,
    },
    {
      id: 'lss-summer',
      name: 'Summer Series',
      displayOrder: 2,
      raceIds: allRaceIds.slice(4, 8),
      // Progressive ECHO handicaps carry over from the Spring block.
      startingHandicapSource: 'continue',
      continueFromSubSeriesId: 'lss-spring',
      excludeDncOnlyCompetitors: true,
    },
    {
      id: 'lss-c1-champ',
      name: 'Cruisers 1 Championship',
      displayOrder: 3,
      raceIds: allRaceIds,
      fleetIds: [F1],
      // Race 6 abandoned for Cruisers 1 — struck from this championship only.
      raceFleetExclusions: [{ raceId: 'lr-6', fleetId: F1 }],
      excludeDncOnlyCompetitors: true,
    },
  ];

  const enabledCompetitorFields: CompetitorFieldKey[] = [
    'boatName',
    'boatClass',
    'club',
    'nationality',
  ];

  return {
    formatVersion: 19,
    seriesId: 'sample-club-league',
    exportedAt: EXPORTED_AT,
    series: {
      id: 'sample-club-league',
      name: 'Sample Club League 2026',
      venue: 'Howth Yacht Club',
      startDate: raceDates[0],
      endDate: raceDates[raceDates.length - 1],
      venueLogoUrl: '',
      eventLogoUrl: '',
      venueUrl: '',
      eventUrl: '',
      discardThresholds: [{ minRaces: 4, discardCount: 1 }],
      dnfScoring: 'seriesEntries',
      ftpHost: '',
      ftpPath: '',
      includeJsonExport: true,
      enabledCompetitorFields,
      primaryPersonLabel: 'owner',
      subdivisionAxes: [],
      scoringMode: 'handicap',
    },
    fleets,
    competitors,
    races,
    subSeries,
  };
}

// ─── Emit ─────────────────────────────────────────────────────────────────────

function write(name: string, file: SeriesFile) {
  const path = join(OUT_DIR, name);
  writeFileSync(path, JSON.stringify(file, null, 2) + '\n');
  const compCount = file.competitors.length;
  const raceCount = file.races.length;
  const subSeriesNote = file.subSeries?.length ? `, ${file.subSeries.length} sub-series` : '';
  console.log(`wrote ${path}  (${file.fleets.length} fleets, ${compCount} competitors, ${raceCount} races${subSeriesNote})`);
}

mkdirSync(OUT_DIR, { recursive: true });
write('regatta.sailscoring', buildRegatta());
write('club-racing.sailscoring', buildClubRacing());
write('club-league.sailscoring', buildClubLeague());
