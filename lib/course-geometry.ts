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

const round = (n: number, dp: number): number => Math.round(n * 10 ** dp) / 10 ** dp;

/** Fill a start's leg table: each leg's distance to 0.001 NM and bearing to
 *  0.1°, with the one wind direction the scorer gave for the whole course.
 *  Per-leg overrides and sub-legs are then edits to the table itself. */
export function legsForStart(legs: CourseLeg[], windDirectionDeg: number): OrcCourseLeg[] {
  return legs.map((leg) => ({
    distanceNm: round(leg.distanceNm, 3),
    bearingDeg: round(leg.bearingDeg, 1),
    windDirectionDeg,
  }));
}

/** Do a start's legs still match what its course gives, to the precision
 *  legsForStart writes? Sub-legs, a nudged distance, or a per-leg wind all
 *  say no: the scorer edited the table, and a recompute would discard it. */
export function legsMatch(legs: OrcCourseLeg[], fromCourse: OrcCourseLeg[]): boolean {
  if (legs.length !== fromCourse.length) return false;
  return legs.every((leg, i) => {
    const c = fromCourse[i];
    return (
      Math.abs(leg.distanceNm - c.distanceNm) < 0.0015 &&
      Math.abs(((leg.bearingDeg - c.bearingDeg + 540) % 360) - 180) < 0.15 &&
      leg.windDirectionDeg === c.windDirectionDeg &&
      leg.currentSpeedKts == null &&
      leg.currentDirectionDeg == null
    );
  });
}

/** The snapshot a start keeps when it picks a course. */
export function snapshotOfCourse(
  course: Pick<SeriesCourse, 'id' | 'name' | 'marks'>,
  marksById: ReadonlyMap<string, SeriesMark>,
  windDirectionDeg?: number,
): RaceStartCourse {
  const { waypoints } = resolveCourse(course.marks, marksById);
  return {
    courseId: course.id,
    name: course.name,
    waypoints,
    ...(windDirectionDeg != null ? { windDirectionDeg } : {}),
  };
}

/** Has the library course moved under a start's snapshot — a mark corrected,
 *  the sequence edited — since the start picked it? Positions compare to the
 *  metre. A course no longer in the library is not "out of date": there is
 *  nothing to recompute from. */
export function courseOutOfDate(
  snapshot: RaceStartCourse,
  course: Pick<SeriesCourse, 'marks'> | undefined,
  marksById: ReadonlyMap<string, SeriesMark>,
): boolean {
  if (!course) return false;
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

/** A start's snapshot as the renderer takes it: the waypoints stand on
 *  their own, so a repeated mark is one drawn mark visited twice. */
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
 * position, and the card's start line where that is fixed. A mark already
 * adopted from the same set (matched on the card's mark id) keeps its row
 * and takes the set's current position and description; the rest are new.
 * Marks laid per race are not adopted — the scorer makes those.
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
  const placed = [...marksFile.marks, ...(card?.startLine ? [card.startLine] : [])].filter(
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
