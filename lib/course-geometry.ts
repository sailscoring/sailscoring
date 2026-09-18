/**
 * The arithmetic of the course library (ORC constructed courses): resolving
 * a course's mark sequence to waypoints and legs, filling a start's leg
 * table from it, checking whether the legs still match, adopting a card's
 * marks and courses into a series, and proposing the names a scorer will
 * recognise a fortnight later. Pure and client-safe; the geometry itself is
 * the course-cards library's.
 */

import {
  METRES_PER_CABLE,
  METRES_PER_NM,
  courseMarks,
  destination,
  distanceNm as positionsApartNm,
  legsFromWaypoints,
  type CourseCardFile,
  type CourseLeg,
  type DrawnCourseMark,
  type DrawnMark,
  type MarksFile,
  type Position,
  type ResolvedCourseMark,
  type Waypoint,
} from '@sailscoring/course-cards';

import type {
  OrcCourseLeg,
  RaceStartCourse,
  RaceStartCourseWaypoint,
  SeriesCourse,
  SeriesCourseLeg,
  SeriesCourseMark,
  SeriesMark,
} from './types';

// ─── Labels and names ────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09-06" → "6 Sep": the date as a scorer writes it on a name. */
export function shortDayLabel(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return isoDate;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]}`;
}

/** What the app knows when it proposes a name: the race day, and the race
 *  when one is open. */
export interface NamingContext {
  date?: string;        // ISO date
  raceNumber?: number;
}

function qualifier(ctx: NamingContext): string {
  const parts: string[] = [];
  if (ctx.date) parts.push(shortDayLabel(ctx.date));
  if (ctx.raceNumber != null) parts.push(`R${ctx.raceNumber}`);
  return parts.join(' ');
}

/** "Z" + {6 Sep, R2} → "Z — 6 Sep R2". The qualifiers that matter (inner,
 *  outer, inshore) are the scorer's to add. */
export function proposeMarkName(base: string, ctx: NamingContext): string {
  const q = qualifier(ctx);
  return q ? `${base} — ${q}` : base;
}

/** "004" + {6 Sep, R2} → "004 — 6 Sep R2". */
export function proposeCourseName(courseId: string, ctx: NamingContext): string {
  return proposeMarkName(courseId, ctx);
}

/** The short label printed beside a mark on a drawing: the card's letter for
 *  an adopted mark, otherwise the name up to its first " — " qualifier. */
export function markLabel(mark: Pick<SeriesMark, 'name' | 'card'>): string {
  if (mark.card) return mark.card.markId;
  const dash = mark.name.indexOf(' — ');
  return dash > 0 ? mark.name.slice(0, dash) : mark.name;
}

// ─── Positions ───────────────────────────────────────────────────────────────

export type DistanceUnit = 'm' | 'cables' | 'nm';

export function toMetres(value: number, unit: DistanceUnit): number {
  return unit === 'nm' ? value * METRES_PER_NM : unit === 'cables' ? value * METRES_PER_CABLE : value;
}

/** Where a mark laid "1,000 m upwind of the line on 190°" is. */
export function positionFrom(origin: Position, bearingDeg: number, distance: number, unit: DistanceUnit): Position {
  return destination(origin, bearingDeg, toMetres(distance, unit));
}

// ─── Resolving a course ──────────────────────────────────────────────────────

export interface ResolvedCourse {
  waypoints: RaceStartCourseWaypoint[];
  legs: CourseLeg[];
  totalNm: number;
  /** Entries whose mark is no longer in the library — skipped, and worth
   *  telling the scorer about. */
  missingMarkIds: string[];
}

/** A course's sequence resolved against the library: waypoints with the
 *  marks' current positions, and the legs between them. */
export function resolveCourse(
  marks: SeriesCourseMark[],
  marksById: ReadonlyMap<string, SeriesMark>,
): ResolvedCourse {
  const waypoints: RaceStartCourseWaypoint[] = [];
  const missingMarkIds: string[] = [];
  for (const entry of marks) {
    const mark = marksById.get(entry.markId);
    if (!mark) {
      if (!missingMarkIds.includes(entry.markId)) missingMarkIds.push(entry.markId);
      continue;
    }
    waypoints.push({
      markId: mark.id,
      label: markLabel(mark),
      lat: mark.lat,
      lng: mark.lng,
      ...(entry.side ? { side: entry.side } : {}),
      ...(entry.passing ? { passing: true } : {}),
      ...(mark.card ? { fixed: true } : {}),
    });
  }
  const legs = legsFromWaypoints(waypoints.map(toLibraryWaypoint));
  return { waypoints, legs, totalNm: legs.reduce((sum, l) => sum + l.distanceNm, 0), missingMarkIds };
}

function toLibraryWaypoint(w: RaceStartCourseWaypoint): Waypoint {
  return { mark: w.markId ?? w.label, label: w.label, position: { lat: w.lat, lng: w.lng } };
}

/** The legs of a snapshot's waypoints — the same arithmetic as resolveCourse,
 *  over positions frozen when the start picked the course. */
export function legsOfWaypoints(waypoints: RaceStartCourseWaypoint[]): CourseLeg[] {
  return legsFromWaypoints(waypoints.map(toLibraryWaypoint));
}

/** Whether a course is the race committee's leg table rather than a mark
 *  sequence — the one question a caller has to ask about which kind it has,
 *  and the invariant `SeriesCourse` documents (exactly one is non-empty). */
export function courseIsLegTable(
  course: Pick<SeriesCourse, 'marks' | 'legs'>,
): boolean {
  return course.marks.length === 0 && (course.legs?.length ?? 0) > 0;
}

/**
 * The legs a course gives, however it is defined: computed from its marks'
 * positions, or the leg table the course *is*. The single seam between the
 * two kinds — every consumer of a course's geometry goes through here rather
 * than reading `marks` or `legs` itself.
 */
export function courseLegsOf(
  course: Pick<SeriesCourse, 'marks' | 'legs'>,
  marksById: ReadonlyMap<string, SeriesMark>,
): SeriesCourseLeg[] {
  if (courseIsLegTable(course)) return course.legs!;
  return resolveCourse(course.marks, marksById).legs;
}

/** What {@link parseLegTable} made of a pasted table. */
export interface ParsedLegTable {
  legs: SeriesCourseLeg[];
  /** Lines that held no usable pair of numbers — a header, a total, a blank.
   *  Reported rather than hidden: a paste that drops half the course should
   *  be visible before it is committed. */
  skipped: number;
}

/** Every number on a line, with the units a committee writes stripped. */
function numbersOn(line: string): number[] {
  return [...line.replace(/[°º]/g, ' ').matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}

/**
 * A leg table as the race committee hands it over, pasted: one leg per line,
 * the first two numbers its distance in nautical miles and its bearing in
 * degrees. Anything after them is ignored, so ORC's own four-column form
 * (weight, bearing, wind direction, wind speed) pastes as it stands.
 *
 * A leading row-number column is dropped only when *every* line has one and
 * they run 1, 2, 3 … — a signal, not a guess. Anything else is read as the
 * distance, and the caller shows what was parsed before it is committed.
 */
export function parseLegTable(text: string): ParsedLegTable {
  const lines = text.split(/\r?\n/).map(numbersOn).filter((nums) => nums.length > 0);
  const numbered =
    lines.length > 1 &&
    lines.every((nums, i) => nums.length >= 3 && nums[0] === i + 1);
  const rows = numbered ? lines.map((nums) => nums.slice(1)) : lines;

  const legs: SeriesCourseLeg[] = [];
  let skipped = 0;
  for (const nums of rows) {
    const [distanceNm, bearingDeg] = nums;
    if (
      nums.length < 2 ||
      !Number.isFinite(distanceNm) || distanceNm <= 0 ||
      !Number.isFinite(bearingDeg) || bearingDeg < 0 || bearingDeg > 360
    ) {
      skipped++;
      continue;
    }
    legs.push({ distanceNm, bearingDeg });
  }
  // A line with numbers on it but no legs at all is a header or a total, not
  // a course; saying "3 lines skipped" there is noise.
  return { legs, skipped: legs.length === 0 ? 0 : skipped };
}

const round = (n: number, dp: number): number => Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * A leg's distance as ORC records it: to 0.01 NM (rule 401.3, "when the
 * length of the course is needed for calculation of corrected time, it shall
 * be recorded to a precision of 0.01 NM"), which is also what ORC Scorer
 * holds and what the app has always displayed. Every leg reaching storage
 * goes through here, so the figure a results page prints is the figure the
 * performance curve was read at.
 */
export function legDistance(nm: number): number {
  return round(nm, 2);
}

/** Fill a start's leg table: each leg's distance to 0.01 NM and bearing to
 *  0.1°, with the one wind the scorer gave for the whole course — its
 *  direction always, and its speed where the option scores at the wind the
 *  race committee recorded. Per-leg overrides and sub-legs are then edits to
 *  the table itself. */
export function legsForStart(
  legs: readonly SeriesCourseLeg[],
  windDirectionDeg: number,
  windSpeedKts?: number,
): OrcCourseLeg[] {
  return legs.map((leg) => ({
    distanceNm: legDistance(leg.distanceNm),
    bearingDeg: round(leg.bearingDeg, 1),
    windDirectionDeg,
    ...(windSpeedKts != null ? { windSpeedKts } : {}),
  }));
}

/** Do a start's legs still match what its course gives, to the precision
 *  legsForStart writes? Sub-legs, a nudged distance, or a per-leg wind all
 *  say no: the scorer edited the table, and a recompute would discard it.
 *  Distances compare at the precision they are recorded to, so a table
 *  filled when the app wrote thousandths is still the course's own. */
export function legsMatch(legs: OrcCourseLeg[], fromCourse: OrcCourseLeg[]): boolean {
  if (legs.length !== fromCourse.length) return false;
  return legs.every((leg, i) => {
    const c = fromCourse[i];
    return (
      legDistance(leg.distanceNm) === legDistance(c.distanceNm) &&
      Math.abs(((leg.bearingDeg - c.bearingDeg + 540) % 360) - 180) < 0.15 &&
      leg.windDirectionDeg === c.windDirectionDeg &&
      leg.windSpeedKts === c.windSpeedKts &&
      leg.currentSpeedKts == null &&
      leg.currentDirectionDeg == null
    );
  });
}

/**
 * How a start's legs read on the wind speed they were scored at: one figure
 * where every leg shares it, a range where they don't, and the fact that one
 * is missing where the course is short of what a recorded-wind option needs.
 * Null when no leg carries a speed at all — the ordinary case, and the one
 * performance-curve scoring is in.
 */
export function recordedWindSummary(legs: OrcCourseLeg[] | undefined): string | null {
  if (!legs || legs.length === 0) return null;
  const speeds = legs.map((leg) => leg.windSpeedKts).filter((kt): kt is number => kt != null && kt > 0);
  if (speeds.length === 0) return null;
  if (speeds.length < legs.length) return 'wind speed missing';
  const lo = Math.min(...speeds);
  const hi = Math.max(...speeds);
  return lo === hi ? `${lo} kt` : `${lo}–${hi} kt`;
}

/** The snapshot a start keeps when it picks a course: the marks' positions
 *  as they were, or — on a course defined by legs, which has no positions —
 *  the leg table it gave. */
export function snapshotOfCourse(
  course: Pick<SeriesCourse, 'id' | 'name' | 'marks' | 'legs'>,
  marksById: ReadonlyMap<string, SeriesMark>,
  windDirectionDeg?: number,
  windSpeedKts?: number,
): RaceStartCourse {
  const legTable = courseIsLegTable(course);
  const { waypoints } = legTable ? { waypoints: [] } : resolveCourse(course.marks, marksById);
  return {
    courseId: course.id,
    name: course.name,
    waypoints,
    ...(legTable ? { legs: course.legs } : {}),
    ...(windDirectionDeg != null ? { windDirectionDeg } : {}),
    ...(windSpeedKts != null ? { windSpeedKts } : {}),
  };
}

/** Has the library course moved under a start's snapshot — a mark corrected,
 *  the sequence edited, a leg retyped — since the start picked it? Positions
 *  compare to the metre; a leg table compares to the precision it is entered
 *  at. A course no longer in the library is not "out of date": there is
 *  nothing to recompute from. */
export function courseOutOfDate(
  snapshot: RaceStartCourse,
  course: Pick<SeriesCourse, 'marks' | 'legs'> | undefined,
  marksById: ReadonlyMap<string, SeriesMark>,
): boolean {
  if (!course) return false;
  // A course defined by legs has no positions to compare; what can have
  // moved is the table itself.
  if (courseIsLegTable(course)) {
    const then = snapshot.legs ?? [];
    const now = course.legs ?? [];
    if (then.length !== now.length) return true;
    return now.some((leg, i) => (
      Math.abs(leg.distanceNm - then[i].distanceNm) > 1e-9 ||
      Math.abs(((leg.bearingDeg - then[i].bearingDeg + 540) % 360) - 180) > 1e-9
    ));
  }
  const now = resolveCourse(course.marks, marksById).waypoints;
  if (now.length !== snapshot.waypoints.length) return true;
  return now.some((w, i) => {
    const s = snapshot.waypoints[i];
    return (
      Math.abs(w.lat - s.lat) > 1e-5 ||
      Math.abs(w.lng - s.lng) > 1e-5 ||
      (w.side ?? undefined) !== (s.side ?? undefined) ||
      Boolean(w.passing) !== Boolean(s.passing)
    );
  });
}

// ─── Drawing ─────────────────────────────────────────────────────────────────

/**
 * A leg table drawn: its legs walked from an arbitrary origin, so the shape
 * and the orientation are the committee's own and the position on the water
 * is not claimed at all. Nothing here is stored — a course defined by legs
 * has no positions, and inventing some to keep would be a fiction the
 * published page would go on repeating.
 *
 * `closureNm` is how far the last leg ends from where the first began. A
 * table rounded to a tenth of a mile does not close exactly, so this is a
 * figure to read rather than an error to flag — but a course with a leg
 * missing or a digit dropped will not close by anything like a rounding.
 */
export function drawnLegTable(legs: readonly SeriesCourseLeg[]): {
  marks: DrawnMark[];
  course: DrawnCourseMark[];
  closureNm: number;
} {
  // Mid-latitude so the projection behaves; which point is immaterial, and
  // the drawing shows no coordinates.
  let at: Position = { lat: 53.5, lng: -6.1 };
  const marks: DrawnMark[] = [{ id: 'p0', label: 'Start', position: at }];
  for (const [i, leg] of legs.entries()) {
    at = destination(at, leg.bearingDeg, leg.distanceNm * METRES_PER_NM);
    marks.push({
      id: `p${i + 1}`,
      label: i === legs.length - 1 ? 'Finish' : String(i + 1),
      position: at,
    });
  }
  return {
    marks,
    course: marks.map((m) => ({ mark: m.id })),
    closureNm: legs.length > 0 ? positionsApartNm(marks[0].position, at) : 0,
  };
}

/** The library's marks as the renderer takes them. */
export function drawnMarks(marks: SeriesMark[]): DrawnMark[] {
  return marks.map((m) => ({
    id: m.id,
    label: markLabel(m),
    position: { lat: m.lat, lng: m.lng },
    ...(m.card ? { fixed: true } : {}),
  }));
}

/** A course's sequence as the renderer takes it, over the library's marks. */
export function drawnCourse(marks: SeriesCourseMark[]): DrawnCourseMark[] {
  return marks.map((cm) => ({
    mark: cm.markId,
    ...(cm.side ? { side: cm.side } : {}),
    ...(cm.passing ? { passing: true } : {}),
  }));
}

/**
 * A start's snapshot drawn, whichever kind of course it came from: the
 * waypoints where it has any, and otherwise the leg table walked from an
 * arbitrary origin. `fromLegs` says which, because a drawing with no
 * position on the water has to be captioned as one — it is not the same
 * artefact as a course drawn from surveyed marks, and on a published page
 * the two would be indistinguishable.
 */
export function drawnStartCourse(snapshot: RaceStartCourse): {
  marks: DrawnMark[];
  course: DrawnCourseMark[];
  fromLegs: boolean;
} {
  if (snapshot.waypoints.length === 0 && (snapshot.legs?.length ?? 0) > 0) {
    const { marks, course } = drawnLegTable(snapshot.legs!);
    return { marks, course, fromLegs: true };
  }
  return { ...drawnSnapshot(snapshot), fromLegs: false };
}

/** A start's snapshot as the renderer takes it: the waypoints stand on
 *  their own, so a repeated mark is one drawn mark visited twice. Positions
 *  only — a course defined by legs has none, and draws through
 *  `drawnStartCourse`. */
export function drawnSnapshot(snapshot: RaceStartCourse): { marks: DrawnMark[]; course: DrawnCourseMark[] } {
  const marks = new Map<string, DrawnMark>();
  const course: DrawnCourseMark[] = [];
  snapshot.waypoints.forEach((w, i) => {
    const id = w.markId ?? `${w.label}\0${w.lat}\0${w.lng}\0${i}`;
    if (!marks.has(id)) {
      marks.set(id, { id, label: w.label, position: { lat: w.lat, lng: w.lng }, ...(w.fixed ? { fixed: true } : {}) });
    }
    course.push({ mark: id, ...(w.side ? { side: w.side } : {}), ...(w.passing ? { passing: true } : {}) });
  });
  return { marks: [...marks.values()], course };
}

// ─── Adopting a card ─────────────────────────────────────────────────────────

export interface CardRef {
  set: string;
  cardId: string;
  release: string;
}

/**
 * The marks a card set places itself, as library rows: every mark with a
 * position, and the card's start and finishing lines where those are fixed.
 * A mark already adopted from the same set (matched on the card's mark id)
 * keeps its row and takes the set's current position and description; the
 * rest are new. Marks laid per race are not adopted — the scorer makes
 * those.
 */
export function adoptCardMarks(
  marksFile: MarksFile,
  card: CourseCardFile | undefined,
  ref: Pick<CardRef, 'set' | 'release'>,
  seriesId: string,
  existing: SeriesMark[],
  now: number,
): SeriesMark[] {
  const byCardId = new Map(existing.filter((m) => m.card?.set === ref.set).map((m) => [m.card!.markId, m]));
  const placed = [
    ...marksFile.marks,
    ...(card?.startLine ? [card.startLine] : []),
    ...(card?.finish ? [card.finish] : []),
  ].filter(
    (m): m is typeof m & { position: Position } => m.position != null,
  );
  return placed.map((m) => {
    const prior = byCardId.get(m.id);
    return {
      id: prior?.id ?? crypto.randomUUID(),
      seriesId,
      name: prior?.name ?? (m.name ? `${m.id} ${m.name}` : m.id),
      lat: m.position.lat,
      lng: m.position.lng,
      card: { set: ref.set, markId: m.id, release: ref.release },
      ...(m.shape ? { shape: m.shape } : {}),
      ...(m.color ? { color: m.color } : {}),
      createdAt: prior?.createdAt ?? now,
    };
  });
}

/** A card course's entries, each with the library mark that stands for it
 *  where one does — an adopted mark for a fixed one, the scorer's chosen
 *  mark for a laid one — or nothing yet. */
export interface CardCourseEntry {
  resolved: ResolvedCourseMark;
  mark?: SeriesMark;
}

/**
 * Match a card course's sequence to the library: fixed marks resolve to the
 * marks adopted from the set; marks the card cannot place resolve through
 * `placements` (card mark id → library mark id), the scorer's answers to
 * "which mark is Z today?".
 */
export function matchCardCourse(
  card: CourseCardFile,
  marksFile: MarksFile,
  courseId: string,
  set: string,
  library: SeriesMark[],
  placements: Record<string, string>,
): CardCourseEntry[] {
  const adopted = new Map(library.filter((m) => m.card?.set === set).map((m) => [m.card!.markId, m]));
  const byId = new Map(library.map((m) => [m.id, m]));
  return courseMarks(card, marksFile, courseId).map((resolved) => {
    const placement = placements[resolved.mark.id];
    const mark = placement ? byId.get(placement) : resolved.placed ? adopted.get(resolved.mark.id) : undefined;
    return { resolved, ...(mark ? { mark } : {}) };
  });
}

/** The entries of a matched course still without a mark: what the New
 *  course dialog asks for, in the card's own words. */
export function unplacedEntries(entries: CardCourseEntry[]): CardCourseEntry[] {
  return entries.filter((e) => !e.mark);
}

/** A library course from a fully matched card course. */
export function courseFromCard(
  entries: CardCourseEntry[],
  ref: CardRef,
  courseId: string,
  seriesId: string,
  name: string,
  now: number,
): SeriesCourse {
  if (entries.some((e) => !e.mark)) throw new Error('every mark of the course must be placed');
  return {
    id: crypto.randomUUID(),
    seriesId,
    name,
    card: { ...ref, courseId },
    marks: entries.map((e) => ({
      markId: e.mark!.id,
      ...(e.resolved.entry.side ? { side: e.resolved.entry.side } : {}),
      ...(e.resolved.entry.passing ? { passing: true } : {}),
    })),
    createdAt: now,
  };
}

/** The wind a card lays a course out for, where it says. */
export function windForCardCourse(card: CourseCardFile, courseId: string): number | undefined {
  return card.courses.find((c) => c.id === courseId)?.windDirectionDeg;
}

/** Is a course's sequence still the card's? Checked by mark id and side,
 *  so a swapped laid mark (Z outer for Z inner) is not a modification —
 *  the card said Z, and it is still Z — but a dropped or added mark is. */
export function sequenceMatchesCard(
  marks: SeriesCourseMark[],
  marksById: ReadonlyMap<string, SeriesMark>,
  cardSequence: ResolvedCourseMark[],
): boolean {
  if (marks.length !== cardSequence.length) return false;
  return marks.every((cm, i) => {
    const mark = marksById.get(cm.markId);
    const entry = cardSequence[i];
    if (!mark) return false;
    const cardMarkId = mark.card?.markId;
    // A laid mark stands for whatever unplaced card mark it was chosen for;
    // only an adopted mark has a card id to compare.
    if (entry.placed && cardMarkId !== entry.mark.id) return false;
    return (cm.side ?? undefined) === (entry.entry.side ?? undefined) && Boolean(cm.passing) === Boolean(entry.entry.passing);
  });
}
