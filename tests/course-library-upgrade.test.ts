/**
 * Removing the course library (series file v71, public export v11; ADR-013):
 * a series stored before then — a file, a revision, a Trash tombstone, a
 * published data file — can still carry the library's marks and courses,
 * and starts whose course was picked from it with its waypoints. Reading one
 * brings it forward: the library is dropped, and each such start keeps its
 * course as its own legs, anchored where its first waypoint was and named
 * after its marks where the legs are theirs. Nothing scores differently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { legNameBetween, upgradeStartCourse } from '@/lib/course-library-upgrade';
import {
  buildPublicExportFromSnapshot,
  importPublicExport,
  parsePublicExport,
  type ImportRepos,
} from '@/lib/public-export';
import { calculateFleetStandings } from '@/lib/scoring';
import {
  buildSeriesFile,
  FORMAT_VERSION,
  openSeriesFromFile,
  parseSeriesFile,
  type SeriesFile,
  type SeriesFileRepos,
} from '@/lib/series-file';
import type { SeriesSnapshot } from '@/lib/series-snapshot';
import type { Competitor, Finish, Fleet, Race, RaceStart, Series } from '@/lib/types';

type Raw = Record<string, unknown>;

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

const LEGS = [
  { distanceNm: 0.54, bearingDeg: 190, windDirectionDeg: 190 },
  { distanceNm: 1.0, bearingDeg: 350, windDirectionDeg: 190 },
  { distanceNm: 0.5, bearingDeg: 200, windDirectionDeg: 190 },
];

/** A start as a build with the course library kept one picked from it:
 *  the line, a laid Z, one of the club's marks passed, and home. */
function libraryStart(): Raw {
  return {
    id: 'st-1', fleetIds: ['fl-1'], startTime: '14:00:00', orcOption: 'CC',
    courseLegs: structuredClone(LEGS),
    course: {
      courseId: 'c-1',
      name: '19 — 12 Sep R1',
      waypoints: [
        { markId: 'm-line', label: 'Start', lat: 53.4055, lng: -6.0675 },
        { markId: 'm-z', label: 'Z', lat: 53.3967, lng: -6.0702, side: 'port', cardMarkId: 'Z' },
        { markId: 'm-i', label: 'I', lat: 53.411667, lng: -6.072667, side: 'starboard', passing: true, fixed: true, set: 'hyc/al-2026' },
        { markId: 'm-line', label: 'Start', lat: 53.4055, lng: -6.0675, side: 'port' },
      ],
      windDirectionDeg: 190,
    },
  };
}

describe('a start whose course was picked from the library', () => {
  it('keeps it as its own legs, anchored at the first waypoint and named after the marks', () => {
    const start = libraryStart();
    upgradeStartCourse(start);
    expect(start.course).toEqual({
      name: '19 — 12 Sep R1',
      anchor: { lat: 53.4055, lng: -6.0675 },
      legs: LEGS.map((l) => ({ distanceNm: l.distanceNm, bearingDeg: l.bearingDeg })),
      windDirectionDeg: 190,
    });
    expect((start.courseLegs as { name?: string }[]).map((l) => l.name)).toEqual(['Start – Z', 'Z – I', 'I – Start']);
    // Every figure scored is as it was.
    expect((start.courseLegs as Raw[]).map(({ name: _name, ...l }) => l)).toEqual(LEGS);
  });

  it('keeps an edited course edited for good, with no legs to measure against and no names', () => {
    const start = libraryStart();
    (start.course as Raw).legsEdited = true;
    upgradeStartCourse(start);
    expect(start.course).toEqual({
      name: '19 — 12 Sep R1',
      anchor: { lat: 53.4055, lng: -6.0675 },
      windDirectionDeg: 190,
      legsEdited: true,
    });
    expect(start.courseLegs).toEqual(LEGS);
  });

  it('names no legs routed through a passage, which outnumber the marks', () => {
    const start = libraryStart();
    start.courseLegs = [...LEGS, { distanceNm: 0.3, bearingDeg: 90, windDirectionDeg: 190 }];
    upgradeStartCourse(start);
    expect((start.course as Raw).legs).toHaveLength(4);
    expect((start.courseLegs as Raw[]).every((l) => l.name === undefined)).toBe(true);
  });

  it('anchors a line at its midpoint, which the legs were measured from', () => {
    const start = libraryStart();
    const waypoints = (start.course as { waypoints: Raw[] }).waypoints;
    waypoints[0] = {
      markId: 'm-line', label: 'Start–Pin', lat: 53.40475, lng: -6.06825,
      ends: [
        { end: 'starboard', markId: 'm-line', label: 'Start', lat: 53.4055, lng: -6.0675 },
        { end: 'port', markId: 'm-pin', label: 'Pin', lat: 53.404, lng: -6.069 },
      ],
    };
    upgradeStartCourse(start);
    expect((start.course as Raw).anchor).toEqual({ lat: 53.40475, lng: -6.06825 });
    expect((start.courseLegs as Raw[])[0].name).toBe('Start–Pin – Z');
  });

  it('keeps a name a leg already had, and shortens one too long to keep', () => {
    const start = libraryStart();
    (start.courseLegs as Raw[])[0].name = 'Start – Windward';
    const waypoints = (start.course as { waypoints: Raw[] }).waypoints;
    waypoints[2].label = 'A mark with a name so long that, with the mark before it, it runs past what a leg keeps';
    upgradeStartCourse(start);
    const names = (start.courseLegs as { name: string }[]).map((l) => l.name);
    expect(names[0]).toBe('Start – Windward');
    expect(names[1]).toHaveLength(80);
    expect(names[1].endsWith('…')).toBe(true);
    expect(legNameBetween(' Cage ', 'Harp')).toBe('Cage – Harp');
    expect(legNameBetween('', 'Harp')).toBeUndefined();
  });

  it('keeps a leg-table course’s legs, losing only the library course it named', () => {
    const start: Raw = {
      courseLegs: LEGS,
      course: { courseId: 'c-legs', name: 'RC table', waypoints: [], legs: [{ distanceNm: 2.09, bearingDeg: 162 }], legsEdited: true },
    };
    upgradeStartCourse(start);
    expect(start.course).toEqual({ name: 'RC table', legs: [{ distanceNm: 2.09, bearingDeg: 162 }], legsEdited: true });
  });

  it('leaves an imported course as it was', () => {
    const course = { name: 'Thursday, Race 2', legs: [{ distanceNm: 0.67, bearingDeg: 282 }], north: 'magnetic', windDirectionDeg: 280 };
    const start: Raw = { courseLegs: LEGS, course: { ...course, waypoints: [] } };
    upgradeStartCourse(start);
    expect(start.course).toEqual(course);
    expect(start.courseLegs).toEqual(LEGS);
  });

  it('reads an export’s start, which names the library course rather than its id', () => {
    const start = libraryStart();
    const course = start.course as Raw;
    delete course.courseId;
    course.course = '19 — 12 Sep R1';
    upgradeStartCourse(start);
    expect(start.course).not.toHaveProperty('course');
    expect(start.course).toMatchObject({ anchor: { lat: 53.4055, lng: -6.0675 } });
  });
});

/** Fake repos backed by the snapshot for reads, recording writes. */
function makeRecordingRepos(read?: SeriesSnapshot) {
  const savedStarts: RaceStart[] = [];
  const repos = {
    seriesRepo: {
      get: async (id: string) => (read && id === read.series.id ? read.series : undefined),
      save: async (s: Series) => s,
    },
    fleetRepo: { listBySeries: async () => read?.fleets ?? [], save: async (f: Fleet) => f, saveMany: async () => {} },
    competitorRepo: { listBySeries: async () => read?.competitors ?? [], save: async (c: Competitor) => c, saveMany: async () => {} },
    raceRepo: { listBySeries: async () => read?.races ?? [], save: async (r: Race) => r },
    subSeriesRepo: { listBySeries: async () => read?.subSeries ?? [], saveMany: async () => {} },
    finishRepo: { listBySeries: async () => read?.finishes ?? [], saveMany: async () => {} },
    raceStartRepo: {
      listBySeries: async () => read?.raceStarts ?? [],
      save: async (rs: RaceStart) => { savedStarts.push(rs); return rs; },
      saveMany: async (list: RaceStart[]) => { savedStarts.push(...list); },
    },
    raceRatingOverrideRepo: { listBySeries: async () => read?.ratingOverrides ?? [], listByRaces: async () => [], saveMany: async () => {} },
    listSeriesNames: async () => [],
    deleteSeriesChildren: async () => {},
  } as unknown as SeriesFileRepos & ImportRepos;
  return { repos, savedStarts };
}

const imported: RaceStart = {
  id: 'st-1', raceId: 'r1', fleetIds: ['fl-1'], startTime: '14:00:00', orcOption: 'CC_TOT',
  courseLegs: LEGS.map((l) => ({ ...l, windSpeedKts: 9, name: 'Leg' })),
  course: {
    name: 'Autumn League, Race 3',
    legs: LEGS.map((l) => ({ distanceNm: l.distanceNm, bearingDeg: l.bearingDeg })),
    anchor: { lat: 53.40125, lng: -6.08413 },
    windDirectionDeg: 190,
    windSpeedKts: 9,
  },
};

const snapshot: SeriesSnapshot = {
  series: makeSeries('s1'),
  competitors: [makeCompetitor('c1', 'IRL 2507'), makeCompetitor('c2', 'IRL 1551')],
  fleets: [fleet],
  races: [{ id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-09-12', createdAt: 0 }],
  subSeries: [],
  finishes: [makeFinish('r1', 'c1', 1), makeFinish('r1', 'c2', 2)],
  raceStarts: [imported],
  ratingOverrides: [],
};

/** A series file as a build with the library wrote it: the marks and
 *  courses, and the start's course picked from them. */
async function libraryFile(formatVersion: number): Promise<Raw> {
  const file = structuredClone(await buildSeriesFile('s1', makeRecordingRepos(snapshot).repos)) as unknown as Raw;
  file.formatVersion = formatVersion;
  file.marks = [
    { id: 'm-line', name: 'Start — 12 Sep', lat: 53.4055, lng: -6.0675, createdAt: 1 },
    { id: 'm-z', name: 'Z — 12 Sep R1', lat: 53.3967, lng: -6.0702, from: { markId: 'm-line', bearingDeg: 190, distanceM: 1000 }, createdAt: 2 },
  ];
  file.courses = [{ id: 'c-1', name: '19 — 12 Sep R1', marks: [{ markId: 'm-line' }, { markId: 'm-z', side: 'port' }], createdAt: 3 }];
  const race = (file.races as { starts: Raw[] }[])[0];
  race.starts = [{ ...libraryStart(), id: 'st-1' }];
  return file;
}

describe('a series file from before v71', () => {
  it('is read without the library, its start’s course brought forward', async () => {
    for (const version of [45, 57, 67, 70]) {
      const file = parseSeriesFile(JSON.stringify(await libraryFile(version))) as unknown as Raw;
      expect(file).not.toHaveProperty('marks');
      expect(file).not.toHaveProperty('courses');
      const start = (file.races as { starts: RaceStart[] }[])[0].starts[0];
      expect(start.course).toEqual({
        name: '19 — 12 Sep R1',
        anchor: { lat: 53.4055, lng: -6.0675 },
        legs: LEGS.map((l) => ({ distanceNm: l.distanceNm, bearingDeg: l.bearingDeg })),
        windDirectionDeg: 190,
      });
      expect(start.courseLegs?.map((l) => l.name)).toEqual(['Start – Z', 'Z – I', 'I – Start']);
    }
  });

  it('opens into a start that holds no library course or waypoints', async () => {
    const { repos, savedStarts } = makeRecordingRepos();
    await openSeriesFromFile(parseSeriesFile(JSON.stringify(await libraryFile(52))), repos);
    expect(savedStarts[0].course).not.toHaveProperty('courseId');
    expect(savedStarts[0].course).not.toHaveProperty('waypoints');
    expect(savedStarts[0].course?.anchor).toEqual({ lat: 53.4055, lng: -6.0675 });
  });

  it('is left alone from v71 on', async () => {
    const file = await libraryFile(71);
    const parsed = parseSeriesFile(JSON.stringify(file)) as unknown as Raw;
    expect((parsed.races as { starts: Raw[] }[])[0].starts[0].course).toHaveProperty('waypoints');
  });
});

describe('the series file and the public export, written now', () => {
  it('carry a course as its name, legs, anchor and wind', async () => {
    const file = await buildSeriesFile('s1', makeRecordingRepos(snapshot).repos);
    expect(file.formatVersion).toBe(FORMAT_VERSION);
    expect(FORMAT_VERSION).toBe(73);
    expect(file).not.toHaveProperty('marks');
    expect(file).not.toHaveProperty('courses');
    expect(file.races[0].starts[0].course).toEqual(imported.course);
    expect(file.races[0].starts[0].courseLegs).toEqual(imported.courseLegs);

    const data = buildPublicExportFromSnapshot(snapshot)!;
    expect(data.version).toBe(13);
    expect(data).not.toHaveProperty('marks');
    expect(data).not.toHaveProperty('courses');
    expect(data.races[0].starts[0].course).toEqual(imported.course);
  });

  it('round-trip it, recorded wind and all', async () => {
    const file = await buildSeriesFile('s1', makeRecordingRepos(snapshot).repos);
    const opened = makeRecordingRepos();
    await openSeriesFromFile(parseSeriesFile(JSON.stringify(file)), opened.repos);
    expect(opened.savedStarts[0].course).toEqual(imported.course);
    expect(opened.savedStarts[0].courseLegs).toEqual(imported.courseLegs);

    const data = buildPublicExportFromSnapshot(snapshot)!;
    const viaExport = makeRecordingRepos();
    await importPublicExport(parsePublicExport(JSON.stringify(data)), viaExport.repos);
    expect(viaExport.savedStarts[0].course).toEqual(imported.course);
    expect(viaExport.savedStarts[0].courseLegs).toEqual(imported.courseLegs);
  });
});

describe('a public export from before v11', () => {
  it('is imported with its start’s course brought forward', async () => {
    const data = structuredClone(buildPublicExportFromSnapshot(snapshot)!) as unknown as Raw;
    data.version = 10;
    data.marks = [{ name: 'Start — 12 Sep', lat: 53.4055, lng: -6.0675 }];
    data.courses = [{ name: '19 — 12 Sep R1', marks: [{ mark: 'Start — 12 Sep' }] }];
    const start = libraryStart();
    const course = start.course as Raw;
    delete course.courseId;
    course.course = '19 — 12 Sep R1';
    const race = (data.races as { starts: Raw[] }[])[0];
    race.starts = [{ ...race.starts[0], courseLegs: start.courseLegs, course }];
    const before = JSON.stringify(data);

    const { repos, savedStarts } = makeRecordingRepos();
    await importPublicExport(parsePublicExport(before), repos);
    expect(savedStarts[0].course).toEqual({
      name: '19 — 12 Sep R1',
      anchor: { lat: 53.4055, lng: -6.0675 },
      legs: LEGS.map((l) => ({ distanceNm: l.distanceNm, bearingDeg: l.bearingDeg })),
      windDirectionDeg: 190,
    });
    expect(savedStarts[0].courseLegs?.map((l) => l.name)).toEqual(['Start – Z', 'Z – I', 'I – Start']);
  });
});

/** A file's rows as scoring takes them, read straight off the file. */
function rowsOf(file: SeriesFile) {
  const fleets: Fleet[] = file.fleets.map((f) => ({
    id: f.id, seriesId: file.seriesId, name: f.name, displayOrder: f.displayOrder, scoringSystem: f.scoringSystem,
  }));
  const competitors = file.competitors.map((c, i) => ({ ...c, seriesId: file.seriesId, createdAt: i })) as Competitor[];
  const races: Race[] = file.races.map((r, i) => ({
    id: r.id, seriesId: file.seriesId, raceNumber: r.raceNumber, name: r.name ?? null, date: r.date, createdAt: i,
  }));
  const raceStarts = file.races.flatMap((r) => r.starts.map((s) => ({ ...s, raceId: r.id }))) as RaceStart[];
  const finishes = file.races.flatMap((r) => r.finishes.map((f) => ({
    id: f.id, raceId: r.id, competitorId: f.competitorId, sortOrder: f.sortOrder, tiedWithPrevious: false,
    finishTime: f.finishTime, resultCode: f.resultCode, startPresent: f.startPresent, penaltyCode: f.penaltyCode,
    penaltyOverride: f.penaltyOverride, redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null,
    redressIncludeAllLater: false, redressPoints: null,
  }))) as Finish[];
  const { fleetStandings } = calculateFleetStandings(
    fleets, competitors, races, finishes, file.series.discardThresholds, file.series.dnfScoring, raceStarts,
  );
  return {
    raceStarts,
    standings: fleetStandings.map((fs) => fs.standings.map((s) => [s.competitor.id, s.rank, s.netPoints, s.racePoints])),
  };
}

describe('the ORC sample as v68 left it, with its library', () => {
  const raw = readFileSync(join(__dirname, 'fixtures', 'sample-series', 'orc-v68.sailscoring'), 'utf8');

  it('scores identically once brought forward', () => {
    const before = rowsOf(JSON.parse(raw) as SeriesFile);
    const after = rowsOf(parseSeriesFile(raw));
    expect(after.standings).toEqual(before.standings);
    expect(before.standings.flat().length).toBeGreaterThan(0);
  });

  it('keeps HYC’s offshore J2 as nine legs from the middle of the line, named after the marks', () => {
    const file = parseSeriesFile(raw) as unknown as Raw;
    expect(file).not.toHaveProperty('marks');
    const { raceStarts } = rowsOf(file as unknown as SeriesFile);
    const cc = raceStarts.find((s) => s.orcOption === 'CC')!;
    expect(cc.course).toMatchObject({ name: 'J2 — 26 Sep R3', windDirectionDeg: 160 });
    expect(cc.course?.anchor?.lat).toBeCloseTo(53.41319, 5);
    expect(cc.course?.anchor?.lng).toBeCloseTo(-6.06192, 5);
    expect(cc.course?.legs).toHaveLength(9);
    expect(cc.courseLegs?.map((l) => l.name)).toEqual([
      'SL – Z', 'Z – O', 'O – U', 'U – K', 'K – H', 'H – K', 'K – Q', 'Q – HM', 'HM – FH',
    ]);
  });
});
