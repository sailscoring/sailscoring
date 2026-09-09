/**
 * The course library round-trips (ORC constructed courses): the v45
 * `.sailscoring` file carries marks, courses, and each start's course
 * snapshot, and the public JSON export carries the same by name. Both
 * import paths rebuild the library with fresh ids and keep every reference
 * — a course's marks, a laid mark's origin, a start's course — attached.
 */
import { describe, expect, it } from 'vitest';

import {
  buildSeriesFile,
  FORMAT_VERSION,
  openSeriesFromFile,
  parseSeriesFile,
  type SeriesFileRepos,
} from '@/lib/series-file';
import {
  buildPublicExportFromSnapshot,
  importPublicExport,
  type ImportRepos,
} from '@/lib/public-export';
import type { SeriesSnapshot } from '@/lib/series-snapshot';
import type {
  Competitor,
  Finish,
  Fleet,
  Race,
  RaceStart,
  Series,
  SeriesCourse,
  SeriesMark,
} from '@/lib/types';

function makeSeries(id: string): Series {
  return {
    id,
    name: 'Autumn League',
    venue: 'HYC',
    startDate: '2026-09-12',
    endDate: '2026-10-31',
    venueLogoUrl: '',
    eventLogoUrl: '',
    venueUrl: '',
    eventUrl: '',
    createdAt: 0,
    lastSavedAt: null,
    lastModifiedAt: 0,
    scoringMode: 'handicap',
    discardThresholds: [],
    dnfScoring: 'seriesEntries',
    ftpHost: '',
    ftpPath: '',
    ftpPaths: {},
    includeJsonExport: true,
    enabledCompetitorFields: ['club'],
    primaryPersonLabel: 'helm',
    subdivisionAxes: [],
  };
}

const fleet: Fleet = { id: 'fl-1', seriesId: 's1', name: 'Class 2', displayOrder: 0, scoringSystem: 'orc' };

function makeCompetitor(id: string, sail: string): Competitor {
  return { id, seriesId: 's1', fleetIds: ['fl-1'], sailNumber: sail, names: [sail], clubs: [], gender: '', age: null, createdAt: 0 };
}

function makeFinish(raceId: string, competitorId: string, sortOrder: number): Finish {
  return { id: `${raceId}-${competitorId}`, raceId, competitorId, sortOrder, tiedWithPrevious: false, resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null, finishTime: '15:00:00' };
}

// The line, a laid windward mark logged off it, and one of the club's marks.
const line: SeriesMark = { id: 'm-line', seriesId: 's1', name: 'Start — 12 Sep', lat: 53.4055, lng: -6.0675, createdAt: 1 };
const zephyr: SeriesMark = {
  id: 'm-z', seriesId: 's1', name: 'Z — 12 Sep R1', lat: 53.3967, lng: -6.0702,
  from: { markId: 'm-line', bearingDeg: 190, distanceM: 1000 }, createdAt: 2,
};
const island: SeriesMark = {
  id: 'm-i', seriesId: 's1', name: 'Island', lat: 53.411667, lng: -6.072667,
  card: { set: 'hyc/al-2026', markId: 'I', release: '0.3.0' }, shape: 'conical', color: 'black', createdAt: 0,
};
const course: SeriesCourse = {
  id: 'c-1', seriesId: 's1', name: '19 — 12 Sep R1',
  card: { set: 'hyc/al-2026', cardId: 'offshore', courseId: 'K1', release: '0.3.0' },
  marks: [{ markId: 'm-line' }, { markId: 'm-z', side: 'port' }, { markId: 'm-i', side: 'starboard', passing: true }, { markId: 'm-line', side: 'port' }],
  createdAt: 3,
};
const start: RaceStart = {
  id: 'st-1', raceId: 'r1', fleetIds: ['fl-1'], startTime: '14:00:00', orcOption: 'CC',
  courseLegs: [
    { distanceNm: 0.54, bearingDeg: 190, windDirectionDeg: 190 },
    { distanceNm: 1.0, bearingDeg: 350, windDirectionDeg: 190 },
    { distanceNm: 0.5, bearingDeg: 200, windDirectionDeg: 190 },
  ],
  course: {
    courseId: 'c-1',
    name: '19 — 12 Sep R1',
    waypoints: [
      { markId: 'm-line', label: 'Start', lat: 53.4055, lng: -6.0675 },
      { markId: 'm-z', label: 'Z', lat: 53.3967, lng: -6.0702, side: 'port' },
      { markId: 'm-i', label: 'I', lat: 53.411667, lng: -6.072667, side: 'starboard', passing: true, fixed: true },
      { markId: 'm-line', label: 'Start', lat: 53.4055, lng: -6.0675, side: 'port' },
    ],
    windDirectionDeg: 190,
    legsEdited: true,
  },
};

const snapshot: SeriesSnapshot = {
  series: makeSeries('s1'),
  competitors: [makeCompetitor('c1', 'IRL 2507'), makeCompetitor('c2', 'IRL 1551')],
  fleets: [fleet],
  races: [{ id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-09-12', createdAt: 0 }],
  subSeries: [],
  finishes: [makeFinish('r1', 'c1', 1), makeFinish('r1', 'c2', 2)],
  raceStarts: [start],
  ratingOverrides: [],
  marks: [island, line, zephyr],
  courses: [course],
};

/** Fake repos backed by the snapshot for reads, recording writes. */
function makeRecordingRepos(read?: SeriesSnapshot) {
  const savedMarks: SeriesMark[] = [];
  const savedCourses: SeriesCourse[] = [];
  const savedStarts: RaceStart[] = [];
  const savedRaces: Race[] = [];
  const repos = {
    seriesRepo: {
      get: async (id: string) => (read && id === read.series.id ? read.series : undefined),
      save: async (s: Series) => s,
    },
    fleetRepo: { listBySeries: async () => read?.fleets ?? [], save: async (f: Fleet) => f, saveMany: async () => {} },
    competitorRepo: { listBySeries: async () => read?.competitors ?? [], save: async (c: Competitor) => c, saveMany: async () => {} },
    raceRepo: {
      listBySeries: async () => read?.races ?? [],
      save: async (r: Race) => { savedRaces.push(r); return r; },
    },
    subSeriesRepo: { listBySeries: async () => read?.subSeries ?? [], saveMany: async () => {} },
    finishRepo: { listBySeries: async () => read?.finishes ?? [], saveMany: async () => {} },
    raceStartRepo: {
      listBySeries: async () => read?.raceStarts ?? [],
      save: async (rs: RaceStart) => { savedStarts.push(rs); return rs; },
      saveMany: async (list: RaceStart[]) => { savedStarts.push(...list); },
    },
    raceRatingOverrideRepo: { listBySeries: async () => read?.ratingOverrides ?? [], listByRaces: async () => [], saveMany: async () => {} },
    seriesMarkRepo: {
      listBySeries: async () => read?.marks ?? [],
      saveMany: async (list: SeriesMark[]) => { savedMarks.push(...list); },
    },
    seriesCourseRepo: {
      listBySeries: async () => read?.courses ?? [],
      saveMany: async (list: SeriesCourse[]) => { savedCourses.push(...list); },
    },
    listSeriesNames: async () => [],
    deleteSeriesChildren: async () => {},
  } as unknown as SeriesFileRepos & ImportRepos;
  return { repos, savedMarks, savedCourses, savedStarts, savedRaces };
}

describe('.sailscoring v45 course library round-trip', () => {
  it('buildSeriesFile carries marks, courses, and the start snapshot', async () => {
    const file = await buildSeriesFile('s1', makeRecordingRepos(snapshot).repos);
    expect(file.formatVersion).toBe(FORMAT_VERSION);
    expect(file.marks?.map((m) => m.name)).toEqual(['Island', 'Start — 12 Sep', 'Z — 12 Sep R1']);
    expect(file.marks?.find((m) => m.id === 'm-z')?.from).toEqual({ markId: 'm-line', bearingDeg: 190, distanceM: 1000 });
    expect(file.marks?.find((m) => m.id === 'm-i')?.card).toEqual(island.card);
    expect(file.courses).toEqual([{ id: 'c-1', name: '19 — 12 Sep R1', card: course.card, marks: course.marks, createdAt: 3 }]);
    expect(file.races[0].starts[0].course).toEqual(start.course);
    expect(file.races[0].starts[0].courseLegs).toEqual(start.courseLegs);

    const reparsed = parseSeriesFile(JSON.stringify(file));
    expect(reparsed.marks).toEqual(file.marks);
    expect(reparsed.courses).toEqual(file.courses);
  });

  it('a series with no library writes no marks or courses keys', async () => {
    const file = await buildSeriesFile('s1', makeRecordingRepos({ ...snapshot, marks: [], courses: [] }).repos);
    expect(file.marks).toBeUndefined();
    expect(file.courses).toBeUndefined();
  });

  it('openSeriesFromFile rebuilds the library with fresh ids and every reference remapped', async () => {
    const built = await buildSeriesFile('s1', makeRecordingRepos(snapshot).repos);
    const { repos, savedMarks, savedCourses, savedStarts } = makeRecordingRepos();
    await openSeriesFromFile(built, repos);

    expect(savedMarks.map((m) => m.name)).toEqual(['Island', 'Start — 12 Sep', 'Z — 12 Sep R1']);
    const idByName = new Map(savedMarks.map((m) => [m.name, m.id]));
    expect(savedMarks.every((m) => !['m-line', 'm-z', 'm-i'].includes(m.id))).toBe(true);
    expect(savedMarks.find((m) => m.name === 'Z — 12 Sep R1')?.from).toEqual({
      markId: idByName.get('Start — 12 Sep'), bearingDeg: 190, distanceM: 1000,
    });
    expect(savedMarks.find((m) => m.name === 'Island')?.card).toEqual(island.card);

    expect(savedCourses).toHaveLength(1);
    expect(savedCourses[0].id).not.toBe('c-1');
    expect(savedCourses[0].marks.map((cm) => cm.markId)).toEqual([
      idByName.get('Start — 12 Sep'), idByName.get('Z — 12 Sep R1'), idByName.get('Island'), idByName.get('Start — 12 Sep'),
    ]);
    expect(savedCourses[0].marks[2]).toMatchObject({ side: 'starboard', passing: true });

    expect(savedStarts).toHaveLength(1);
    const saved = savedStarts[0].course!;
    expect(saved.courseId).toBe(savedCourses[0].id);
    expect(saved.waypoints.map((w) => w.markId)).toEqual([
      idByName.get('Start — 12 Sep'), idByName.get('Z — 12 Sep R1'), idByName.get('Island'), idByName.get('Start — 12 Sep'),
    ]);
    expect(saved.waypoints[2]).toMatchObject({ lat: 53.411667, lng: -6.072667, fixed: true, passing: true });
    expect(saved.windDirectionDeg).toBe(190);
    expect(saved.legsEdited).toBe(true);
    expect(savedStarts[0].courseLegs).toEqual(start.courseLegs);
  });

  it('a bundle without library repos still carries the start snapshot, references dropped', async () => {
    const built = await buildSeriesFile('s1', makeRecordingRepos(snapshot).repos);
    const { repos, savedStarts } = makeRecordingRepos();
    delete (repos as Partial<SeriesFileRepos>).seriesMarkRepo;
    delete (repos as Partial<SeriesFileRepos>).seriesCourseRepo;
    await openSeriesFromFile(built, repos);
    const saved = savedStarts[0].course!;
    expect(saved.courseId).toBeUndefined();
    expect(saved.waypoints.every((w) => w.markId === undefined)).toBe(true);
    expect(saved.waypoints.map((w) => w.label)).toEqual(['Start', 'Z', 'I', 'Start']);
  });

  it('parseSeriesFile rejects a non-list marks or courses', () => {
    const base = { formatVersion: 45, seriesId: 's1', exportedAt: 'x', series: {}, fleets: [], competitors: [], races: [] };
    expect(() => parseSeriesFile(JSON.stringify({ ...base, marks: 'nope' }))).toThrow(/marks/);
    expect(() => parseSeriesFile(JSON.stringify({ ...base, courses: {} }))).toThrow(/courses/);
  });
});

describe('public export course library round-trip', () => {
  it('exports the library by name and the start snapshot with positions', () => {
    const data = buildPublicExportFromSnapshot(snapshot)!;
    expect(data.marks?.map((m) => m.name)).toEqual(['Island', 'Start — 12 Sep', 'Z — 12 Sep R1']);
    expect(data.marks?.find((m) => m.name === 'Z — 12 Sep R1')?.from).toEqual({ mark: 'Start — 12 Sep', bearingDeg: 190, distanceM: 1000 });
    expect(data.courses).toEqual([
      {
        name: '19 — 12 Sep R1',
        card: course.card,
        marks: [{ mark: 'Start — 12 Sep' }, { mark: 'Z — 12 Sep R1', side: 'port' }, { mark: 'Island', side: 'starboard', passing: true }, { mark: 'Start — 12 Sep', side: 'port' }],
      },
    ]);
    const exported = data.races[0].starts[0].course!;
    expect(exported.course).toBe('19 — 12 Sep R1');
    expect(exported.waypoints[1]).toEqual({ mark: 'Z — 12 Sep R1', label: 'Z', lat: 53.3967, lng: -6.0702, side: 'port' });
    expect(exported.waypoints[2]).toMatchObject({ mark: 'Island', fixed: true, passing: true });
    expect(exported.windDirectionDeg).toBe(190);
    expect(exported.legsEdited).toBe(true);
    // No internal ids leak.
    expect(JSON.stringify(data)).not.toMatch(/"m-line"|"m-z"|"m-i"|"c-1"/);
  });

  it('suffixes marks that share a name, and courses reference the suffixed one', () => {
    const twin: SeriesMark = { ...zephyr, id: 'm-z2', createdAt: 4 };
    const data = buildPublicExportFromSnapshot({
      ...snapshot,
      marks: [line, zephyr, twin],
      courses: [{ ...course, marks: [{ markId: 'm-line' }, { markId: 'm-z2', side: 'port' }] }],
    })!;
    expect(data.marks?.map((m) => m.name)).toEqual(['Start — 12 Sep', 'Z — 12 Sep R1', 'Z — 12 Sep R1 (2)']);
    expect(data.courses?.[0].marks[1].mark).toBe('Z — 12 Sep R1 (2)');
  });

  it('importPublicExport rebuilds the library and re-links the start', async () => {
    const data = buildPublicExportFromSnapshot(snapshot)!;
    const { repos, savedMarks, savedCourses, savedStarts } = makeRecordingRepos();
    await importPublicExport(data, repos);

    const idByName = new Map(savedMarks.map((m) => [m.name, m.id]));
    expect([...idByName.keys()]).toEqual(['Island', 'Start — 12 Sep', 'Z — 12 Sep R1']);
    expect(savedMarks.find((m) => m.name === 'Z — 12 Sep R1')?.from?.markId).toBe(idByName.get('Start — 12 Sep'));
    expect(savedCourses[0].marks.map((cm) => cm.markId)).toEqual([
      idByName.get('Start — 12 Sep'), idByName.get('Z — 12 Sep R1'), idByName.get('Island'), idByName.get('Start — 12 Sep'),
    ]);
    const saved = savedStarts[0].course!;
    expect(saved.courseId).toBe(savedCourses[0].id);
    expect(saved.waypoints.map((w) => w.markId)).toEqual(savedCourses[0].marks.map((cm) => cm.markId));
    expect(saved.waypoints[1]).toMatchObject({ label: 'Z', lat: 53.3967, lng: -6.0702, side: 'port' });
    expect(saved.legsEdited).toBe(true);
  });

  it('an export with no library imports a start snapshot without references', async () => {
    const data = buildPublicExportFromSnapshot({ ...snapshot, marks: [], courses: [] })!;
    expect(data.marks).toBeUndefined();
    expect(data.courses).toBeUndefined();
    const { repos, savedStarts } = makeRecordingRepos();
    await importPublicExport(data, repos);
    const saved = savedStarts[0].course!;
    expect(saved.name).toBe('19 — 12 Sep R1');
    expect(saved.courseId).toBeUndefined();
    expect(saved.waypoints[1]).toEqual({ label: 'Z', lat: 53.3967, lng: -6.0702, side: 'port' });
  });
});
