// @vitest-environment node

/**
 * Migration 0123 rewrites the race starts' courses the way
 * lib/course-library-upgrade.ts rewrites a stored file's, and the two have
 * to agree: every row here is written in a shape a build with the course
 * library could leave, the migration's own SQL is run over it, and the row
 * must come out exactly as the TS upgrader brings the same start forward —
 * plus the empty `waypoints` every row keeps for the build before. Skipped
 * when DATABASE_URL is unset; runs against the local/CI Postgres.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq, inArray } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import { upgradeStartCourse } from '@/lib/course-library-upgrade';
import * as schema from '@/lib/db/schema';
import { seedFeatureSample } from '@/lib/sample-series/seed';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const MIGRATION = readFileSync(join(__dirname, '..', '..', 'drizzle', '0123_course_library_upgrade.sql'), 'utf8');

type Raw = Record<string, unknown>;

const LEGS = [
  { distanceNm: 0.54, bearingDeg: 190, windDirectionDeg: 190 },
  { distanceNm: 1.0, bearingDeg: 350, windDirectionDeg: 190 },
  { distanceNm: 0.5, bearingDeg: 200, windDirectionDeg: 190 },
];
const WAYPOINTS = [
  { markId: 'b9a3b1b2-0000-4000-8000-000000000001', label: 'Start', lat: 53.4055, lng: -6.0675 },
  { markId: 'b9a3b1b2-0000-4000-8000-000000000002', label: 'Z', lat: 53.3967, lng: -6.0702, side: 'port', cardMarkId: 'Z' },
  { label: 'I', lat: 53.411667, lng: -6.072667, side: 'starboard', passing: true, fixed: true, set: 'hyc/al-2026' },
  { label: 'Start', lat: 53.4055, lng: -6.0675, side: 'port' },
];
const libraryCourse = (extra: Raw = {}): Raw => ({
  courseId: 'b9a3b1b2-0000-4000-8000-0000000000c1',
  name: '19 — 12 Sep R1',
  waypoints: WAYPOINTS,
  windDirectionDeg: 190,
  ...extra,
});

/** The shapes a start's course could be left in, with the legs scored. */
const CASES: { name: string; course: Raw; courseLegs: Raw[] | null }[] = [
  { name: 'picked from the library, legs its own', course: libraryCourse(), courseLegs: LEGS },
  { name: 'picked, then edited', course: libraryCourse({ legsEdited: true }), courseLegs: [...LEGS, { distanceNm: 0.2, bearingDeg: 10, windDirectionDeg: 190 }] },
  { name: 'routed through a passage', course: libraryCourse(), courseLegs: [...LEGS, { distanceNm: 0.3, bearingDeg: 90, windDirectionDeg: 190 }] },
  {
    name: 'from a line, its marks long-named, a leg already named',
    course: libraryCourse({
      waypoints: [
        {
          label: 'Start–Pin', lat: 53.40475, lng: -6.06825,
          ends: [
            { end: 'starboard', label: 'Start', lat: 53.4055, lng: -6.0675 },
            { end: 'port', label: 'Pin', lat: 53.404, lng: -6.069 },
          ],
        },
        { label: 'A mark with a name so long that, with the mark before it, it runs past what a leg keeps', lat: 53.3967, lng: -6.0702 },
        { label: 'I', lat: 53.411667, lng: -6.072667 },
        { label: 'Start', lat: 53.4055, lng: -6.0675 },
      ],
      windSpeedKts: 9,
    }),
    courseLegs: LEGS.map((l, i) => ({ ...l, windSpeedKts: 9, ...(i === 2 ? { name: 'Home' } : {}) })),
  },
  {
    name: 'a library leg table',
    course: { courseId: 'b9a3b1b2-0000-4000-8000-0000000000c2', name: 'RC table', waypoints: [], legs: [{ distanceNm: 2.09, bearingDeg: 162 }] },
    courseLegs: [{ distanceNm: 2.09, bearingDeg: 162, windDirectionDeg: 225 }],
  },
  {
    name: 'imported, kept in magnetic',
    course: { name: 'Thursday, Race 2', waypoints: [], legs: [{ distanceNm: 0.67, bearingDeg: 282 }], north: 'magnetic', windDirectionDeg: 280 },
    courseLegs: [{ distanceNm: 0.67, bearingDeg: 282, windDirectionDeg: 280 }],
  },
  { name: 'picked, with no legs scored', course: libraryCourse(), courseLegs: null },
];

describe.skipIf(skip)('migration 0123: race starts’ courses without the library', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let raceId: string;
  let fleetId: string;
  const ids = CASES.map(() => crypto.randomUUID());

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_cl0123_${crypto.randomUUID().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Course Library Migration Test',
      slug: `c-${workspaceId.slice(11, 21)}`,
      createdAt: new Date(),
    });
    // The ORC sample, for a series and a race to hang the starts on.
    await seedFeatureSample('orc', workspaceId, db);
    const [series] = await db.select().from(schema.series).where(eq(schema.series.workspaceId, workspaceId));
    const [race] = await db.select().from(schema.races).where(eq(schema.races.seriesId, series.id));
    const [fleet] = await db.select().from(schema.fleets).where(eq(schema.fleets.seriesId, series.id));
    raceId = race.id;
    fleetId = fleet.id;
    await db.insert(schema.raceStarts).values(CASES.map((c, i) => ({
      id: ids[i],
      raceId,
      fleetIds: [fleetId],
      courseLegs: c.courseLegs as (typeof schema.raceStarts.$inferInsert)['courseLegs'],
      course: c.course as unknown as schema.StoredRaceStartCourse,
    })));
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  test('brings every row forward as the upgrader brings a file’s start', async () => {
    await sql.unsafe(MIGRATION);
    const rows = await db.select().from(schema.raceStarts).where(and(eq(schema.raceStarts.raceId, raceId), inArray(schema.raceStarts.id, ids)));
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const [i, c] of CASES.entries()) {
      const expected: Raw = { course: structuredClone(c.course), courseLegs: structuredClone(c.courseLegs ?? undefined) };
      upgradeStartCourse(expected);
      const row = byId.get(ids[i])!;
      expect({ name: c.name, course: row.course, courseLegs: row.courseLegs }).toEqual({
        name: c.name,
        course: { ...(expected.course as Raw), waypoints: [] },
        courseLegs: expected.courseLegs ?? null,
      });
    }
  });

  test('leaves a row it has already brought forward as it is', async () => {
    const before = await db.select().from(schema.raceStarts).where(inArray(schema.raceStarts.id, ids));
    await sql.unsafe(MIGRATION);
    const after = await db.select().from(schema.raceStarts).where(inArray(schema.raceStarts.id, ids));
    const key = (r: (typeof before)[number]) => JSON.stringify([r.id, r.course, r.courseLegs, r.version]);
    expect(after.map(key).sort()).toEqual(before.map(key).sort());
  });
});
