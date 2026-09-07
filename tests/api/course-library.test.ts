// @vitest-environment node

/**
 * Integration tests for the course-library handlers: marks and courses
 * upsert per series, a mark a course names cannot be deleted, a course can
 * be deleted while a start still snapshots it, workspace isolation, and a
 * series copy carrying the library with every reference remapped.
 *
 * Skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import { BadRequestError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import * as series from '@/lib/api-handlers/series';
import * as races from '@/lib/api-handlers/races';
import * as fleetsApi from '@/lib/api-handlers/fleets';
import * as raceStarts from '@/lib/api-handlers/race-starts';
import * as library from '@/lib/api-handlers/course-library';
import { getActivityFeed } from '@/lib/api-handlers/activity';
import type { SeriesCourse, SeriesMark } from '@/lib/types';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

function ctxFor(workspaceId: string): WorkspaceContext {
  return {
    userId: 'test-user',
    email: 'test@sailscoring.test',
    workspaceId,
    workspaceSlug: 'test-ws',
    role: 'owner',
    features: [],
  };
}

function sampleSeries(id: string) {
  return {
    id,
    name: `Series ${id.slice(0, 8)}`,
    venue: 'HYC',
    startDate: '2026-09-01',
    endDate: '2026-10-31',
    venueLogoUrl: '',
    eventLogoUrl: '',
    venueUrl: '',
    eventUrl: '',
    createdAt: Date.now(),
    lastSavedAt: null,
    lastModifiedAt: Date.now(),
    scoringMode: 'handicap' as const,
    discardThresholds: [],
    dnfScoring: 'seriesEntries' as const,
    ftpHost: '',
    ftpPath: '',
    ftpPaths: {},
    includeJsonExport: true,
    enabledCompetitorFields: ['boatName', 'club'],
    primaryPersonLabel: 'helm' as const,
    subdivisionAxes: [],
  };
}

function mark(seriesId: string, name: string, extra: Partial<SeriesMark> = {}): SeriesMark {
  return { id: uuid(), seriesId, name, lat: 53.4055, lng: -6.0675, createdAt: Date.now(), ...extra };
}

describe.skipIf(skip)('course library handlers', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceA: string;
  let workspaceB: string;
  let ctxA: WorkspaceContext;
  let ctxB: WorkspaceContext;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceA = `org_a_${uuid().replace(/-/g, '')}`;
    workspaceB = `org_b_${uuid().replace(/-/g, '')}`;
    const now = new Date();
    await db.insert(schema.organization).values([
      { id: workspaceA, name: 'A', slug: `a-${workspaceA.slice(6, 16)}`, createdAt: now },
      { id: workspaceB, name: 'B', slug: `b-${workspaceB.slice(6, 16)}`, createdAt: now },
    ]);
    ctxA = ctxFor(workspaceA);
    ctxB = ctxFor(workspaceB);
  });

  afterAll(async () => {
    if (workspaceA) await db.delete(schema.organization).where(eq(schema.organization.id, workspaceA));
    if (workspaceB) await db.delete(schema.organization).where(eq(schema.organization.id, workspaceB));
    await sql?.end();
  });

  async function makeSeries(): Promise<string> {
    const seriesId = uuid();
    await series.putSeries(ctxA, seriesId, sampleSeries(seriesId));
    return seriesId;
  }

  test('marks and courses upsert, list in creation order, and log activity', async () => {
    const seriesId = await makeSeries();
    const line = mark(seriesId, 'Start — 12 Sep');
    await library.putSeriesMark(ctxA, seriesId, line.id, line);
    const z = mark(seriesId, 'Z — 12 Sep R1', {
      lat: 53.3967, lng: -6.0702, from: { markId: line.id, bearingDeg: 190, distanceM: 1000 },
    });
    await library.putSeriesMark(ctxA, seriesId, z.id, z);

    const marks = await library.listSeriesMarks(ctxA, seriesId);
    expect(marks.map((m) => m.name)).toEqual(['Start — 12 Sep', 'Z — 12 Sep R1']);
    expect(marks[1].from).toEqual({ markId: line.id, bearingDeg: 190, distanceM: 1000 });
    expect(marks[0].version).toBe(1);

    const course: SeriesCourse = {
      id: uuid(), seriesId, name: '19 — 12 Sep R1',
      card: { set: 'hyc/al-2026', cardId: 'offshore', courseId: 'K1', release: '0.3.0' },
      marks: [{ markId: line.id }, { markId: z.id, side: 'port' }, { markId: line.id, side: 'port' }],
      createdAt: Date.now(),
    };
    const saved = await library.putSeriesCourse(ctxA, seriesId, course.id, course);
    expect(saved.marks).toEqual(course.marks);
    expect(saved.card).toEqual(course.card);
    expect(saved.modified).toBeUndefined();

    const renamed = await library.putSeriesCourse(ctxA, seriesId, course.id, { ...saved, name: '19 outer — 12 Sep R1', modified: true });
    expect(renamed.name).toBe('19 outer — 12 Sep R1');
    expect(renamed.modified).toBe(true);
    expect(renamed.version).toBe(2);

    const params = new URLSearchParams();
    params.set('seriesId', seriesId);
    const { items } = await getActivityFeed(ctxA, params);
    expect(items.some((i) => i.action === 'mark.created' && i.summary === 'Added mark Start — 12 Sep')).toBe(true);
    expect(items.some((i) => i.action === 'course.created')).toBe(true);
    expect(items.some((i) => i.action === 'course.updated' && i.summary === 'Renamed course 19 — 12 Sep R1 to 19 outer — 12 Sep R1')).toBe(true);
  });

  test('a course keeps only marks of its own series; a laid mark keeps only an origin of its own series', async () => {
    const seriesId = await makeSeries();
    const other = await makeSeries();
    const mine = mark(seriesId, 'Mine');
    const theirs = mark(other, 'Theirs');
    await library.putSeriesMark(ctxA, seriesId, mine.id, mine);
    await library.putSeriesMark(ctxA, other, theirs.id, theirs);

    const course = await library.putSeriesCourse(ctxA, seriesId, uuid(), {
      seriesId, name: 'Mixed', marks: [{ markId: mine.id }, { markId: theirs.id }, { markId: uuid() }], createdAt: Date.now(),
    });
    expect(course.marks).toEqual([{ markId: mine.id }]);

    const laid = mark(seriesId, 'Laid', { from: { markId: theirs.id, bearingDeg: 90, distanceM: 500 } });
    const savedLaid = await library.putSeriesMark(ctxA, seriesId, laid.id, laid);
    expect(savedLaid.from).toBeUndefined();
  });

  test('a mark a course names cannot be deleted; the error names the courses', async () => {
    const seriesId = await makeSeries();
    const line = mark(seriesId, 'Start');
    await library.putSeriesMark(ctxA, seriesId, line.id, line);
    await library.putSeriesCourse(ctxA, seriesId, uuid(), {
      seriesId, name: 'Course A', marks: [{ markId: line.id }], createdAt: Date.now(),
    });
    await library.putSeriesCourse(ctxA, seriesId, uuid(), {
      seriesId, name: 'Course B', marks: [{ markId: line.id }], createdAt: Date.now(),
    });

    let caught: unknown;
    try {
      await library.deleteSeriesMark(ctxA, seriesId, line.id);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BadRequestError);
    expect((caught as BadRequestError).issues).toEqual({ code: 'mark-in-use', courses: ['Course A', 'Course B'] });
    expect(await library.listSeriesMarks(ctxA, seriesId)).toHaveLength(1);

    // Delete the courses, then the mark goes.
    for (const c of await library.listSeriesCourses(ctxA, seriesId)) {
      await library.deleteSeriesCourse(ctxA, seriesId, c.id);
    }
    await library.deleteSeriesMark(ctxA, seriesId, line.id);
    expect(await library.listSeriesMarks(ctxA, seriesId)).toEqual([]);
  });

  test('a course can be deleted while a start still snapshots it; the start keeps its course', async () => {
    const seriesId = await makeSeries();
    const fleetId = uuid();
    await fleetsApi.putFleet(ctxA, seriesId, fleetId, {
      id: fleetId, seriesId, name: 'Class 2', displayOrder: 0, scoringSystem: 'orc' as const,
    });
    const raceId = uuid();
    await races.putRace(ctxA, seriesId, raceId, { id: raceId, seriesId, raceNumber: 1, date: '2026-09-12', createdAt: Date.now() });
    const line = mark(seriesId, 'Start');
    await library.putSeriesMark(ctxA, seriesId, line.id, line);
    const course = await library.putSeriesCourse(ctxA, seriesId, uuid(), {
      seriesId, name: 'Course A', marks: [{ markId: line.id }, { markId: line.id, side: 'port' }], createdAt: Date.now(),
    });
    const startId = uuid();
    const start = await raceStarts.putRaceStart(ctxA, raceId, startId, {
      id: startId, raceId, fleetIds: [fleetId], startTime: '14:00:00',
      courseLegs: [{ distanceNm: 1, bearingDeg: 190, windDirectionDeg: 190 }],
      course: {
        courseId: course.id, name: course.name, windDirectionDeg: 190,
        waypoints: [
          { markId: line.id, label: 'Start', lat: 53.4055, lng: -6.0675 },
          { markId: line.id, label: 'Start', lat: 53.4055, lng: -6.0675, side: 'port' },
        ],
      },
    });
    expect(start.course?.courseId).toBe(course.id);

    await library.deleteSeriesCourse(ctxA, seriesId, course.id);
    expect(await library.listSeriesCourses(ctxA, seriesId)).toEqual([]);
    const [reloaded] = await raceStarts.listRaceStarts(ctxA, raceId);
    expect(reloaded.course?.name).toBe('Course A');
    expect(reloaded.course?.waypoints).toHaveLength(2);
    expect(reloaded.courseLegs).toEqual([{ distanceNm: 1, bearingDeg: 190, windDirectionDeg: 190 }]);
  });

  test('the library is workspace-scoped', async () => {
    const seriesId = await makeSeries();
    const line = mark(seriesId, 'Start');
    await library.putSeriesMark(ctxA, seriesId, line.id, line);
    await expect(library.listSeriesMarks(ctxB, seriesId)).rejects.toThrow();
    await library.deleteSeriesMark(ctxB, seriesId, line.id).catch(() => undefined);
    expect(await library.listSeriesMarks(ctxA, seriesId)).toHaveLength(1);
  });

  test('a series copy carries the library with every reference remapped', async () => {
    const userId = `copy-user-${uuid().slice(0, 8)}`;
    await db.insert(schema.user).values({ id: userId, name: 'Copy User', email: `${userId}@sailscoring.test` });
    await db.insert(schema.member).values({
      id: `mem_${uuid().replace(/-/g, '')}`, organizationId: workspaceA, userId, role: 'owner', createdAt: new Date(),
    });
    const ctx = { ...ctxA, userId };

    const seriesId = await makeSeries();
    const fleetId = uuid();
    await fleetsApi.putFleet(ctx, seriesId, fleetId, {
      id: fleetId, seriesId, name: 'Class 2', displayOrder: 0, scoringSystem: 'orc' as const,
    });
    const raceId = uuid();
    await races.putRace(ctx, seriesId, raceId, { id: raceId, seriesId, raceNumber: 1, date: '2026-09-12', createdAt: Date.now() });
    const line = mark(seriesId, 'Start');
    const z = mark(seriesId, 'Z', { lat: 53.3967, lng: -6.0702, from: { markId: line.id, bearingDeg: 190, distanceM: 1000 } });
    await library.putSeriesMark(ctx, seriesId, line.id, line);
    await library.putSeriesMark(ctx, seriesId, z.id, z);
    const course = await library.putSeriesCourse(ctx, seriesId, uuid(), {
      seriesId, name: 'Course A', marks: [{ markId: line.id }, { markId: z.id, side: 'port' }], createdAt: Date.now(),
    });
    const startId = uuid();
    await raceStarts.putRaceStart(ctx, raceId, startId, {
      id: startId, raceId, fleetIds: [fleetId], startTime: '14:00:00',
      course: {
        courseId: course.id, name: course.name,
        waypoints: [
          { markId: line.id, label: 'Start', lat: 53.4055, lng: -6.0675 },
          { markId: z.id, label: 'Z', lat: 53.3967, lng: -6.0702, side: 'port' },
        ],
      },
    });

    const { id: copyId } = await series.copySeries(ctx, seriesId, {});
    const copiedMarks = await library.listSeriesMarks(ctx, copyId);
    const copiedCourses = await library.listSeriesCourses(ctx, copyId);
    expect(copiedMarks.map((m) => m.name)).toEqual(['Start', 'Z']);
    expect(copiedMarks.every((m) => m.id !== line.id && m.id !== z.id)).toBe(true);
    const idByName = new Map(copiedMarks.map((m) => [m.name, m.id]));
    expect(copiedMarks[1].from?.markId).toBe(idByName.get('Start'));
    expect(copiedCourses).toHaveLength(1);
    expect(copiedCourses[0].marks.map((cm) => cm.markId)).toEqual([idByName.get('Start'), idByName.get('Z')]);

    const copiedRaces = await races.listRaces(ctx, copyId);
    const [copiedStart] = await raceStarts.listRaceStarts(ctx, copiedRaces[0].id);
    expect(copiedStart.course?.courseId).toBe(copiedCourses[0].id);
    expect(copiedStart.course?.waypoints.map((w) => w.markId)).toEqual([idByName.get('Start'), idByName.get('Z')]);
  });
});
