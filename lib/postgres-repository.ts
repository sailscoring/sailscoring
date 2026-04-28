import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { getDb, type SailScoringDb } from './db/client';
import * as schema from './db/schema';
import type {
  CompetitorRepository,
  FinishRepository,
  FleetRepository,
  RaceRepository,
  RaceStartRepository,
  SeriesRepository,
} from './repository';
import type {
  Competitor,
  Fleet,
  Finish,
  PenaltyCode,
  Race,
  RaceStart,
  ResultCode,
  Series,
} from './types';

/**
 * ADR-008 Phase 2 Postgres-backed repositories.
 *
 * Conventions (load-bearing — see ADR-008's "Tenancy enforcement" section):
 * - Every repository takes a `workspaceId`. Every read filters by it; every
 *   write copies it onto rows that carry `workspace_id`.
 * - Reads of child resources (race-starts, finishes, NHC TCF records) reach
 *   the workspace via their parent — methods that take `raceId` first verify
 *   the race belongs to a series in this workspace.
 * - Saves bump `version`. Phase 4 will add an `expectedVersion` parameter
 *   and surface 409s; Phase 2 is unconditional-bump only.
 * - Mappers below isolate the Drizzle row shape from the app types in
 *   `lib/types.ts`. App types use epoch ms for timestamps; Drizzle gives
 *   us `Date` objects; the conversion is the one place that knows.
 */

export interface RepoCtx {
  /** Drizzle client. Defaults to the shared lazy client in lib/db/client.ts. */
  db?: SailScoringDb;
  /** Better Auth `organization.id`. Required — every query filters on this. */
  workspaceId: string;
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

type SeriesRow = typeof schema.series.$inferSelect;
type FleetRow = typeof schema.fleets.$inferSelect;
type CompetitorRow = typeof schema.competitors.$inferSelect;
type RaceRow = typeof schema.races.$inferSelect;
type RaceStartRow = typeof schema.raceStarts.$inferSelect;
type FinishRow = typeof schema.finishes.$inferSelect;

function seriesRowToType(row: SeriesRow): Series {
  return {
    id: row.id,
    name: row.name,
    venue: row.venue,
    startDate: row.startDate,
    endDate: row.endDate,
    venueLogoUrl: row.venueLogoUrl,
    eventLogoUrl: row.eventLogoUrl,
    createdAt: row.createdAt.getTime(),
    lastSnapshotId: row.lastSnapshotId,
    lastSavedAt: row.lastSavedAt ? row.lastSavedAt.getTime() : null,
    lastModifiedAt: row.lastModifiedAt.getTime(),
    snapshotHistory: row.snapshotHistory,
    scoringMode: row.scoringMode as Series['scoringMode'],
    defaultStartSequence: row.defaultStartSequence ?? undefined,
    discardThresholds: row.discardThresholds,
    dnfScoring: row.dnfScoring as Series['dnfScoring'],
    ftpHost: row.ftpHost,
    ftpPath: row.ftpPath,
    bilgeBundle: row.bilgeBundle,
    includeJsonExport: row.includeJsonExport,
    publishRatingCalculations: row.publishRatingCalculations,
    enabledCompetitorFields: row.enabledCompetitorFields,
    primaryPersonLabel: row.primaryPersonLabel,
  };
}

function fleetRowToType(row: FleetRow): Fleet {
  return {
    id: row.id,
    seriesId: row.seriesId,
    name: row.name,
    displayOrder: row.displayOrder,
    scoringSystem: row.scoringSystem as Fleet['scoringSystem'],
    ...(row.nhcAlpha != null ? { nhcAlpha: row.nhcAlpha } : {}),
    ...(row.echoAlpha != null ? { echoAlpha: row.echoAlpha } : {}),
  };
}

function competitorRowToType(row: CompetitorRow): Competitor {
  return {
    id: row.id,
    seriesId: row.seriesId,
    fleetIds: row.fleetIds,
    sailNumber: row.sailNumber,
    ...(row.boatName ? { boatName: row.boatName } : {}),
    ...(row.boatClass ? { boatClass: row.boatClass } : {}),
    name: row.name,
    ...(row.owner ? { owner: row.owner } : {}),
    ...(row.helm ? { helm: row.helm } : {}),
    ...(row.crewName ? { crewName: row.crewName } : {}),
    club: row.club,
    gender: row.gender as Competitor['gender'],
    age: row.age,
    createdAt: row.createdAt.getTime(),
    ...(row.ircTcc != null ? { ircTcc: row.ircTcc } : {}),
    ...(row.pyNumber != null ? { pyNumber: row.pyNumber } : {}),
    ...(row.nhcStartingTcf != null ? { nhcStartingTcf: row.nhcStartingTcf } : {}),
    ...(row.echoStartingTcf != null ? { echoStartingTcf: row.echoStartingTcf } : {}),
  };
}

function raceRowToType(row: RaceRow): Race {
  return {
    id: row.id,
    seriesId: row.seriesId,
    raceNumber: row.raceNumber,
    date: row.date,
    createdAt: row.createdAt.getTime(),
  };
}

function raceStartRowToType(row: RaceStartRow): RaceStart {
  return {
    id: row.id,
    raceId: row.raceId,
    fleetIds: row.fleetIds,
    startTime: row.startTime,
  };
}

function finishRowToType(row: FinishRow): Finish {
  return {
    id: row.id,
    raceId: row.raceId,
    competitorId: row.competitorId,
    ...(row.unknownSailNumber != null
      ? { unknownSailNumber: row.unknownSailNumber }
      : {}),
    sortOrder: row.sortOrder,
    ...(row.finishTime != null ? { finishTime: row.finishTime } : {}),
    resultCode: row.resultCode as ResultCode | null,
    startPresent: row.startPresent,
    penaltyCode: row.penaltyCode as PenaltyCode | null,
    penaltyOverride: row.penaltyOverride,
    redressMethod: row.redressMethod as Finish['redressMethod'],
    redressExcludeRaces: row.redressExcludeRaces,
    redressIncludeRaces: row.redressIncludeRaces,
    redressIncludeAllLater: row.redressIncludeAllLater,
    redressPoints: row.redressPoints,
  };
}

// ─── Series ───────────────────────────────────────────────────────────────────

export class PostgresSeriesRepository implements SeriesRepository {
  private readonly db: SailScoringDb;
  private readonly workspaceId: string;

  constructor(ctx: RepoCtx) {
    this.db = ctx.db ?? getDb();
    this.workspaceId = ctx.workspaceId;
  }

  async list(): Promise<Series[]> {
    const rows = await this.db
      .select()
      .from(schema.series)
      .where(eq(schema.series.workspaceId, this.workspaceId))
      .orderBy(sql`${schema.series.createdAt} desc`);
    return rows.map(seriesRowToType);
  }

  async get(id: string): Promise<Series | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.series)
      .where(
        and(
          eq(schema.series.id, id),
          eq(schema.series.workspaceId, this.workspaceId),
        ),
      )
      .limit(1);
    return row ? seriesRowToType(row) : undefined;
  }

  async save(s: Series): Promise<Series> {
    const insertValues = {
      id: s.id,
      workspaceId: this.workspaceId,
      name: s.name,
      venue: s.venue,
      startDate: s.startDate,
      endDate: s.endDate,
      venueLogoUrl: s.venueLogoUrl,
      eventLogoUrl: s.eventLogoUrl,
      createdAt: new Date(s.createdAt),
      lastSnapshotId: s.lastSnapshotId,
      lastSavedAt: s.lastSavedAt != null ? new Date(s.lastSavedAt) : null,
      lastModifiedAt: new Date(s.lastModifiedAt),
      snapshotHistory: s.snapshotHistory,
      scoringMode: s.scoringMode,
      defaultStartSequence: s.defaultStartSequence ?? null,
      discardThresholds: s.discardThresholds,
      dnfScoring: s.dnfScoring,
      ftpHost: s.ftpHost,
      ftpPath: s.ftpPath,
      bilgeBundle: s.bilgeBundle,
      includeJsonExport: s.includeJsonExport,
      publishRatingCalculations: s.publishRatingCalculations ?? true,
      enabledCompetitorFields: s.enabledCompetitorFields,
      primaryPersonLabel: s.primaryPersonLabel,
    };
    const [row] = await this.db
      .insert(schema.series)
      .values(insertValues)
      .onConflictDoUpdate({
        target: schema.series.id,
        // Tenancy guard on conflict: only update if the existing row is in
        // this workspace. A cross-workspace id collision is not supposed to
        // happen (UUIDs are unique), but if it ever did, this keeps the
        // tenancy boundary intact.
        targetWhere: eq(schema.series.workspaceId, this.workspaceId),
        set: {
          name: insertValues.name,
          venue: insertValues.venue,
          startDate: insertValues.startDate,
          endDate: insertValues.endDate,
          venueLogoUrl: insertValues.venueLogoUrl,
          eventLogoUrl: insertValues.eventLogoUrl,
          lastSnapshotId: insertValues.lastSnapshotId,
          lastSavedAt: insertValues.lastSavedAt,
          lastModifiedAt: insertValues.lastModifiedAt,
          snapshotHistory: insertValues.snapshotHistory,
          scoringMode: insertValues.scoringMode,
          defaultStartSequence: insertValues.defaultStartSequence,
          discardThresholds: insertValues.discardThresholds,
          dnfScoring: insertValues.dnfScoring,
          ftpHost: insertValues.ftpHost,
          ftpPath: insertValues.ftpPath,
          bilgeBundle: insertValues.bilgeBundle,
          includeJsonExport: insertValues.includeJsonExport,
          publishRatingCalculations: insertValues.publishRatingCalculations,
          enabledCompetitorFields: insertValues.enabledCompetitorFields,
          primaryPersonLabel: insertValues.primaryPersonLabel,
          version: sql`${schema.series.version} + 1`,
          updatedAt: sql`now()`,
        },
      })
      .returning();
    return seriesRowToType(row);
  }

  async delete(id: string): Promise<void> {
    await this.db
      .delete(schema.series)
      .where(
        and(
          eq(schema.series.id, id),
          eq(schema.series.workspaceId, this.workspaceId),
        ),
      );
  }

  async touch(id: string): Promise<void> {
    await this.db
      .update(schema.series)
      .set({ lastModifiedAt: sql`now()`, version: sql`${schema.series.version} + 1` })
      .where(
        and(
          eq(schema.series.id, id),
          eq(schema.series.workspaceId, this.workspaceId),
        ),
      );
  }
}

// ─── Fleets ───────────────────────────────────────────────────────────────────

export class PostgresFleetRepository implements FleetRepository {
  private readonly db: SailScoringDb;
  private readonly workspaceId: string;

  constructor(ctx: RepoCtx) {
    this.db = ctx.db ?? getDb();
    this.workspaceId = ctx.workspaceId;
  }

  async listBySeries(seriesId: string): Promise<Fleet[]> {
    const rows = await this.db
      .select()
      .from(schema.fleets)
      .where(
        and(
          eq(schema.fleets.seriesId, seriesId),
          eq(schema.fleets.workspaceId, this.workspaceId),
        ),
      )
      .orderBy(schema.fleets.displayOrder);
    return rows.map(fleetRowToType);
  }

  async get(id: string): Promise<Fleet | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.fleets)
      .where(
        and(
          eq(schema.fleets.id, id),
          eq(schema.fleets.workspaceId, this.workspaceId),
        ),
      )
      .limit(1);
    return row ? fleetRowToType(row) : undefined;
  }

  async save(fleet: Fleet): Promise<Fleet> {
    const values = {
      id: fleet.id,
      seriesId: fleet.seriesId,
      workspaceId: this.workspaceId,
      name: fleet.name,
      displayOrder: fleet.displayOrder,
      scoringSystem: fleet.scoringSystem,
      nhcAlpha: fleet.nhcAlpha ?? null,
      echoAlpha: fleet.echoAlpha ?? null,
    };
    const [row] = await this.db
      .insert(schema.fleets)
      .values(values)
      .onConflictDoUpdate({
        target: schema.fleets.id,
        targetWhere: eq(schema.fleets.workspaceId, this.workspaceId),
        set: {
          name: values.name,
          displayOrder: values.displayOrder,
          scoringSystem: values.scoringSystem,
          nhcAlpha: values.nhcAlpha,
          echoAlpha: values.echoAlpha,
          version: sql`${schema.fleets.version} + 1`,
          updatedAt: sql`now()`,
        },
      })
      .returning();
    return fleetRowToType(row);
  }

  async delete(id: string): Promise<void> {
    await this.db
      .delete(schema.fleets)
      .where(
        and(
          eq(schema.fleets.id, id),
          eq(schema.fleets.workspaceId, this.workspaceId),
        ),
      );
  }

  async deleteBySeries(seriesId: string): Promise<void> {
    await this.db
      .delete(schema.fleets)
      .where(
        and(
          eq(schema.fleets.seriesId, seriesId),
          eq(schema.fleets.workspaceId, this.workspaceId),
        ),
      );
  }
}

// ─── Competitors ──────────────────────────────────────────────────────────────

export class PostgresCompetitorRepository implements CompetitorRepository {
  private readonly db: SailScoringDb;
  private readonly workspaceId: string;

  constructor(ctx: RepoCtx) {
    this.db = ctx.db ?? getDb();
    this.workspaceId = ctx.workspaceId;
  }

  async listBySeries(seriesId: string): Promise<Competitor[]> {
    const rows = await this.db
      .select()
      .from(schema.competitors)
      .where(
        and(
          eq(schema.competitors.seriesId, seriesId),
          eq(schema.competitors.workspaceId, this.workspaceId),
        ),
      )
      .orderBy(schema.competitors.sailNumber);
    return rows.map(competitorRowToType);
  }

  async get(id: string): Promise<Competitor | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.competitors)
      .where(
        and(
          eq(schema.competitors.id, id),
          eq(schema.competitors.workspaceId, this.workspaceId),
        ),
      )
      .limit(1);
    return row ? competitorRowToType(row) : undefined;
  }

  async save(c: Competitor): Promise<Competitor> {
    const values = {
      id: c.id,
      seriesId: c.seriesId,
      workspaceId: this.workspaceId,
      fleetIds: c.fleetIds,
      sailNumber: c.sailNumber,
      boatName: c.boatName ?? null,
      boatClass: c.boatClass ?? null,
      name: c.name,
      owner: c.owner ?? null,
      helm: c.helm ?? null,
      crewName: c.crewName ?? null,
      club: c.club,
      gender: c.gender,
      age: c.age,
      createdAt: new Date(c.createdAt),
      ircTcc: c.ircTcc ?? null,
      pyNumber: c.pyNumber ?? null,
      nhcStartingTcf: c.nhcStartingTcf ?? null,
      echoStartingTcf: c.echoStartingTcf ?? null,
    };
    const [row] = await this.db
      .insert(schema.competitors)
      .values(values)
      .onConflictDoUpdate({
        target: schema.competitors.id,
        targetWhere: eq(schema.competitors.workspaceId, this.workspaceId),
        set: {
          fleetIds: values.fleetIds,
          sailNumber: values.sailNumber,
          boatName: values.boatName,
          boatClass: values.boatClass,
          name: values.name,
          owner: values.owner,
          helm: values.helm,
          crewName: values.crewName,
          club: values.club,
          gender: values.gender,
          age: values.age,
          ircTcc: values.ircTcc,
          pyNumber: values.pyNumber,
          nhcStartingTcf: values.nhcStartingTcf,
          echoStartingTcf: values.echoStartingTcf,
          version: sql`${schema.competitors.version} + 1`,
          updatedAt: sql`now()`,
        },
      })
      .returning();
    return competitorRowToType(row);
  }

  async delete(id: string): Promise<void> {
    await this.db
      .delete(schema.competitors)
      .where(
        and(
          eq(schema.competitors.id, id),
          eq(schema.competitors.workspaceId, this.workspaceId),
        ),
      );
  }

  async deleteBySeries(seriesId: string): Promise<void> {
    await this.db
      .delete(schema.competitors)
      .where(
        and(
          eq(schema.competitors.seriesId, seriesId),
          eq(schema.competitors.workspaceId, this.workspaceId),
        ),
      );
  }
}

// ─── Races ────────────────────────────────────────────────────────────────────

export class PostgresRaceRepository implements RaceRepository {
  private readonly db: SailScoringDb;
  private readonly workspaceId: string;

  constructor(ctx: RepoCtx) {
    this.db = ctx.db ?? getDb();
    this.workspaceId = ctx.workspaceId;
  }

  async listBySeries(seriesId: string): Promise<Race[]> {
    const rows = await this.db
      .select()
      .from(schema.races)
      .where(
        and(
          eq(schema.races.seriesId, seriesId),
          eq(schema.races.workspaceId, this.workspaceId),
        ),
      )
      .orderBy(schema.races.raceNumber);
    return rows.map(raceRowToType);
  }

  async get(id: string): Promise<Race | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.races)
      .where(
        and(
          eq(schema.races.id, id),
          eq(schema.races.workspaceId, this.workspaceId),
        ),
      )
      .limit(1);
    return row ? raceRowToType(row) : undefined;
  }

  async save(r: Race): Promise<Race> {
    const values = {
      id: r.id,
      seriesId: r.seriesId,
      workspaceId: this.workspaceId,
      raceNumber: r.raceNumber,
      date: r.date,
      createdAt: new Date(r.createdAt),
    };
    const [row] = await this.db
      .insert(schema.races)
      .values(values)
      .onConflictDoUpdate({
        target: schema.races.id,
        targetWhere: eq(schema.races.workspaceId, this.workspaceId),
        set: {
          raceNumber: values.raceNumber,
          date: values.date,
          version: sql`${schema.races.version} + 1`,
          updatedAt: sql`now()`,
        },
      })
      .returning();
    return raceRowToType(row);
  }

  async delete(id: string): Promise<void> {
    await this.db
      .delete(schema.races)
      .where(
        and(
          eq(schema.races.id, id),
          eq(schema.races.workspaceId, this.workspaceId),
        ),
      );
  }

  async deleteBySeries(seriesId: string): Promise<void> {
    await this.db
      .delete(schema.races)
      .where(
        and(
          eq(schema.races.seriesId, seriesId),
          eq(schema.races.workspaceId, this.workspaceId),
        ),
      );
  }
}

// ─── Race-scoped child repositories: tenancy via the parent race ─────────────

/** Returns the race ids that belong to this workspace, given a candidate set. */
async function filterRaceIdsByWorkspace(
  db: SailScoringDb,
  workspaceId: string,
  raceIds: string[],
): Promise<string[]> {
  if (raceIds.length === 0) return [];
  const rows = await db
    .select({ id: schema.races.id })
    .from(schema.races)
    .where(
      and(
        inArray(schema.races.id, raceIds),
        eq(schema.races.workspaceId, workspaceId),
      ),
    );
  return rows.map((r) => r.id);
}

async function isRaceInWorkspace(
  db: SailScoringDb,
  workspaceId: string,
  raceId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.races.id })
    .from(schema.races)
    .where(
      and(
        eq(schema.races.id, raceId),
        eq(schema.races.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

// ─── RaceStarts ──────────────────────────────────────────────────────────────

export class PostgresRaceStartRepository implements RaceStartRepository {
  private readonly db: SailScoringDb;
  private readonly workspaceId: string;

  constructor(ctx: RepoCtx) {
    this.db = ctx.db ?? getDb();
    this.workspaceId = ctx.workspaceId;
  }

  async listByRace(raceId: string): Promise<RaceStart[]> {
    if (!(await isRaceInWorkspace(this.db, this.workspaceId, raceId))) return [];
    const rows = await this.db
      .select()
      .from(schema.raceStarts)
      .where(eq(schema.raceStarts.raceId, raceId));
    return rows.map(raceStartRowToType);
  }

  async listByRaces(raceIds: string[]): Promise<RaceStart[]> {
    const owned = await filterRaceIdsByWorkspace(
      this.db,
      this.workspaceId,
      raceIds,
    );
    if (owned.length === 0) return [];
    const rows = await this.db
      .select()
      .from(schema.raceStarts)
      .where(inArray(schema.raceStarts.raceId, owned));
    return rows.map(raceStartRowToType);
  }

  async save(s: RaceStart): Promise<RaceStart> {
    if (!(await isRaceInWorkspace(this.db, this.workspaceId, s.raceId))) {
      throw new Error(`race ${s.raceId} not in workspace`);
    }
    const values = {
      id: s.id,
      raceId: s.raceId,
      fleetIds: s.fleetIds,
      startTime: s.startTime,
    };
    const [row] = await this.db
      .insert(schema.raceStarts)
      .values(values)
      .onConflictDoUpdate({
        target: schema.raceStarts.id,
        set: {
          fleetIds: values.fleetIds,
          startTime: values.startTime,
          version: sql`${schema.raceStarts.version} + 1`,
          updatedAt: sql`now()`,
        },
      })
      .returning();
    return raceStartRowToType(row);
  }

  async delete(id: string): Promise<void> {
    // Verify the row's parent race is in this workspace.
    const [join] = await this.db
      .select({ id: schema.raceStarts.id })
      .from(schema.raceStarts)
      .innerJoin(schema.races, eq(schema.raceStarts.raceId, schema.races.id))
      .where(
        and(
          eq(schema.raceStarts.id, id),
          eq(schema.races.workspaceId, this.workspaceId),
        ),
      )
      .limit(1);
    if (!join) return;
    await this.db.delete(schema.raceStarts).where(eq(schema.raceStarts.id, id));
  }

  async deleteByRace(raceId: string): Promise<void> {
    if (!(await isRaceInWorkspace(this.db, this.workspaceId, raceId))) return;
    await this.db
      .delete(schema.raceStarts)
      .where(eq(schema.raceStarts.raceId, raceId));
  }

  async deleteByRaces(raceIds: string[]): Promise<void> {
    const owned = await filterRaceIdsByWorkspace(
      this.db,
      this.workspaceId,
      raceIds,
    );
    if (owned.length === 0) return;
    await this.db
      .delete(schema.raceStarts)
      .where(inArray(schema.raceStarts.raceId, owned));
  }
}

// ─── Finishes ────────────────────────────────────────────────────────────────

export class PostgresFinishRepository implements FinishRepository {
  private readonly db: SailScoringDb;
  private readonly workspaceId: string;

  constructor(ctx: RepoCtx) {
    this.db = ctx.db ?? getDb();
    this.workspaceId = ctx.workspaceId;
  }

  async listByRace(raceId: string): Promise<Finish[]> {
    if (!(await isRaceInWorkspace(this.db, this.workspaceId, raceId))) return [];
    const rows = await this.db
      .select()
      .from(schema.finishes)
      .where(eq(schema.finishes.raceId, raceId));
    return rows.map(finishRowToType);
  }

  async listBySeries(
    seriesId: string,
    competitorIds: string[],
  ): Promise<Finish[]> {
    if (competitorIds.length === 0) return [];
    // Tenancy: gate via a join through races to confirm seriesId is in
    // this workspace. The competitorIds are then trusted.
    const ownedRaces = await this.db
      .select({ id: schema.races.id })
      .from(schema.races)
      .where(
        and(
          eq(schema.races.seriesId, seriesId),
          eq(schema.races.workspaceId, this.workspaceId),
        ),
      );
    if (ownedRaces.length === 0) return [];
    const ownedRaceIds = ownedRaces.map((r) => r.id);
    const rows = await this.db
      .select()
      .from(schema.finishes)
      .where(
        and(
          inArray(schema.finishes.competitorId, competitorIds),
          inArray(schema.finishes.raceId, ownedRaceIds),
        ),
      );
    return rows.map(finishRowToType);
  }

  async save(f: Finish): Promise<Finish> {
    if (!(await isRaceInWorkspace(this.db, this.workspaceId, f.raceId))) {
      throw new Error(`race ${f.raceId} not in workspace`);
    }
    const values = finishToRow(f);
    const [row] = await this.db
      .insert(schema.finishes)
      .values(values)
      .onConflictDoUpdate({
        target: schema.finishes.id,
        set: {
          ...finishUpdateSet(values),
          version: sql`${schema.finishes.version} + 1`,
          updatedAt: sql`now()`,
        },
      })
      .returning();
    return finishRowToType(row);
  }

  async saveMany(finishes: Finish[]): Promise<void> {
    if (finishes.length === 0) return;
    // Verify every parent race is in this workspace before writing anything.
    const raceIds = [...new Set(finishes.map((f) => f.raceId))];
    const owned = await filterRaceIdsByWorkspace(
      this.db,
      this.workspaceId,
      raceIds,
    );
    if (owned.length !== raceIds.length) {
      throw new Error('some races not in workspace');
    }
    const values = finishes.map(finishToRow);
    await this.db
      .insert(schema.finishes)
      .values(values)
      .onConflictDoUpdate({
        target: schema.finishes.id,
        set: {
          ...finishUpdateSetExcluded(),
          version: sql`${schema.finishes.version} + 1`,
          updatedAt: sql`now()`,
        },
      });
  }

  async delete(id: string): Promise<void> {
    const [join] = await this.db
      .select({ id: schema.finishes.id })
      .from(schema.finishes)
      .innerJoin(schema.races, eq(schema.finishes.raceId, schema.races.id))
      .where(
        and(
          eq(schema.finishes.id, id),
          eq(schema.races.workspaceId, this.workspaceId),
        ),
      )
      .limit(1);
    if (!join) return;
    await this.db.delete(schema.finishes).where(eq(schema.finishes.id, id));
  }

  async deleteByRace(raceId: string): Promise<void> {
    if (!(await isRaceInWorkspace(this.db, this.workspaceId, raceId))) return;
    await this.db.delete(schema.finishes).where(eq(schema.finishes.raceId, raceId));
  }

  async deleteByRaces(raceIds: string[]): Promise<void> {
    const owned = await filterRaceIdsByWorkspace(
      this.db,
      this.workspaceId,
      raceIds,
    );
    if (owned.length === 0) return;
    await this.db
      .delete(schema.finishes)
      .where(inArray(schema.finishes.raceId, owned));
  }
}

function finishToRow(f: Finish) {
  return {
    id: f.id,
    raceId: f.raceId,
    competitorId: f.competitorId,
    unknownSailNumber: f.unknownSailNumber ?? null,
    sortOrder: f.sortOrder,
    finishTime: f.finishTime ?? null,
    resultCode: f.resultCode,
    startPresent: f.startPresent,
    penaltyCode: f.penaltyCode,
    penaltyOverride: f.penaltyOverride,
    redressMethod: f.redressMethod,
    redressExcludeRaces: f.redressExcludeRaces,
    redressIncludeRaces: f.redressIncludeRaces,
    redressIncludeAllLater: f.redressIncludeAllLater,
    redressPoints: f.redressPoints,
  };
}

function finishUpdateSet(values: ReturnType<typeof finishToRow>) {
  return {
    competitorId: values.competitorId,
    unknownSailNumber: values.unknownSailNumber,
    sortOrder: values.sortOrder,
    finishTime: values.finishTime,
    resultCode: values.resultCode,
    startPresent: values.startPresent,
    penaltyCode: values.penaltyCode,
    penaltyOverride: values.penaltyOverride,
    redressMethod: values.redressMethod,
    redressExcludeRaces: values.redressExcludeRaces,
    redressIncludeRaces: values.redressIncludeRaces,
    redressIncludeAllLater: values.redressIncludeAllLater,
    redressPoints: values.redressPoints,
  };
}

/**
 * `excluded` reference for the bulk-upsert path. ON CONFLICT DO UPDATE in
 * Postgres can pick values from the `excluded` pseudo-row (the row that
 * would have been inserted), which lets one statement upsert many rows.
 */
function finishUpdateSetExcluded() {
  return {
    competitorId: sql`excluded.competitor_id`,
    unknownSailNumber: sql`excluded.unknown_sail_number`,
    sortOrder: sql`excluded.sort_order`,
    finishTime: sql`excluded.finish_time`,
    resultCode: sql`excluded.result_code`,
    startPresent: sql`excluded.start_present`,
    penaltyCode: sql`excluded.penalty_code`,
    penaltyOverride: sql`excluded.penalty_override`,
    redressMethod: sql`excluded.redress_method`,
    redressExcludeRaces: sql`excluded.redress_exclude_races`,
    redressIncludeRaces: sql`excluded.redress_include_races`,
    redressIncludeAllLater: sql`excluded.redress_include_all_later`,
    redressPoints: sql`excluded.redress_points`,
  };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createRepos(ctx: RepoCtx) {
  return {
    series: new PostgresSeriesRepository(ctx),
    fleets: new PostgresFleetRepository(ctx),
    competitors: new PostgresCompetitorRepository(ctx),
    races: new PostgresRaceRepository(ctx),
    raceStarts: new PostgresRaceStartRepository(ctx),
    finishes: new PostgresFinishRepository(ctx),
  };
}
