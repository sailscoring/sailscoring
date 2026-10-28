/**
 * An ORC scoring option taken apart into the choices its name packs together.
 *
 * "5-Band 50-50 Windward/Leeward L/M · time-on-time" is four decisions: how
 * the rating is applied (time-on-time, time-on-distance, performance
 * curves), the course model, how many numbers the certificate publishes for
 * it (one, a triple, five bands), and — for the banded ones — the band the
 * race committee announced. Any of them can change from race to race, but
 * on a given day usually one does. Offered as one flat list, changing the
 * band means re-picking all four, and the time-on-distance twin of the
 * intended option sits right beside it. Offered as rows, a scorer changes
 * the one that changed and the rest stay put.
 *
 * Nothing here reads one office's naming conventions. The certificates'
 * catalog already gives each option's kind and name; the twins of one name
 * share it exactly; band siblings differ only in a final band word; and the
 * number of siblings is the number of bands. Where a name doesn't fit that
 * shape, it stands alone as a single-number option under its own name.
 */

import { ORC_STANDARD_OPTIONS } from '@/lib/orc-certificate';
import type { OrcProfile, OrcScoringOptionCatalog, RaceStart } from '@/lib/types';

export type OrcKind = OrcProfile['kind'];

/** One selectable option, as the rows of the picker see it. */
export interface OrcOptionChoice {
  option: string;
  kind: OrcKind;
  /** The issuing office: 'ORC' for the international options, else the
   *  national office's country code. */
  office: string;
  /** The course model, as the Course row names it under this kind. */
  course: string;
  /** What matches the course across kinds and offices' spelling: the office
   *  and the course name with its punctuation folded away. */
  courseKey: string;
  /** How many numbers the certificate publishes for this course and kind:
   *  1 for a single number, 3 for a triple, 5 for a five-band set. */
  numbers: number;
  /** The band word, for a banded option ("L/M", "Med"). */
  band?: string;
  /** What matches a band across sets: "Med" in a triple and in a five-band
   *  set are the same band. */
  bandKey?: string;
}

/** What the rows have chosen so far. Each row is set by the one above it
 *  being set; an unset row means the scorer has a choice still to make. */
export interface OrcChoiceSelection {
  kind?: OrcKind;
  course?: string;   // courseKey
  numbers?: number;
  band?: string;     // bandKey
}

/** The course each international option is scored over. The constructed
 *  course shares one key across kinds, so switching between curves and the
 *  recorded wind keeps the course; its name says which it is. */
const STANDARD_COURSE: Record<string, { key: string; label: string }> = {
  APHT: { key: 'all-purpose', label: 'All-purpose' },
  APHD: { key: 'all-purpose', label: 'All-purpose' },
  CR: { key: 'all-purpose', label: 'All-purpose' },
  TMF_Inshore: { key: 'windward-leeward', label: 'Windward/leeward' },
  ILCWA: { key: 'windward-leeward', label: 'Windward/leeward' },
  WL: { key: 'windward-leeward', label: 'Windward/leeward' },
  TMF_Offshore: { key: 'coastal', label: 'Coastal/long-distance' },
  OSN: { key: 'coastal', label: 'Coastal/long-distance' },
  OC: { key: 'coastal', label: 'Coastal/long-distance' },
  CC: { key: 'constructed', label: 'Constructed course' },
  CC_TOT: { key: 'constructed', label: 'Constructed course at the recorded wind' },
  CC_TOD: { key: 'constructed', label: 'Constructed course at the recorded wind' },
};

/** The band words certificates end a banded option's name with, lightest
 *  first, each with the band it is across sets. ORC's own sets say Light …
 *  Strong where the Irish ones say Low … High. */
const BANDS: ReadonlyArray<{ words: string[]; key: string }> = [
  { words: ['Low', 'Light'], key: 'L' },
  { words: ['L/M', 'Light-Moderate'], key: 'LM' },
  { words: ['Med', 'Medium', 'Moderate'], key: 'M' },
  { words: ['M/H', 'Moderate-Strong'], key: 'MH' },
  { words: ['High', 'Strong'], key: 'H' },
];
const BAND_KEY = new Map(BANDS.flatMap((b) => b.words.map((w) => [w.toLowerCase(), b.key] as const)));
const BAND_RANK = new Map(BANDS.map((b, i) => [b.key, i] as const));
const BAND_RE = new RegExp(
  `^(.*\\S)\\s+(${BANDS.flatMap((b) => b.words).map((w) => w.replace('/', '\\/')).join('|')})$`,
  'i',
);

/** The words a national name opens with to say how many numbers it is —
 *  redundant once the siblings have been counted, so the Course row drops
 *  them: "Triple Number All-Purpose" is the All-Purpose course. */
const SCHEME_RE = /^(single number|triple number|\d+-band)\s+/i;

function fold(text: string): string {
  return text.toLowerCase().replace(/[-\s]+/g, ' ').trim();
}

/**
 * Every option the picker offers, taken apart. `certificateOptions` are the
 * certificate fields the series can score on (`orcSelectableOptions`); only
 * those the catalog names can be taken apart, and the rest are left out —
 * the caller falls back to the flat list when any are.
 */
export function orcOptionChoices(
  certificateOptions: ReadonlyArray<OrcProfile>,
  catalog: OrcScoringOptionCatalog | undefined,
): OrcOptionChoice[] {
  const choices: OrcOptionChoice[] = ORC_STANDARD_OPTIONS.map((o) => {
    const course = STANDARD_COURSE[o.option];
    return {
      option: o.option,
      kind: o.kind,
      office: 'ORC',
      course: course.label,
      courseKey: `ORC|${course.key}`,
      numbers: 1,
    };
  });

  // Certificate options, split into a stem and a band where the name ends
  // in a band word. A stem becomes a banded set only where it has siblings:
  // a lone name that happens to end "High" is a single number.
  const named = certificateOptions.flatMap((o) => {
    const entry = catalog?.[o.option];
    if (!entry || STANDARD_COURSE[o.option]) return [];
    const office = entry.countryId ?? '';
    const match = BAND_RE.exec(entry.name);
    return [{
      option: o.option,
      kind: o.kind,
      office,
      name: entry.name,
      stem: match?.[1],
      band: match?.[2],
    }];
  });
  const siblings = new Map<string, number>();
  for (const n of named) {
    if (!n.stem) continue;
    const key = `${n.office}|${n.kind}|${fold(n.stem)}`;
    siblings.set(key, (siblings.get(key) ?? 0) + 1);
  }
  const split = named.map((n) => {
    const count = n.stem ? siblings.get(`${n.office}|${n.kind}|${fold(n.stem)}`) ?? 0 : 0;
    const banded = count >= 2;
    const stem = banded ? n.stem! : n.name;
    const course = stem.replace(SCHEME_RE, '').trim() || stem;
    return { ...n, banded, count, course, courseKey: `${n.office}|${fold(course)}` };
  });
  // One spelling per course, so "All Purpose" and "All-Purpose" read the
  // same wherever the row shows them: the one most options use.
  const spellings = new Map<string, Map<string, number>>();
  for (const n of split) {
    const counts = spellings.get(n.courseKey) ?? new Map<string, number>();
    counts.set(n.course, (counts.get(n.course) ?? 0) + 1);
    spellings.set(n.courseKey, counts);
  }
  const courseLabel = (key: string) =>
    [...spellings.get(key)!].sort(([a, x], [b, y]) => y - x || a.localeCompare(b))[0][0];
  for (const n of split) {
    choices.push({
      option: n.option,
      kind: n.kind,
      office: n.office,
      course: courseLabel(n.courseKey),
      courseKey: n.courseKey,
      numbers: n.banded ? n.count : 1,
      ...(n.banded ? { band: n.band!, bandKey: BAND_KEY.get(n.band!.toLowerCase())! } : {}),
    });
  }
  return choices;
}

/** The rows' state for an option the choices hold, or null. */
export function orcChoiceOf(
  choices: ReadonlyArray<OrcOptionChoice>,
  option: string,
): OrcChoiceSelection | null {
  const c = choices.find((x) => x.option === option);
  if (!c) return null;
  return {
    kind: c.kind,
    course: c.courseKey,
    numbers: c.numbers,
    ...(c.bandKey ? { band: c.bandKey } : {}),
  };
}

/**
 * Settle what the rows want into what the choices allow, top row down. A row
 * keeps its value while the rows above leave it available — a change of
 * course keeps the kind, the number of bands and the band — and is cleared
 * where they don't, leaving the scorer that row to choose again. A row with
 * only one possible value takes it. The option is set once every row is.
 */
export function orcSettleChoice(
  choices: ReadonlyArray<OrcOptionChoice>,
  wanted: OrcChoiceSelection,
): { selection: OrcChoiceSelection; option?: string } {
  let pool = choices.filter((c) => c.kind === wanted.kind);
  if (pool.length === 0) return { selection: {} };
  const selection: OrcChoiceSelection = { kind: wanted.kind };

  const courses = unique(pool.map((c) => c.courseKey));
  const course = courses.length === 1 ? courses[0] : courses.find((k) => k === wanted.course);
  if (!course) return { selection };
  selection.course = course;
  pool = pool.filter((c) => c.courseKey === course);

  const counts = unique(pool.map((c) => c.numbers));
  const numbers = counts.length === 1 ? counts[0] : counts.find((n) => n === wanted.numbers);
  if (numbers == null) return { selection };
  selection.numbers = numbers;
  pool = pool.filter((c) => c.numbers === numbers);

  if (pool.every((c) => !c.bandKey)) return { selection, option: pool[0].option };
  const band = pool.find((c) => c.bandKey === wanted.band);
  if (!band) return { selection };
  selection.band = band.bandKey;
  return { selection, option: band.option };
}

/** What each row offers, given the rows above it. */
export interface OrcChoiceRows {
  kinds: OrcKind[];
  courses: Array<{ key: string; label: string; office: string }>;
  numbers: number[];
  bands: Array<{ key: string; label: string }>;
}

export function orcChoiceRows(
  choices: ReadonlyArray<OrcOptionChoice>,
  selection: OrcChoiceSelection,
): OrcChoiceRows {
  const kindOrder: OrcKind[] = ['tot', 'tod', 'pcs'];
  const kinds = kindOrder.filter((k) => choices.some((c) => c.kind === k));
  const ofKind = choices.filter((c) => c.kind === selection.kind);
  const courses: OrcChoiceRows['courses'] = [];
  for (const c of ofKind) {
    if (!courses.some((x) => x.key === c.courseKey)) {
      courses.push({ key: c.courseKey, label: c.course, office: c.office });
    }
  }
  // International first, as the standard list always was; then each office's
  // courses by name.
  courses.sort((a, b) =>
    a.office === b.office
      ? (a.office === 'ORC' ? 0 : a.label.localeCompare(b.label))
      : a.office === 'ORC' ? -1 : b.office === 'ORC' ? 1 : a.office.localeCompare(b.office),
  );
  const ofCourse = ofKind.filter((c) => c.courseKey === selection.course);
  const numbers = unique(ofCourse.map((c) => c.numbers)).sort((a, b) => a - b);
  const ofNumbers = ofCourse.filter((c) => c.numbers === selection.numbers);
  const bands: OrcChoiceRows['bands'] = [];
  for (const c of ofNumbers) {
    if (c.bandKey && !bands.some((b) => b.key === c.bandKey)) bands.push({ key: c.bandKey, label: c.band! });
  }
  bands.sort((a, b) => (BAND_RANK.get(a.key) ?? 99) - (BAND_RANK.get(b.key) ?? 99));
  return { kinds, courses, numbers, bands };
}

/**
 * The option a new start begins with: the previous start's. That is the
 * latest ORC start already in this race, else the latest in the most recent
 * earlier race that has one — and whatever it holds, the fleet default
 * included, since a series on its fleets' defaults should stay there. A race
 * day usually keeps the option, and when it doesn't, the rows make the
 * change one click from where the last start left off.
 */
export function orcOptionToCopy(
  race: { id: string; raceNumber: number },
  races: ReadonlyArray<{ id: string; raceNumber: number }>,
  starts: ReadonlyArray<Pick<RaceStart, 'raceId' | 'fleetIds' | 'startTime' | 'orcOption'>>,
  orcFleetIds: ReadonlySet<string>,
): string | undefined {
  const order = [
    race,
    ...races.filter((r) => r.raceNumber < race.raceNumber).sort((a, b) => b.raceNumber - a.raceNumber),
  ];
  for (const r of order) {
    const orcStarts = starts
      .filter((s) => s.raceId === r.id && s.fleetIds.some((id) => orcFleetIds.has(id)))
      .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));
    if (orcStarts.length > 0) return orcStarts[orcStarts.length - 1].orcOption;
  }
  return undefined;
}

/** What the Numbers row calls a set of a given size. */
export function orcNumbersLabel(numbers: number): string {
  if (numbers === 1) return 'Single number';
  if (numbers === 3) return 'Triple number';
  return `${numbers}-band`;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
