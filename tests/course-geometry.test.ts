import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { courseLegs, destination, parseCourseCardFile, parseMarksFile } from '@sailscoring/course-cards';
import { describe, expect, it } from 'vitest';

import {
  adoptCardMarks,
  cardMarksToPlace,
  cardMarksToWrite,
  courseFromCard,
  courseOutOfDate,
  courseRoutingSummary,
  drawnCourse,
  drawnMarks,
  drawnSnapshot,
  legsOfWaypoints,
  routedDrawing,
  legsForStart,
  legsMatch,
  markLabel,
  matchCardCourse,
  positionFrom,
  proposeCourseName,
  courseIsLegTable,
  courseLegsOf,
  drawnLegTable,
  drawnRaceStartCourse,
  drawingSet,
  drawnStartCourse,
  parseLegTable,
  proposeMarkName,
  recordedWindSummary,
  resolveCourse,
  sequenceMatchesCard,
  shortDayLabel,
  snapshotOfCourse,
  unplacedEntries,
  windForCardCourse,
} from '@/lib/course-geometry';
import { courseRoutingFor } from '@/lib/course-cards/routing';
import type { SeriesCourse, SeriesMark } from '@/lib/types';

function load(rel: string): unknown {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', 'course-cards', rel), 'utf-8'));
}

// HYC Brass Monkey 2025: eight fixed marks, a laid finish, and a start line
// the SIs place on the day.
const bmMarks = parseMarksFile(load('hyc/brass-monkey-2025/marks.json'));
const bmCard = parseCourseCardFile(load('hyc/brass-monkey-2025/course-card.json'));
const BM = { set: 'hyc/brass-monkey-2025', cardId: 'course-card', release: '0.3.0' };
const alMarks = parseMarksFile(load('hyc/al-2026/marks.json'));
const alCard = parseCourseCardFile(load('hyc/al-2026/offshore.json'));

const start = { lat: 53.4055, lng: -6.0675 };
const NOW = 1_700_000_000_000;

function laid(id: string, name: string, position: { lat: number; lng: number }): SeriesMark {
  return { id, seriesId: 's1', name, lat: position.lat, lng: position.lng, createdAt: NOW };
}

describe('names and labels', () => {
  it('proposes the date and race, leaving the qualifier to the scorer', () => {
    expect(shortDayLabel('2026-09-06')).toBe('6 Sep');
    expect(shortDayLabel('2026-12-13T10:00:00Z')).toBe('13 Dec');
    expect(proposeMarkName('Z', { date: '2026-09-06', raceNumber: 2 })).toBe('Z — 6 Sep R2');
    expect(proposeMarkName('Start', { date: '2026-09-06' })).toBe('Start — 6 Sep');
    expect(proposeMarkName('F', {})).toBe('F');
    expect(proposeCourseName('004', { date: '2026-09-06', raceNumber: 2 })).toBe('004 — 6 Sep R2');
  });

  it('labels an adopted mark by its card letter and a laid one by its name before the qualifier', () => {
    expect(markLabel({ name: 'I Island', card: { set: 'x', markId: 'I', release: '0.3.0' } })).toBe('I');
    expect(markLabel({ name: 'Z outer — 6 Sep R2' })).toBe('Z outer');
    expect(markLabel({ name: 'Finish' })).toBe('Finish');
  });
});

describe('positions', () => {
  it('lays a mark off another in metres, cables or miles', () => {
    const inMiles = positionFrom(start, 190, 0.54, 'nm');
    expect(positionFrom(start, 190, 0.54 * 1852, 'm')).toEqual(inMiles);
    expect(positionFrom(start, 190, 5.4, 'cables')).toEqual(inMiles);
    expect(inMiles).toEqual(destination(start, 190, 0.54 * 1852));
  });
});

describe('adopting a card', () => {
  it('adopts every mark the set places, the laid ones left to the scorer', () => {
    const adopted = adoptCardMarks(bmMarks, bmCard, BM, 's1', [], NOW);
    expect(adopted.map((m) => m.card!.markId).join('')).toBe('CDHIPSVW');
    expect(adopted.every((m) => m.seriesId === 's1' && m.card!.set === BM.set && m.card!.release === '0.3.0')).toBe(true);
    const cush = adopted.find((m) => m.card!.markId === 'C')!;
    expect(cush).toMatchObject({ name: 'C Cush', lat: 53.408333, lng: -6.090667, shape: 'conical' });
    // The finish is laid per race, and the start line is placed on the day.
    expect(adopted.some((m) => m.card!.markId === 'F' || m.card!.markId === 'SL')).toBe(false);
  });

  it('adopts a finishing line the card places, and leaves one laid per race', () => {
    const al = adoptCardMarks(alMarks, alCard, { set: 'hyc/al-2026', release: '0.4.0' }, 's1', [], NOW);
    // The offshore card finishes at a transit on the East Pier, a position
    // it carries; the Brass Monkey's finish is a buoy laid for the race.
    expect(al.find((m) => m.card!.markId === 'FH')).toMatchObject({ name: 'FH Finish line', lat: 53.39334 });
    expect(adoptCardMarks(bmMarks, bmCard, BM, 's1', [], NOW).some((m) => m.card!.markId === 'F')).toBe(false);
  });

  it('re-adopting keeps the rows and names already in the library and refreshes positions', () => {
    const first = adoptCardMarks(bmMarks, bmCard, BM, 's1', [], NOW);
    const renamed = first.map((m) => (m.card!.markId === 'C' ? { ...m, name: 'Cush (moved)', lat: 0 } : m));
    const again = adoptCardMarks(bmMarks, bmCard, BM, 's1', renamed, NOW + 1);
    const cush = again.find((m) => m.card!.markId === 'C')!;
    expect(cush.id).toBe(first.find((m) => m.card!.markId === 'C')!.id);
    expect(cush.name).toBe('Cush (moved)');
    expect(cush.lat).toBe(53.408333);
    expect(cush.createdAt).toBe(NOW);
    expect(again.map((m) => m.id).sort()).toEqual(first.map((m) => m.id).sort());
  });

  it('writes the marks a course uses that the library lacks or holds where an older release put them', () => {
    const OLD = { ...BM, release: '0.2.0' };
    const first = adoptCardMarks(bmMarks, bmCard, OLD, 's1', [], NOW);
    const cushId = first.find((m) => m.card!.markId === 'C')!.id;
    const islandId = first.find((m) => m.card!.markId === 'I')!.id;
    const deliId = first.find((m) => m.card!.markId === 'D')!.id;
    // The library has Cush 82 m south of where the set now has it, at the
    // older release, and Island as it is now but read at the older release;
    // it never adopted Deli.
    const library = first
      .filter((m) => m.id !== deliId)
      .map((m) => (m.id === cushId ? { ...m, ...positionFrom({ lat: m.lat, lng: m.lng }, 180, 82, 'm'), version: 3 } : m));
    const adopted = adoptCardMarks(bmMarks, bmCard, BM, 's1', library, NOW + 1);
    const newDeliId = adopted.find((m) => m.card!.markId === 'D')!.id;
    const { marks, moved } = cardMarksToWrite(adopted, library, new Set([cushId, islandId, newDeliId]));
    expect(marks.map((m) => m.card!.markId).sort()).toEqual(['C', 'D', 'I']);
    expect(marks.find((m) => m.id === cushId)).toMatchObject({ lat: 53.408333, version: 3, card: { release: '0.3.0' } });
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ mark: { id: cushId }, fromRelease: '0.2.0' });
    expect(moved[0].metres).toBeCloseTo(82, 0);
    // A mark the course doesn't use is left alone, however far it moved.
    expect(cardMarksToWrite(adopted, library, new Set([islandId])).moved).toEqual([]);
    // Nothing to write once the library is current.
    expect(cardMarksToWrite(adopted, adopted, new Set([cushId, islandId, newDeliId])).marks).toEqual([]);
  });

  it('matches a card course to the library and says which marks it still needs, in the club’s words', () => {
    const library = adoptCardMarks(bmMarks, bmCard, BM, 's1', [], NOW);
    const entries = matchCardCourse(bmCard, bmMarks, '10', BM.set, library, {});
    expect(entries.map((e) => e.resolved.mark.id)).toEqual(bmCard.courses.find((c) => c.id === '10')!.marks.map((m) => m.mark));
    const needed = unplacedEntries(entries);
    expect(needed.map((e) => e.resolved.mark.id)).toEqual(['SL', 'F']);
    expect(needed[1].resolved.mark.placement).toBe('South of the Island mark in the vicinity of the Sound');
    expect(entries.filter((e) => e.mark).every((e) => e.mark!.card?.markId === e.resolved.mark.id)).toBe(true);
  });

  it('asks once for a line the course both starts and finishes at', () => {
    // As RCYC's keelboat cards do: the run home ends at the start line.
    const card = { ...bmCard, courses: [...bmCard.courses, { id: '99', marks: [{ mark: 'SL' }, { mark: 'I', side: 'port' as const }, { mark: 'SL' }] }] };
    const library = adoptCardMarks(bmMarks, card, BM, 's1', [], NOW);
    const entries = matchCardCourse(card, bmMarks, '99', BM.set, library, {});
    expect(unplacedEntries(entries).map((e) => e.resolved.mark.id)).toEqual(['SL']);
    expect(cardMarksToPlace(entries).map((e) => e.resolved.mark.id)).toEqual(['SL']);
    // Placing it once places both ends, and the row stays to show the pick.
    const placed = matchCardCourse(card, bmMarks, '99', BM.set, [...library, laid('line', 'Start — 13 Dec', start)], { SL: 'line' });
    expect(unplacedEntries(placed)).toEqual([]);
    expect(cardMarksToPlace(placed).map((e) => e.resolved.mark.id)).toEqual(['SL']);
    expect(courseFromCard(placed, BM, '99', 's1', '99', NOW).marks.map((m) => m.markId)).toEqual(['line', expect.any(String), 'line']);
  });

  it('builds the course once the scorer has placed the rest, and its legs are the library’s', () => {
    const library = [
      ...adoptCardMarks(bmMarks, bmCard, BM, 's1', [], NOW),
      laid('line', 'Start — 13 Dec', start),
      laid('fin', 'F — 13 Dec', { lat: 53.4085, lng: -6.0705 }),
    ];
    const entries = matchCardCourse(bmCard, bmMarks, '10', BM.set, library, { SL: 'line', F: 'fin' });
    expect(unplacedEntries(entries)).toEqual([]);
    const course = courseFromCard(entries, BM, '10', 's1', proposeCourseName('10', { date: '2025-12-13' }), NOW);
    expect(course.name).toBe('10 — 13 Dec');
    expect(course.card).toEqual({ ...BM, courseId: '10' });
    // The marks the scorer placed keep the card marks they stand for; the
    // adopted ones carry their own.
    expect(course.marks[0]).toEqual({ markId: 'line', cardMarkId: 'SL' });
    expect(course.marks[course.marks.length - 1]).toEqual({ markId: 'fin', cardMarkId: 'F' });
    expect(course.marks.slice(1, -1).every((m) => !m.cardMarkId)).toBe(true);

    const marksById = new Map(library.map((m) => [m.id, m]));
    const resolved = resolveCourse(course.marks, marksById);
    const reference = courseLegs(bmCard, bmMarks, '10', { marks: { SL: start, F: { lat: 53.4085, lng: -6.0705 } } });
    expect(resolved.legs.map((l) => [l.distanceNm, l.bearingDeg])).toEqual(reference.map((l) => [l.distanceNm, l.bearingDeg]));
    expect(resolved.totalNm).toBeCloseTo(reference.reduce((s, l) => s + l.distanceNm, 0), 9);
    expect(resolved.missingMarkIds).toEqual([]);
    expect(resolved.waypoints[0]).toMatchObject({ markId: 'line', label: 'Start', lat: start.lat });
    expect(resolved.waypoints[1]).toMatchObject({ fixed: true, set: BM.set });
    // A mark the committee laid belongs to no set: there is no chart it
    // came off, and the course is drawn on the club's.
    expect(resolved.waypoints[0].set).toBeUndefined();
    expect(sequenceMatchesCard(course.marks, marksById, entries.map((e) => e.resolved))).toBe(true);
  });

  it('a swapped laid mark is still the card’s course; a dropped mark is not', () => {
    const library = [
      ...adoptCardMarks(bmMarks, bmCard, BM, 's1', [], NOW),
      laid('line', 'Start', start),
      laid('fin', 'F inner', { lat: 53.4085, lng: -6.0705 }),
      laid('fin2', 'F outer', { lat: 53.409, lng: -6.071 }),
    ];
    const entries = matchCardCourse(bmCard, bmMarks, '10', BM.set, library, { SL: 'line', F: 'fin' });
    const course = courseFromCard(entries, BM, '10', 's1', '10', NOW);
    const marksById = new Map(library.map((m) => [m.id, m]));
    const card = entries.map((e) => e.resolved);
    const swapped = course.marks.map((cm) => (cm.markId === 'fin' ? { ...cm, markId: 'fin2' } : cm));
    expect(sequenceMatchesCard(swapped, marksById, card)).toBe(true);
    expect(sequenceMatchesCard(course.marks.slice(0, -1), marksById, card)).toBe(false);
    const resided = course.marks.map((cm, i) => (i === 1 ? { ...cm, side: 'starboard' as const } : cm));
    expect(sequenceMatchesCard(resided, marksById, card)).toBe(false);
  });

  it('reads the wind a card lays a course out for', () => {
    expect(windForCardCourse(alCard, 'K3')).toBe(180);
    expect(windForCardCourse(alCard, 'A1')).toBe(0);
    expect(windForCardCourse(bmCard, '10')).toBeUndefined();
    const adopted = adoptCardMarks(alMarks, alCard, { set: 'hyc/al-2026', release: '0.4.0' }, 's1', [], NOW);
    expect(adopted).toHaveLength(23);
  });
});

describe('a start’s legs and snapshot', () => {
  const library = [
    laid('line', 'Start — 6 Sep', start),
    laid('z', 'Z — 6 Sep R2', destination(start, 190, 1000)),
  ];
  const marksById = new Map(library.map((m) => [m.id, m]));
  const course: SeriesCourse = {
    id: 'c1', seriesId: 's1', name: 'W/L — 6 Sep R2',
    marks: [{ markId: 'line' }, { markId: 'z', side: 'port' }, { markId: 'line', side: 'port' }],
    createdAt: NOW,
  };

  it('fills the leg table to a hundredth of a mile and a tenth of a degree, with the wind on every leg', () => {
    const legs = legsForStart(resolveCourse(course.marks, marksById).legs, 190);
    expect(legs).toEqual([
      { distanceNm: 0.54, bearingDeg: 190, windDirectionDeg: 190 },
      { distanceNm: 0.54, bearingDeg: 10, windDirectionDeg: 190 },
    ]);
  });

  it('records a leg to 0.01 NM, the precision ORC scores a course at', () => {
    // 958 m is 0.5173 NM: the case that separates the two roundings, and the
    // one a course built from marks lands on nearly every time.
    const odd = [laid('line', 'Start', start), laid('z', 'Z', destination(start, 190, 958))];
    const byId = new Map(odd.map((m) => [m.id, m]));
    const legs = legsForStart(
      resolveCourse([{ markId: 'line' }, { markId: 'z' }], byId).legs, 190,
    );
    expect(legs.map((l) => l.distanceNm)).toEqual([0.52]);
  });

  it('spreads a recorded wind speed over every leg, and keeps it in the snapshot', () => {
    const legs = legsForStart(resolveCourse(course.marks, marksById).legs, 190, 9);
    expect(legs).toEqual([
      { distanceNm: 0.54, bearingDeg: 190, windDirectionDeg: 190, windSpeedKts: 9 },
      { distanceNm: 0.54, bearingDeg: 10, windDirectionDeg: 190, windSpeedKts: 9 },
    ]);
    // Held on the snapshot too, so a recompute puts it back rather than
    // dropping it and leaving the race unscored.
    expect(snapshotOfCourse(course, marksById, 190, 9)).toMatchObject({ windSpeedKts: 9 });
    expect(snapshotOfCourse(course, marksById, 190)).not.toHaveProperty('windSpeedKts');
  });

  it('reads what the legs say the wind was, or that a leg is missing it', () => {
    const at = (speeds: Array<number | undefined>) =>
      recordedWindSummary(speeds.map((windSpeedKts) => ({
        distanceNm: 1, bearingDeg: 0, windDirectionDeg: 190,
        ...(windSpeedKts != null ? { windSpeedKts } : {}),
      })));
    expect(at([9, 9])).toBe('9 kt');
    expect(at([8, 14])).toBe('8–14 kt');
    expect(at([9, undefined])).toBe('wind speed missing');
    // No leg carries one: the ordinary case, and the one performance curves
    // are in — nothing to say rather than something missing.
    expect(at([undefined, undefined])).toBeNull();
    expect(recordedWindSummary(undefined)).toBeNull();
    expect(recordedWindSummary([])).toBeNull();
  });

  it('knows when the legs were edited: split, nudged, per-leg wind, or current', () => {
    const fromCourse = legsForStart(resolveCourse(course.marks, marksById).legs, 190);
    expect(legsMatch(fromCourse, fromCourse)).toBe(true);
    expect(legsMatch([...fromCourse, { distanceNm: 0.1, bearingDeg: 10, windDirectionDeg: 190 }], fromCourse)).toBe(false);
    expect(legsMatch([{ ...fromCourse[0], distanceNm: 0.55 }, fromCourse[1]], fromCourse)).toBe(false);
    expect(legsMatch([{ ...fromCourse[0], windDirectionDeg: 195 }, fromCourse[1]], fromCourse)).toBe(false);
    expect(legsMatch([{ ...fromCourse[0], currentSpeedKts: 1 }, fromCourse[1]], fromCourse)).toBe(false);
    expect(legsMatch([{ ...fromCourse[0], windSpeedKts: 9 }, fromCourse[1]], fromCourse)).toBe(false);
    // 359.9 and 0.0 are the same bearing
    expect(legsMatch([{ distanceNm: 1, bearingDeg: 359.95, windDirectionDeg: 0 }], [{ distanceNm: 1, bearingDeg: 0, windDirectionDeg: 0 }])).toBe(true);
    // A table filled when the app wrote thousandths is the same course as the
    // hundredths it writes now — not a scorer's edit.
    expect(legsMatch(
      [{ distanceNm: 0.517, bearingDeg: 89.1, windDirectionDeg: 0 }],
      [{ distanceNm: 0.52, bearingDeg: 89.1, windDirectionDeg: 0 }],
    )).toBe(true);
    // A hundredth apart is a nudge the scorer made, and survives a recompute.
    expect(legsMatch(
      [{ distanceNm: 0.53, bearingDeg: 89.1, windDirectionDeg: 0 }],
      [{ distanceNm: 0.52, bearingDeg: 89.1, windDirectionDeg: 0 }],
    )).toBe(false);
  });

  it('snapshots the course as it is now, and notices when the library moves under it', () => {
    const snapshot = snapshotOfCourse(course, marksById, 190);
    expect(snapshot).toMatchObject({ courseId: 'c1', name: 'W/L — 6 Sep R2', windDirectionDeg: 190 });
    expect(snapshot.waypoints.map((w) => w.label)).toEqual(['Start', 'Z', 'Start']);
    expect(courseOutOfDate(snapshot, course, marksById)).toBe(false);

    const moved = new Map(marksById);
    moved.set('z', { ...marksById.get('z')!, lat: 53.39 });
    expect(courseOutOfDate(snapshot, course, moved)).toBe(true);
    expect(courseOutOfDate(snapshot, { marks: course.marks.slice(0, 2) }, marksById)).toBe(true);
    expect(courseOutOfDate(snapshot, { marks: course.marks.map((cm, i) => (i === 1 ? { ...cm, side: 'starboard' as const } : cm)) }, marksById)).toBe(true);
    // Deleted from the library: nothing to be out of date against.
    expect(courseOutOfDate(snapshot, undefined, marksById)).toBe(false);
  });

  it('draws a snapshot on its own, a repeated mark visited twice', () => {
    const snapshot = snapshotOfCourse(course, marksById, 190);
    const drawn = drawnSnapshot(snapshot);
    expect(drawn.marks.map((m) => m.label)).toEqual(['Start', 'Z']);
    expect(drawn.course.map((c) => c.mark)).toEqual(['line', 'z', 'line']);
    const anonymous = drawnSnapshot({ ...snapshot, waypoints: snapshot.waypoints.map(({ markId: _id, ...w }) => w) });
    expect(anonymous.marks).toHaveLength(3);
    expect(anonymous.course).toHaveLength(3);
  });

  it('skips a mark the library no longer has and says so', () => {
    const resolved = resolveCourse([...course.marks, { markId: 'gone' }], marksById);
    expect(resolved.waypoints).toHaveLength(3);
    expect(resolved.missingMarkIds).toEqual(['gone']);
  });
});

describe('a course defined by the committee’s leg table', () => {
  const marksById = new Map<string, SeriesMark>();
  const legs = [
    { distanceNm: 2.09, bearingDeg: 162 },
    { distanceNm: 0.06, bearingDeg: 60 },
    { distanceNm: 1.91, bearingDeg: 340 },
  ];
  const legCourse = { marks: [], legs };
  const markCourse = { marks: [{ markId: 'a' }, { markId: 'b' }], legs: undefined };

  it('is told apart from a mark sequence, and gives its legs verbatim', () => {
    expect(courseIsLegTable(legCourse)).toBe(true);
    expect(courseIsLegTable(markCourse)).toBe(false);
    // Verbatim: the committee's own figures, not run through the geometry
    // and back with a rounding on each end.
    expect(courseLegsOf(legCourse, marksById)).toEqual(legs);
  });

  it('a mark course still derives its legs from the positions', () => {
    const library = [
      laid('line', 'Start — 6 Sep', start),
      laid('z', 'Z — 6 Sep R2', destination(start, 190, 1000)),
    ];
    const byId = new Map(library.map((m) => [m.id, m]));
    const derived = courseLegsOf({ marks: [{ markId: 'line' }, { markId: 'z' }] }, byId);
    expect(derived).toHaveLength(1);
    expect(derived[0].distanceNm).toBeCloseTo(0.54, 2);
    expect(derived[0].bearingDeg).toBeCloseTo(190, 1);
  });

  it('the snapshot a start takes carries the table, not waypoints', () => {
    const snapshot = snapshotOfCourse({ id: 'c1', name: 'From the RC', marks: [], legs }, marksById, 225, 9);
    expect(snapshot.waypoints).toEqual([]);
    expect(snapshot.legs).toEqual(legs);
    expect(snapshot).toMatchObject({ windDirectionDeg: 225, windSpeedKts: 9 });
  });

  it('notices when the library’s table has been retyped under a start', () => {
    const snapshot = snapshotOfCourse({ id: 'c1', name: 'From the RC', marks: [], legs }, marksById);
    expect(courseOutOfDate(snapshot, { marks: [], legs }, marksById)).toBe(false);
    // A leg nudged, a leg added, a leg dropped.
    expect(courseOutOfDate(snapshot, { marks: [], legs: [{ ...legs[0], distanceNm: 2.1 }, legs[1], legs[2]] }, marksById)).toBe(true);
    expect(courseOutOfDate(snapshot, { marks: [], legs: [...legs, { distanceNm: 1, bearingDeg: 90 }] }, marksById)).toBe(true);
    expect(courseOutOfDate(snapshot, { marks: [], legs: legs.slice(0, 2) }, marksById)).toBe(true);
    // A course that has left the library is not out of date; there is
    // nothing to recompute from.
    expect(courseOutOfDate(snapshot, undefined, marksById)).toBe(false);
  });

  it('a start’s snapshot draws either kind, and says which it drew', () => {
    // A leg course has no waypoints, so the placeholder "nothing to draw"
    // would be a lie: the course is complete, it simply has no positions.
    const legSnapshot = snapshotOfCourse({ id: 'c1', name: 'From the RC', marks: [], legs }, marksById, 225, 9);
    const fromLegs = drawnStartCourse(legSnapshot);
    expect(fromLegs.fromLegs).toBe(true);
    expect(fromLegs.marks).toHaveLength(legs.length + 1);
    expect(fromLegs.course.map((c) => c.mark)).toEqual(fromLegs.marks.map((m) => m.id));

    // A mark course draws its positions, and says so, which is what the
    // published page still keys off.
    const library = [
      laid('line', 'Start — 6 Sep', start),
      laid('z', 'Z — 6 Sep R2', destination(start, 190, 1000)),
    ];
    const byId = new Map(library.map((m) => [m.id, m]));
    const markSnapshot = snapshotOfCourse(
      { id: 'c2', name: 'W/L', marks: [{ markId: 'line' }, { markId: 'z' }] }, byId, 190,
    );
    const fromMarks = drawnStartCourse(markSnapshot);
    expect(fromMarks.fromLegs).toBe(false);
    expect(fromMarks.marks.map((m) => m.label)).toEqual(['Start', 'Z']);
    // Both marks were laid, so the drawing names no chart to sit on.
    expect(fromMarks.set).toBeUndefined();
  });

  it('draws what a start scored: its marks until the legs are edited, then the legs', () => {
    const library = [
      laid('line', 'Start — 6 Sep', start),
      laid('z', 'Z — 6 Sep R2', destination(start, 190, 1000)),
    ];
    const byId = new Map(library.map((m) => [m.id, m]));
    const snapshot = snapshotOfCourse(
      { id: 'c2', name: 'W/L', marks: [{ markId: 'line' }, { markId: 'z' }] }, byId, 190,
    );
    const scored = [
      { distanceNm: 1.2, bearingDeg: 300 },
      { distanceNm: 0.8, bearingDeg: 20 },
      { distanceNm: 1.5, bearingDeg: 250 },
    ];
    // The legs are still the course's own: the marks draw.
    const asPicked = drawnRaceStartCourse(snapshot, scored)!;
    expect(asPicked.fromLegs).toBe(false);
    expect(asPicked.marks.map((m) => m.label)).toEqual(['Start', 'Z']);
    // Edited: the scored legs draw, unlocated.
    const edited = drawnRaceStartCourse({ ...snapshot, legsEdited: true }, scored)!;
    expect(edited.fromLegs).toBe(true);
    expect(edited.marks.map((m) => m.label)).toEqual(['Start', '1', '2', 'Finish']);
    // No course at all: the typed legs are all there is.
    expect(drawnRaceStartCourse(undefined, scored)!.fromLegs).toBe(true);
    // Edited down to nothing still leaves the course to draw; no course and
    // no legs leaves nothing.
    expect(drawnRaceStartCourse({ ...snapshot, legsEdited: true }, [])!.fromLegs).toBe(false);
    expect(drawnRaceStartCourse(undefined, undefined)).toBeNull();
  });

  it('a snapshot names the chart its course belongs on, even once the mark is gone', () => {
    const library = [
      ...adoptCardMarks(bmMarks, bmCard, BM, 's1', [], NOW),
      laid('line', 'Start — 13 Dec', start),
    ];
    const byId = new Map(library.map((m) => [m.id, m]));
    const charted = library.find((m) => m.card)!;
    const snapshot = snapshotOfCourse(
      { id: 'c3', name: 'Out and back', marks: [{ markId: 'line' }, { markId: charted.id }, { markId: 'line' }] },
      byId,
      190,
    );
    expect(drawnStartCourse(snapshot).set).toBe(BM.set);
    // The point of holding it on the snapshot: the published page has the
    // snapshot and not the library, and the mark may since be deleted.
    expect(drawnStartCourse({ ...snapshot, waypoints: snapshot.waypoints.map((w) => ({ ...w, markId: undefined })) }).set)
      .toBe(BM.set);
  });

  it('draws a course over two clubs’ marks on the chart most of them came from', () => {
    expect(
      drawingSet([{ set: 'hyc/al-2026' }, {}, { set: 'dbsc/summer-2026' }, { set: 'hyc/al-2026' }]),
    ).toBe('hyc/al-2026');
    expect(drawingSet([{}, {}])).toBeUndefined();
  });

  it('fills a start’s leg table from either kind, stamping the race’s wind', () => {
    const filled = legsForStart(courseLegsOf(legCourse, marksById), 225, 9);
    expect(filled).toEqual([
      { distanceNm: 2.09, bearingDeg: 162, windDirectionDeg: 225, windSpeedKts: 9 },
      { distanceNm: 0.06, bearingDeg: 60, windDirectionDeg: 225, windSpeedKts: 9 },
      { distanceNm: 1.91, bearingDeg: 340, windDirectionDeg: 225, windSpeedKts: 9 },
    ]);
  });
});

describe('pasting a leg table', () => {
  const legsOf = (text: string) => parseLegTable(text).legs.map((l) => `${l.distanceNm}@${l.bearingDeg}`);

  it('takes the first two numbers on each line, whatever separates them', () => {
    for (const text of ['2.09 162\n0.06 60', '2.09\t162\n0.06\t60', '2.09, 162\n0.06, 60']) {
      expect(legsOf(text)).toEqual(['2.09@162', '0.06@60']);
    }
    // ORC's own four columns — weight, bearing, wind direction, wind speed —
    // paste as they stand, the wind ignored because it is the race's.
    expect(legsOf('0.80 59.0° 225.0° 9.00\n0.80 239.0° 225.0° 9.00')).toEqual(['0.8@59', '0.8@239']);
  });

  it('drops a row-number column only when every line has one in sequence', () => {
    expect(legsOf('1 2.09 162\n2 0.06 60\n3 1.91 340')).toEqual(['2.09@162', '0.06@60', '1.91@340']);
    // Out of sequence is not a row number, so the figures stand as given —
    // wrong, and visible in the preview rather than silently reinterpreted.
    expect(legsOf('1 2.09 162\n3 0.06 60')).toEqual(['1@2.09', '3@0.06']);
    // Two columns only: the first is the distance, never a row number.
    expect(legsOf('1 90\n2 270')).toEqual(['1@90', '2@270']);
  });

  it('skips what is not a leg, and counts it', () => {
    // A header has no numbers; a total has one; a bad bearing has two.
    const r = parseLegTable('Distance\tBearing\n2.09\t162\n0.06\t400\n\n1.91\t340\nTotal\t4.06');
    expect(r.legs.map((l) => l.bearingDeg)).toEqual([162, 340]);
    expect(r.skipped).toBe(2);
  });

  it('reads the reference a bearing is written in, and leaves it unset where none is', () => {
    const refsOf = (text: string) => parseLegTable(text).legs.map((l) => `${l.bearingDeg}${l.bearingRef ?? '?'}`);
    expect(refsOf('0.24 105M\n1.10 290°T\n0.80 059 M\n0.50 180')).toEqual(['105M', '290T', '59M', '180?']);
    // Lower case reads the same; a word that merely starts with M or T does not.
    expect(refsOf('0.24 105m\n0.30 200 Mark')).toEqual(['105M', '200?']);
    // A reference on the distance or on a later column is not the bearing's.
    expect(refsOf('1 0.24 105M 230T\n2 0.30 200 230T')).toEqual(['105M', '200?']);
  });

  it('finds nothing in a table with no legs at all, and says so quietly', () => {
    const r = parseLegTable('Distance Bearing\nTotal');
    expect(r.legs).toEqual([]);
    // No point reporting skipped lines when nothing was found: the caller
    // says "no legs found" instead.
    expect(r.skipped).toBe(0);
  });
});

describe('drawing a leg table', () => {
  it('walks the legs and reports how far the course misses its own start', () => {
    // A windward/leeward closes exactly.
    expect(drawnLegTable([{ distanceNm: 1, bearingDeg: 0 }, { distanceNm: 1, bearingDeg: 180 }]).closureNm)
      .toBeLessThan(1e-6);

    // The Cork course behind #583, as the committee gave it: twelve legs
    // rounded to a tenth of a mile, closing to a tenth.
    const cork = [[0.80, 59], [0.80, 239], [1.10, 130], [0.60, 228], [0.60, 23], [0.90, 311],
      [1.70, 32], [0.20, 218], [1.20, 196], [0.50, 249], [2.00, 26], [2.00, 206]]
      .map(([distanceNm, bearingDeg]) => ({ distanceNm, bearingDeg }));
    const drawn = drawnLegTable(cork);
    expect(drawn.marks).toHaveLength(13);
    expect(drawn.marks[0].label).toBe('Start');
    expect(drawn.marks[12].label).toBe('Finish');
    expect(drawn.course.map((c) => c.mark)).toEqual(drawn.marks.map((m) => m.id));
    expect(drawn.closureNm).toBeCloseTo(0.07, 2);

    // And with the one stray leg that actually got scored: nearly a mile
    // out, which no amount of rounding twelve legs explains.
    const withStray = [...cork.slice(0, 10), { distanceNm: 0.866, bearingDeg: 240.5 }, ...cork.slice(10)];
    expect(drawnLegTable(withStray).closureNm).toBeGreaterThan(0.9);
  });

  it('draws nothing for no legs', () => {
    const drawn = drawnLegTable([]);
    expect(drawn.marks).toHaveLength(1);
    expect(drawn.closureNm).toBe(0);
  });
});

// Royal Cork's keelboat card, routed by Pat Tanner's Cork Harbour passages:
// from the Grassy Walk line out to Ringabella and back in to Cage both cross
// Rams Head, so both are sailed round it, by W2.
describe('routing a course through its set\'s overlay', () => {
  const RC = 'rcyc/keelboat-2026';
  const overlay = courseRoutingFor(RC)!;
  const assumed = (id: string) => overlay.routing.assumed.find((a) => (a.id ?? a.mark) === id)!.position!;
  const adopted = (markId: string): SeriesMark => ({
    ...laid(`rc-${markId}`, markId, assumed(markId)),
    card: { set: RC, markId, release: '0.12.1' },
  });
  const line = laid('rc-line', 'SL — 6 Oct R1', assumed('SL@grassy-walk'));
  const marks = [line, adopted('Ringabella'), adopted('Cage')];
  const marksById = new Map(marks.map((m) => [m.id, m]));
  const sequence = [{ markId: 'rc-line' }, { markId: 'rc-Ringabella' }, { markId: 'rc-Cage' }];

  it('splits a leg the overlay routes into the legs sailed, and vouches for the rest', () => {
    const { legs, totalNm } = resolveCourse(sequence, marksById);
    expect(legs.map((l) => [l.from.label, l.to.label, l.review, l.cardLeg])).toEqual([
      ['SL', 'RW_Temblebreedy_Pier', 'passage', 0],
      ['RW_Temblebreedy_Pier', 'RW_Rams_Head', 'passage', 0],
      ['RW_Rams_Head', 'W2', 'passage', 0],
      ['W2', 'Ringabella', 'passage', 0],
      ['Ringabella', 'W2', 'passage', 1],
      ['W2', 'RW_Rams_Head', 'passage', 1],
      ['RW_Rams_Head', 'Cage', 'passage', 1],
    ]);
    const straight = courseLegs(
      { formatVersion: 1, club: 'x', name: 'x', courses: [{ id: '1', marks: [{ mark: 'R' }, { mark: 'C' }] }] } as never,
      { formatVersion: 1, marks: [{ id: 'R', position: assumed('Ringabella') }, { id: 'C', position: assumed('Cage') }] } as never,
      '1',
      {},
    )[0].distanceNm;
    const passage = legs.filter((l) => l.cardLeg === 1).reduce((sum, l) => sum + l.distanceNm, 0);
    expect(passage).toBeGreaterThan(straight);
    expect(totalNm).toBeCloseTo(legs.reduce((sum, l) => sum + l.distanceNm, 0), 9);
  });

  it('routes a snapshot the same way, though it never held W2', () => {
    const snapshot = snapshotOfCourse({ id: 'c', name: '14', marks: sequence }, marksById, 180);
    expect(legsOfWaypoints(snapshot.waypoints)).toEqual(resolveCourse(sequence, marksById).legs);
  });

  it('leaves a laid mark it cannot recognise straight and unreviewed', () => {
    const renamed = new Map(marksById).set('rc-line', { ...line, name: 'Committee boat' });
    expect(resolveCourse(sequence, renamed).legs[0]).toMatchObject({ review: 'unreviewed', to: { label: 'Ringabella' } });
    const moved = new Map(marksById).set('rc-line', { ...line, ...positionFrom({ lat: line.lat, lng: line.lng }, 90, 2, 'nm') });
    expect(resolveCourse(sequence, moved).legs[0]).toMatchObject({ review: 'unreviewed', to: { label: 'Ringabella' } });
  });

  it('knows a laid mark on a card course by the card mark it stands for, whatever its name', () => {
    // Pat's own line, "Grassy Start", where the overlay assumes SL.
    const named = new Map(marksById).set('rc-line', { ...line, name: 'Grassy Start' });
    const asSL = [{ markId: 'rc-line', cardMarkId: 'SL' }, ...sequence.slice(1)];
    expect(resolveCourse(sequence, named).legs[0]).toMatchObject({ review: 'unreviewed' });
    const { legs, waypoints } = resolveCourse(asSL, named);
    expect(legs.map((l) => l.review)).toEqual(resolveCourse(sequence, marksById).legs.map((l) => l.review));
    expect(legs[0].from.label).toBe('Grassy Start');
    expect(waypoints[0].cardMarkId).toBe('SL');
    // A snapshot keeps it, so a recompute routes the same way.
    const snapshot = snapshotOfCourse({ id: 'c', name: '14', marks: asSL }, named, 180);
    expect(legsOfWaypoints(snapshot.waypoints)).toEqual(legs);
    // A snapshot taken before the course knew it is out of date.
    expect(courseOutOfDate(snapshotOfCourse({ id: 'c', name: '14', marks: sequence }, named, 180), { marks: asSL }, named)).toBe(true);
    expect(courseOutOfDate(snapshot, { marks: asSL }, named)).toBe(false);
    // The overlay's position check still decides: laid 2 NM away, it isn't SL.
    const far = new Map(named).set('rc-line', { ...line, name: 'Grassy Start', ...positionFrom({ lat: line.lat, lng: line.lng }, 90, 2, 'nm') });
    expect(resolveCourse(asSL, far).legs[0]).toMatchObject({ review: 'unreviewed' });
    // An adopted mark is known by its own card id, not an entry's claim.
    expect(resolveCourse([...asSL.slice(0, 1), { markId: 'rc-Ringabella', cardMarkId: 'Cage' }], named).waypoints[1]).not.toHaveProperty('cardMarkId');
    // And it is drawn under SL, so the drawing routes as the legs do.
    const drawn = routedDrawing(drawnMarks([...named.values()]), drawnCourse(asSL), RC);
    expect(drawn.course.map((c) => c.mark)).toEqual(['SL', 'Ringabella', 'Cage']);
    expect(drawn.legCount).toBe(7);
    expect(drawn.course.every((c) => !('cardMarkId' in c))).toBe(true);
    expect(drawnStartCourse(snapshot).course[0]).toMatchObject({ cardMarkId: 'SL' });
  });

  it('claims nothing where the set has no overlay', () => {
    const legs = resolveCourse([{ markId: 'line' }, { markId: 'z' }], new Map([
      ['line', laid('line', 'Start', start)],
      ['z', laid('z', 'Z', positionFrom(start, 190, 1, 'nm'))],
    ])).legs;
    expect(legs).toHaveLength(1);
    expect(legs[0]).not.toHaveProperty('review');
  });

  it('says which card legs it routed and which it could not vouch for', () => {
    const { legs } = resolveCourse([...sequence, { markId: 'rc-line' }], new Map(marksById).set('rc-line', line));
    const far = laid('rc-far', 'Z — 6 Oct R1', positionFrom({ lat: line.lat, lng: line.lng }, 180, 3, 'nm'));
    const withFar = resolveCourse([...sequence, { markId: 'rc-far' }], new Map(marksById).set('rc-far', far)).legs;
    expect(courseRoutingSummary(legs, RC)).toMatchObject({ contributor: 'Pat Tanner', passages: [
      { leg: 1, via: ['RW_Temblebreedy_Pier', 'RW_Rams_Head', 'W2'] },
      { leg: 2, via: ['W2', 'RW_Rams_Head'] },
    ] });
    expect(courseRoutingSummary(withFar, RC)?.unreviewed).toEqual([3]);
    expect(courseRoutingSummary(legs, 'hyc/al-2026')).toBeNull();
  });

  it('draws under the card ids, adding the mark a passage turns at', () => {
    const drawn = routedDrawing(drawnMarks(marks), drawnCourse(sequence), RC, 'rc-Cage');
    expect(drawn.course.map((c) => c.mark)).toEqual(['SL', 'Ringabella', 'Cage']);
    expect(drawn.marks.map((m) => m.id)).toEqual(['SL', 'Ringabella', 'Cage', 'W2']);
    expect(drawn.highlight).toBe('Cage');
    expect(drawn.legCount).toBe(7);
    expect(drawn.routing).toBe(overlay.routing);
    expect(routedDrawing(drawnMarks(marks), drawnCourse(sequence), undefined).legCount).toBe(2);
  });
});
