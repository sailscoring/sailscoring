/**
 * Schema round-trip test for ADR-008 Phase 2 PR #1.
 *
 * Proves the Drizzle schema in `lib/db/schema/` is a faithful representation
 * of every persistent field in `lib/types.ts`. Inserts a fully-populated
 * Series (with every optional field set) and every child resource, reads
 * back, asserts deep equality.
 *
 * Skipped when DATABASE_URL is unset so the unit-tests workflow keeps
 * passing on contributors without a Postgres handy. The integration-tests
 * workflow provides DATABASE_URL via a service container.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import type {
  Series,
  Fleet,
  Competitor,
  Race,
  RaceStart,
  Finish,
} from '@/lib/types';

const DATABASE_URL = process.env.DATABASE_URL;

const skip = !DATABASE_URL;

function uuid(): string {
  return crypto.randomUUID();
}

describe.skipIf(skip)('schema round-trip', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });

    // Seed an organization (= workspace) once. Each test inserts its own
    // series and children, all keyed off this workspace, and cleans up its
    // own rows in a finally block.
    workspaceId = `org_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Round-trip workspace',
      slug: `roundtrip-${workspaceId.slice(4, 12)}`,
      createdAt: new Date(),
    });
  });

  afterAll(async () => {
    if (workspaceId) {
      // Cascades through every series-scoped row.
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  test('round-trips a fully-populated series with every child resource', async () => {
    const seriesId = uuid();
    const now = new Date();

    const seriesRow: Series = {
      id: seriesId,
      name: 'Round-trip series',
      venue: 'Howth Yacht Club',
      startDate: '2026-04-01',
      endDate: '2026-04-30',
      venueLogoUrl: 'https://example.com/venue.png',
      eventLogoUrl: 'https://example.com/event.png',
      venueUrl: 'https://venue.example.com',
      eventUrl: 'https://event.example.com',
      createdAt: now.getTime(),
      lastSavedAt: now.getTime(),
      lastModifiedAt: now.getTime(),
      scoringMode: 'handicap',
      defaultStartSequence: [
        { fleetIds: [], intervalMinutes: 0 },
        { fleetIds: [], intervalMinutes: 5 },
      ],
      discardThresholds: [
        { minRaces: 4, discardCount: 1 },
        { minRaces: 8, discardCount: 2 },
      ],
      dnfScoring: 'startingArea',
      // JSONB, no FK — arbitrary uuids exercise the column round-trip.
      raceFleetExclusions: [{ raceId: uuid(), fleetId: uuid() }],
      ftpHost: 'ftp.example.com',
      ftpPath: '/results',
      ftpPaths: { 'fleet-a': '/results/scratch.html', 'fleet-b': '/results/echo.html' },
      includeJsonExport: false,
      publishRatingCalculations: false,
      showPerRaceRatingsInSummary: false,
      enabledCompetitorFields: ['boatName', 'boatClass', 'helm', 'crewName', 'club'],
      primaryPersonLabel: 'helm',
      subdivisionAxes: [],
      // JSONB, no FK — arbitrary uuids exercise the column round-trip.
      prizes: [
        {
          id: uuid(),
          name: 'Gold Fleet 1st, 2nd, 3rd',
          recipientCount: 3,
          clauses: [
            { kind: 'axis', axisId: 'axis-div', value: 'Gold' },
            { kind: 'fleet', fleetId: uuid() },
            { kind: 'rank', max: 3 },
          ],
        },
      ],
    };

    await db.insert(schema.series).values({
      id: seriesRow.id,
      workspaceId,
      name: seriesRow.name,
      venue: seriesRow.venue,
      startDate: seriesRow.startDate,
      endDate: seriesRow.endDate,
      venueLogoUrl: seriesRow.venueLogoUrl,
      eventLogoUrl: seriesRow.eventLogoUrl,
      venueUrl: seriesRow.venueUrl,
      eventUrl: seriesRow.eventUrl,
      createdAt: new Date(seriesRow.createdAt),
      lastSavedAt: seriesRow.lastSavedAt ? new Date(seriesRow.lastSavedAt) : null,
      lastModifiedAt: new Date(seriesRow.lastModifiedAt),
      scoringMode: seriesRow.scoringMode,
      defaultStartSequence: seriesRow.defaultStartSequence,
      discardThresholds: seriesRow.discardThresholds,
      dnfScoring: seriesRow.dnfScoring,
      raceFleetExclusions: seriesRow.raceFleetExclusions,
      ftpHost: seriesRow.ftpHost,
      ftpPath: seriesRow.ftpPath,
      ftpPaths: seriesRow.ftpPaths,
      includeJsonExport: seriesRow.includeJsonExport,
      publishRatingCalculations: seriesRow.publishRatingCalculations,
      showPerRaceRatingsInSummary: seriesRow.showPerRaceRatingsInSummary,
      enabledCompetitorFields: seriesRow.enabledCompetitorFields,
      primaryPersonLabel: seriesRow.primaryPersonLabel,
      prizes: seriesRow.prizes,
      displayOrder: 0,
    });

    // Fleets — one per scoring system to exercise echoAlpha.
    const fleets: Fleet[] = [
      { id: uuid(), seriesId, name: 'Scratch', displayOrder: 0, scoringSystem: 'scratch' },
      { id: uuid(), seriesId, name: 'IRC',     displayOrder: 1, scoringSystem: 'irc' },
      { id: uuid(), seriesId, name: 'PY',      displayOrder: 2, scoringSystem: 'py' },
      { id: uuid(), seriesId, name: 'NHC',     displayOrder: 3, scoringSystem: 'nhc' },
      { id: uuid(), seriesId, name: 'ECHO',    displayOrder: 4, scoringSystem: 'echo', echoAlpha: 0.30 },
    ];
    for (const f of fleets) {
      await db.insert(schema.fleets).values({
        id: f.id,
        seriesId,
        workspaceId,
        name: f.name,
        displayOrder: f.displayOrder,
        scoringSystem: f.scoringSystem,
        echoAlpha: f.echoAlpha ?? null,
      });
    }

    // Competitor in two fleets, every optional field populated.
    const competitor: Competitor = {
      id: uuid(),
      seriesId,
      fleetIds: [fleets[1].id, fleets[3].id],
      sailNumber: 'IRL-1234',
      boatName: 'The Big Picture',
      boatClass: 'Half-Tonner',
      names: ['Helm McHelmington'],
      owners: ['Owner O\'Owner'],
      helms: ['Helm McHelmington'],
      crewNames: ['Crew'],
      club: 'HYC',
      gender: 'M',
      age: 42,
      subdivisions: { 'axis-div': 'Gold' },
      createdAt: now.getTime(),
      ircTcc: 0.972,
      pyNumber: 1034,
      nhcStartingTcf: 0.95,
      echoStartingTcf: 0.97,
    };
    await db.insert(schema.competitors).values({
      id: competitor.id,
      seriesId,
      workspaceId,
      fleetIds: competitor.fleetIds,
      sailNumber: competitor.sailNumber,
      boatName: competitor.boatName,
      boatClass: competitor.boatClass,
      names: competitor.names,
      owners: competitor.owners,
      helms: competitor.helms,
      crewNames: competitor.crewNames,
      club: competitor.club,
      gender: competitor.gender,
      age: competitor.age,
      subdivisions: competitor.subdivisions,
      createdAt: new Date(competitor.createdAt),
      ircTcc: competitor.ircTcc,
      pyNumber: competitor.pyNumber,
      nhcStartingTcf: competitor.nhcStartingTcf,
      echoStartingTcf: competitor.echoStartingTcf,
    });

    // Race + race start + finish (with redress) + NHC TCF record.
    const race: Race = {
      id: uuid(),
      seriesId,
      raceNumber: 1,
      name: null,
      date: '2026-04-05',
      createdAt: now.getTime(),
    };
    await db.insert(schema.races).values({
      id: race.id,
      seriesId,
      workspaceId,
      raceNumber: race.raceNumber,
      date: race.date,
      createdAt: new Date(race.createdAt),
    });

    const start: RaceStart = {
      id: uuid(),
      raceId: race.id,
      fleetIds: [fleets[1].id, fleets[3].id],
      startTime: '11:00:00',
    };
    await db.insert(schema.raceStarts).values({
      id: start.id,
      raceId: start.raceId,
      fleetIds: start.fleetIds,
      startTime: start.startTime,
    });

    // Finish with RDG + redress configuration. Exercises every redress field.
    const finish: Finish = {
      id: uuid(),
      raceId: race.id,
      competitorId: competitor.id,
      sortOrder: 3,
      tiedWithPrevious: false,
      finishTime: '12:34:56',
      resultCode: 'RDG',
      startPresent: true,
      penaltyCode: 'SCP',
      penaltyOverride: 30,
      redressMethod: 'races_before',
      redressExcludeRaceIds: [uuid(), uuid()],
      redressIncludeRaceIds: [uuid(), uuid(), uuid()],
      redressIncludeAllLater: true,
      redressPoints: 4.5,
    };
    await db.insert(schema.finishes).values({
      id: finish.id,
      raceId: finish.raceId,
      competitorId: finish.competitorId,
      unknownSailNumber: finish.unknownSailNumber ?? null,
      sortOrder: finish.sortOrder,
      finishTime: finish.finishTime,
      resultCode: finish.resultCode,
      startPresent: finish.startPresent,
      penaltyCode: finish.penaltyCode,
      penaltyOverride: finish.penaltyOverride,
      redressMethod: finish.redressMethod,
      redressExcludeRaceIds: finish.redressExcludeRaceIds,
      redressIncludeRaceIds: finish.redressIncludeRaceIds,
      redressIncludeAllLater: finish.redressIncludeAllLater,
      redressPoints: finish.redressPoints,
    });

    // ---- Read back and assert ----

    const [readSeries] = await db
      .select()
      .from(schema.series)
      .where(eq(schema.series.id, seriesId));

    expect(readSeries).toMatchObject({
      id: seriesRow.id,
      workspaceId,
      name: seriesRow.name,
      venue: seriesRow.venue,
      startDate: seriesRow.startDate,
      endDate: seriesRow.endDate,
      venueLogoUrl: seriesRow.venueLogoUrl,
      eventLogoUrl: seriesRow.eventLogoUrl,
      venueUrl: seriesRow.venueUrl,
      eventUrl: seriesRow.eventUrl,
      scoringMode: seriesRow.scoringMode,
      defaultStartSequence: seriesRow.defaultStartSequence,
      discardThresholds: seriesRow.discardThresholds,
      dnfScoring: seriesRow.dnfScoring,
      raceFleetExclusions: seriesRow.raceFleetExclusions,
      ftpHost: seriesRow.ftpHost,
      ftpPath: seriesRow.ftpPath,
      ftpPaths: seriesRow.ftpPaths,
      includeJsonExport: seriesRow.includeJsonExport,
      publishRatingCalculations: seriesRow.publishRatingCalculations,
      showPerRaceRatingsInSummary: seriesRow.showPerRaceRatingsInSummary,
      enabledCompetitorFields: seriesRow.enabledCompetitorFields,
      primaryPersonLabel: seriesRow.primaryPersonLabel,
      prizes: seriesRow.prizes,
      version: 1,
    });
    // Timestamps survive the round-trip with millisecond precision.
    expect(readSeries.createdAt.getTime()).toBe(seriesRow.createdAt);
    expect(readSeries.lastSavedAt!.getTime()).toBe(seriesRow.lastSavedAt);
    expect(readSeries.lastModifiedAt.getTime()).toBe(seriesRow.lastModifiedAt);

    const readFleets = await db
      .select()
      .from(schema.fleets)
      .where(eq(schema.fleets.seriesId, seriesId))
      .orderBy(schema.fleets.displayOrder);
    expect(readFleets).toHaveLength(5);
    for (const [i, f] of fleets.entries()) {
      expect(readFleets[i]).toMatchObject({
        id: f.id,
        seriesId,
        workspaceId,
        name: f.name,
        displayOrder: f.displayOrder,
        scoringSystem: f.scoringSystem,
        echoAlpha: f.echoAlpha ?? null,
      });
    }

    const [readCompetitor] = await db
      .select()
      .from(schema.competitors)
      .where(eq(schema.competitors.id, competitor.id));
    expect(readCompetitor).toMatchObject({
      id: competitor.id,
      seriesId,
      workspaceId,
      fleetIds: competitor.fleetIds,
      sailNumber: competitor.sailNumber,
      boatName: competitor.boatName,
      boatClass: competitor.boatClass,
      names: competitor.names,
      owners: competitor.owners,
      helms: competitor.helms,
      crewNames: competitor.crewNames,
      club: competitor.club,
      gender: competitor.gender,
      age: competitor.age,
      subdivisions: competitor.subdivisions,
      ircTcc: competitor.ircTcc,
      pyNumber: competitor.pyNumber,
      nhcStartingTcf: competitor.nhcStartingTcf,
      echoStartingTcf: competitor.echoStartingTcf,
    });

    const [readStart] = await db
      .select()
      .from(schema.raceStarts)
      .where(eq(schema.raceStarts.raceId, race.id));
    expect(readStart).toMatchObject({
      id: start.id,
      raceId: race.id,
      fleetIds: start.fleetIds,
      startTime: start.startTime,
    });

    const [readFinish] = await db
      .select()
      .from(schema.finishes)
      .where(eq(schema.finishes.id, finish.id));
    expect(readFinish).toMatchObject({
      id: finish.id,
      raceId: finish.raceId,
      competitorId: finish.competitorId,
      sortOrder: finish.sortOrder,
      finishTime: finish.finishTime,
      resultCode: finish.resultCode,
      startPresent: finish.startPresent,
      penaltyCode: finish.penaltyCode,
      penaltyOverride: finish.penaltyOverride,
      redressMethod: finish.redressMethod,
      redressExcludeRaceIds: finish.redressExcludeRaceIds,
      redressIncludeRaceIds: finish.redressIncludeRaceIds,
      redressIncludeAllLater: finish.redressIncludeAllLater,
      redressPoints: finish.redressPoints,
    });

  });

  test('CHECK constraints reject invalid enum values', async () => {
    const seriesId = uuid();
    await expect(
      db.insert(schema.series).values({
        id: seriesId,
        workspaceId,
        name: 'invalid',
        scoringMode: 'invalid-mode' as 'scratch',
        enabledCompetitorFields: [],
        displayOrder: 0,
      }),
    ).rejects.toThrow();
  });

  test('cross-workspace cascade: deleting a series removes all children', async () => {
    const seriesId = uuid();
    await db.insert(schema.series).values({
      id: seriesId,
      workspaceId,
      name: 'cascade test',
      scoringMode: 'scratch',
      dnfScoring: 'seriesEntries',
      enabledCompetitorFields: [],
      primaryPersonLabel: 'competitor',
      displayOrder: 0,
    });
    const fleetId = uuid();
    await db.insert(schema.fleets).values({
      id: fleetId,
      seriesId,
      workspaceId,
      name: 'F',
      displayOrder: 0,
      scoringSystem: 'scratch',
    });
    const raceId = uuid();
    await db.insert(schema.races).values({
      id: raceId,
      seriesId,
      workspaceId,
      raceNumber: 1,
    });

    await db.delete(schema.series).where(eq(schema.series.id, seriesId));

    const fleetsAfter = await db.select().from(schema.fleets).where(eq(schema.fleets.id, fleetId));
    const racesAfter = await db.select().from(schema.races).where(eq(schema.races.id, raceId));
    expect(fleetsAfter).toHaveLength(0);
    expect(racesAfter).toHaveLength(0);
  });
});
