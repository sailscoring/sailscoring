import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { DEFAULT_SUBDIVISION_LABEL } from './competitor-fields';
import { decryptCredential, encryptCredential } from './crypto';
import { getDb, type SailScoringDb } from './db/client';
import * as schema from './db/schema';
import { ECHO_DEFAULT_ALPHA } from './scoring';
import {
  ConflictError,
  type CompetitorRepository,
  type FinishRepository,
  type FleetRepository,
  type FtpServerRepository,
  type RaceRepository,
  type RaceStartRepository,
  type SaveOpts,
  type SeriesRepository,
} from './repository';
import type {
  Competitor,
  Fleet,
  Finish,
  FtpServer,
  NhcProfile,
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
 * - Saves bump `version`. When `opts.expectedVersion` is supplied, the
 *   update is a compare-and-swap: it succeeds only if the row in the
 *   database is still at that version, otherwise `ConflictError` is
 *   thrown and the route handler returns 409. When omitted, the upsert
 *   is unconditional — used for first-write (insert) and authoritative
 *   import paths.
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
    venueUrl: row.venueUrl,
    eventUrl: row.eventUrl,
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
    ftpPaths: row.ftpPaths,
    includeJsonExport: row.includeJsonExport,
    publishRatingCalculations: row.publishRatingCalculations,
    showPerRaceRatingsInSummary: row.showPerRaceRatingsInSummary,
    enabledCompetitorFields: row.enabledCompetitorFields,
    primaryPersonLabel: row.primaryPersonLabel,
    subdivisionLabel: row.subdivisionLabel,
    categoryId: row.categoryId,
    archived: row.archived,
    version: row.version,
  };
}

function fleetRowToType(row: FleetRow): Fleet {
  return {
    id: row.id,
    seriesId: row.seriesId,
    name: row.name,
    displayOrder: row.displayOrder,
    scoringSystem: row.scoringSystem as Fleet['scoringSystem'],
    ...(row.echoAlpha != null ? { echoAlpha: row.echoAlpha } : {}),
    ...(row.nhcProfile != null ? { nhcProfile: row.nhcProfile } : {}),
    version: row.version,
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
    ...(row.nationality ? { nationality: row.nationality } : {}),
    gender: row.gender as Competitor['gender'],
    age: row.age,
    ...(row.subdivision ? { subdivision: row.subdivision } : {}),
    createdAt: row.createdAt.getTime(),
    ...(row.ircTcc != null ? { ircTcc: row.ircTcc } : {}),
    ...(row.pyNumber != null ? { pyNumber: row.pyNumber } : {}),
    ...(row.nhcStartingTcf != null ? { nhcStartingTcf: row.nhcStartingTcf } : {}),
    ...(row.echoStartingTcf != null ? { echoStartingTcf: row.echoStartingTcf } : {}),
    version: row.version,
  };
}

function raceRowToType(row: RaceRow): Race {
  return {
    id: row.id,
    seriesId: row.seriesId,
    raceNumber: row.raceNumber,
    date: row.date,
    createdAt: row.createdAt.getTime(),
    version: row.version,
  };
}

function raceStartRowToType(row: RaceStartRow): RaceStart {
  return {
    id: row.id,
    raceId: row.raceId,
    fleetIds: row.fleetIds,
    startTime: row.startTime,
    version: row.version,
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
    tiedWithPrevious: row.tiedWithPrevious,
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
    version: row.version,
  };
}

// ─── Concurrency helper ─────────────────────────────────────────────────────

type Versionable =
  | typeof schema.series
  | typeof schema.fleets
  | typeof schema.competitors
  | typeof schema.races
  | typeof schema.ftpServers;

type RaceScopedVersionable = typeof schema.raceStarts | typeof schema.finishes;

/**
 * Build a `ConflictError` carrying the current `version` from the database,
 * so the route handler can pass it back in the 409 detail. The query
 * repeats the tenancy filter so a row that exists in a different workspace
 * (which shouldn't happen — UUIDs are unique) does not leak its version.
 *
 * Two overloads — one for top-level rows that carry `workspace_id`, one for
 * race-scoped child rows where tenancy is enforced via the parent race's
 * `workspace_id`.
 */
async function buildConflictError(
  db: SailScoringDb,
  table: Versionable,
  id: string,
  workspaceId: string,
  expectedVersion: number,
): Promise<ConflictError>;
async function buildConflictError(
  db: SailScoringDb,
  table: RaceScopedVersionable,
  id: string,
  workspaceId: string,
  expectedVersion: number,
  via: 'parent-race',
): Promise<ConflictError>;
async function buildConflictError(
  db: SailScoringDb,
  table: Versionable | RaceScopedVersionable,
  id: string,
  workspaceId: string,
  expectedVersion: number,
  via?: 'parent-race',
): Promise<ConflictError> {
  let row:
    | { version: number; updatedAt: Date; updatedBy: string | null }
    | undefined;
  if (via === 'parent-race') {
    const t = table as RaceScopedVersionable;
    const [r] = await db
      .select({
        version: t.version,
        updatedAt: t.updatedAt,
        updatedBy: t.updatedBy,
      })
      .from(t)
      .innerJoin(schema.races, eq(t.raceId, schema.races.id))
      .where(
        and(
          eq(t.id, id),
          eq(schema.races.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    row = r;
  } else {
    const t = table as Versionable;
    const [r] = await db
      .select({
        version: t.version,
        updatedAt: t.updatedAt,
        updatedBy: t.updatedBy,
      })
      .from(t)
      .where(
        and(
          eq(t.id, id),
          eq(t.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    row = r;
  }

  let actor: { id: string; email?: string; displayName?: string } | undefined;
  if (row?.updatedBy) {
    const [u] = await db
      .select({ id: schema.user.id, email: schema.user.email, name: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.id, row.updatedBy))
      .limit(1);
    if (u) {
      actor = {
        id: u.id,
        email: u.email,
        displayName: u.name && u.name.trim().length > 0 ? u.name : undefined,
      };
    } else {
      // Edge case: actor user has been deleted since the row was last
      // written. Surface the id so the dialog still has *something*
      // beyond "elsewhere"; the row-conflict dialog falls back gracefully.
      actor = { id: row.updatedBy };
    }
  }

  return new ConflictError({
    expectedVersion,
    currentVersion: row?.version,
    updatedAt: row?.updatedAt?.toISOString(),
    actor,
  });
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

  async save(s: Series, opts?: SaveOpts): Promise<Series> {
    const updatedBy = opts?.updatedBy ?? null;
    const insertValues = {
      id: s.id,
      workspaceId: this.workspaceId,
      name: s.name,
      venue: s.venue,
      startDate: s.startDate,
      endDate: s.endDate,
      venueLogoUrl: s.venueLogoUrl,
      eventLogoUrl: s.eventLogoUrl,
      venueUrl: s.venueUrl,
      eventUrl: s.eventUrl,
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
      ftpPaths: s.ftpPaths,
      includeJsonExport: s.includeJsonExport,
      publishRatingCalculations: s.publishRatingCalculations ?? true,
      showPerRaceRatingsInSummary: s.showPerRaceRatingsInSummary ?? true,
      enabledCompetitorFields: s.enabledCompetitorFields,
      primaryPersonLabel: s.primaryPersonLabel,
      subdivisionLabel: s.subdivisionLabel ?? DEFAULT_SUBDIVISION_LABEL,
      categoryId: s.categoryId ?? null,
      archived: s.archived ?? false,
      updatedBy,
    };
    const updateSet = {
      name: insertValues.name,
      venue: insertValues.venue,
      startDate: insertValues.startDate,
      endDate: insertValues.endDate,
      venueLogoUrl: insertValues.venueLogoUrl,
      eventLogoUrl: insertValues.eventLogoUrl,
      venueUrl: insertValues.venueUrl,
      eventUrl: insertValues.eventUrl,
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
      ftpPaths: insertValues.ftpPaths,
      includeJsonExport: insertValues.includeJsonExport,
      publishRatingCalculations: insertValues.publishRatingCalculations,
      showPerRaceRatingsInSummary: insertValues.showPerRaceRatingsInSummary,
      enabledCompetitorFields: insertValues.enabledCompetitorFields,
      primaryPersonLabel: insertValues.primaryPersonLabel,
      subdivisionLabel: insertValues.subdivisionLabel,
      categoryId: insertValues.categoryId,
      archived: insertValues.archived,
      updatedBy,
    };
    if (opts?.expectedVersion !== undefined) {
      const [row] = await this.db
        .update(schema.series)
        .set({
          ...updateSet,
          version: sql`${schema.series.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(schema.series.id, s.id),
            eq(schema.series.workspaceId, this.workspaceId),
            eq(schema.series.version, opts.expectedVersion),
          ),
        )
        .returning();
      if (!row) {
        throw await buildConflictError(
          this.db,
          schema.series,
          s.id,
          this.workspaceId,
          opts.expectedVersion,
        );
      }
      return seriesRowToType(row);
    }
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
          ...updateSet,
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

  /**
   * Bumps `lastModifiedAt` + `version` without touching any payload field.
   * `updatedBy` is not stamped here because `touch` is the file-tracking
   * heartbeat — it isn't a user edit. Phase 10's activity log will treat
   * touches separately from real writes for the same reason.
   */
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

  async save(fleet: Fleet, opts?: SaveOpts): Promise<Fleet> {
    const updatedBy = opts?.updatedBy ?? null;
    const values = {
      id: fleet.id,
      seriesId: fleet.seriesId,
      workspaceId: this.workspaceId,
      name: fleet.name,
      displayOrder: fleet.displayOrder,
      scoringSystem: fleet.scoringSystem,
      echoAlpha: fleet.echoAlpha ?? null,
      nhcProfile: fleet.nhcProfile ?? null,
      updatedBy,
    };
    const updateSet = {
      name: values.name,
      displayOrder: values.displayOrder,
      scoringSystem: values.scoringSystem,
      echoAlpha: values.echoAlpha,
      nhcProfile: values.nhcProfile,
      updatedBy,
    };
    if (opts?.expectedVersion !== undefined) {
      const [row] = await this.db
        .update(schema.fleets)
        .set({
          ...updateSet,
          version: sql`${schema.fleets.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(schema.fleets.id, fleet.id),
            eq(schema.fleets.workspaceId, this.workspaceId),
            eq(schema.fleets.version, opts.expectedVersion),
          ),
        )
        .returning();
      if (!row) {
        throw await buildConflictError(
          this.db,
          schema.fleets,
          fleet.id,
          this.workspaceId,
          opts.expectedVersion,
        );
      }
      return fleetRowToType(row);
    }
    const [row] = await this.db
      .insert(schema.fleets)
      .values(values)
      .onConflictDoUpdate({
        target: schema.fleets.id,
        targetWhere: eq(schema.fleets.workspaceId, this.workspaceId),
        set: {
          ...updateSet,
          version: sql`${schema.fleets.version} + 1`,
          updatedAt: sql`now()`,
        },
      })
      .returning();
    return fleetRowToType(row);
  }

  async saveMany(fleets: Fleet[], opts?: SaveOpts): Promise<void> {
    if (fleets.length === 0) return;
    const updatedBy = opts?.updatedBy ?? null;
    const seriesIds = [...new Set(fleets.map((f) => f.seriesId))];
    const owned = await filterSeriesIdsByWorkspace(
      this.db,
      this.workspaceId,
      seriesIds,
    );
    if (owned.length !== seriesIds.length) {
      throw new Error('some series not in workspace');
    }
    const values = fleets.map((f) => ({
      id: f.id,
      seriesId: f.seriesId,
      workspaceId: this.workspaceId,
      name: f.name,
      displayOrder: f.displayOrder,
      scoringSystem: f.scoringSystem,
      echoAlpha: f.echoAlpha ?? null,
      nhcProfile: f.nhcProfile ?? null,
      updatedBy,
    }));
    await this.db
      .insert(schema.fleets)
      .values(values)
      .onConflictDoUpdate({
        target: schema.fleets.id,
        targetWhere: eq(schema.fleets.workspaceId, this.workspaceId),
        set: {
          name: sql`excluded.name`,
          displayOrder: sql`excluded.display_order`,
          scoringSystem: sql`excluded.scoring_system`,
          echoAlpha: sql`excluded.echo_alpha`,
          nhcProfile: sql`excluded.nhc_profile`,
          updatedBy: sql`excluded.updated_by`,
          version: sql`${schema.fleets.version} + 1`,
          updatedAt: sql`now()`,
        },
      });
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

  /**
   * Find-or-create a fleet by case-insensitive name, atomically.
   *
   * Wraps the lookup-then-insert in a transaction guarded by
   * `pg_advisory_xact_lock`, keyed on the series id, so concurrent
   * ensureFleet calls for the same series serialise rather than racing
   * to insert duplicates.
   *
   * `scoringSystem` and the alpha defaults apply only when *creating*
   * a new fleet — never mutates an existing fleet. Blank name → "Default".
   */
  async ensureFleet(
    seriesId: string,
    name: string,
    options?: {
      scoringSystem?: Fleet['scoringSystem'];
      echoAlpha?: number;
      nhcProfile?: NhcProfile;
      updatedBy?: string;
    },
  ): Promise<string> {
    const fleetName = name.trim() || 'Default';
    const scoringSystem = options?.scoringSystem ?? 'scratch';
    return this.db.transaction(async (tx) => {
      // Verify the parent series belongs to this workspace before holding a
      // lock. A miss here means a tenancy violation, not a missing series —
      // surface it as such.
      const [seriesRow] = await tx
        .select({ id: schema.series.id })
        .from(schema.series)
        .where(
          and(
            eq(schema.series.id, seriesId),
            eq(schema.series.workspaceId, this.workspaceId),
          ),
        )
        .limit(1);
      if (!seriesRow) {
        throw new Error(`series ${seriesId} not in workspace`);
      }

      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`ensure-fleet:${seriesId}`}, 0))`,
      );

      const [existing] = await tx
        .select()
        .from(schema.fleets)
        .where(
          and(
            eq(schema.fleets.seriesId, seriesId),
            eq(schema.fleets.workspaceId, this.workspaceId),
            sql`lower(${schema.fleets.name}) = lower(${fleetName})`,
          ),
        )
        .limit(1);
      if (existing) return existing.id;

      const [orderRow] = await tx
        .select({
          max: sql<number>`coalesce(max(${schema.fleets.displayOrder}), -1)`,
        })
        .from(schema.fleets)
        .where(
          and(
            eq(schema.fleets.seriesId, seriesId),
            eq(schema.fleets.workspaceId, this.workspaceId),
          ),
        );
      const displayOrder = (orderRow?.max ?? -1) + 1;

      const id = crypto.randomUUID();
      await tx.insert(schema.fleets).values({
        id,
        seriesId,
        workspaceId: this.workspaceId,
        name: fleetName,
        displayOrder,
        scoringSystem,
        echoAlpha:
          scoringSystem === 'echo'
            ? (options?.echoAlpha ?? ECHO_DEFAULT_ALPHA)
            : null,
        nhcProfile:
          scoringSystem === 'nhc' && options?.nhcProfile
            ? options.nhcProfile
            : null,
        updatedBy: options?.updatedBy ?? null,
      });
      return id;
    });
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

  async save(c: Competitor, opts?: SaveOpts): Promise<Competitor> {
    const updatedBy = opts?.updatedBy ?? null;
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
      nationality: c.nationality ?? null,
      gender: c.gender,
      age: c.age,
      subdivision: c.subdivision ?? null,
      createdAt: new Date(c.createdAt),
      ircTcc: c.ircTcc ?? null,
      pyNumber: c.pyNumber ?? null,
      nhcStartingTcf: c.nhcStartingTcf ?? null,
      echoStartingTcf: c.echoStartingTcf ?? null,
      updatedBy,
    };
    const updateSet = {
      fleetIds: values.fleetIds,
      sailNumber: values.sailNumber,
      boatName: values.boatName,
      boatClass: values.boatClass,
      name: values.name,
      owner: values.owner,
      helm: values.helm,
      crewName: values.crewName,
      club: values.club,
      nationality: values.nationality,
      gender: values.gender,
      age: values.age,
      subdivision: values.subdivision,
      ircTcc: values.ircTcc,
      pyNumber: values.pyNumber,
      nhcStartingTcf: values.nhcStartingTcf,
      echoStartingTcf: values.echoStartingTcf,
      updatedBy,
    };
    if (opts?.expectedVersion !== undefined) {
      const [row] = await this.db
        .update(schema.competitors)
        .set({
          ...updateSet,
          version: sql`${schema.competitors.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(schema.competitors.id, c.id),
            eq(schema.competitors.workspaceId, this.workspaceId),
            eq(schema.competitors.version, opts.expectedVersion),
          ),
        )
        .returning();
      if (!row) {
        throw await buildConflictError(
          this.db,
          schema.competitors,
          c.id,
          this.workspaceId,
          opts.expectedVersion,
        );
      }
      return competitorRowToType(row);
    }
    const [row] = await this.db
      .insert(schema.competitors)
      .values(values)
      .onConflictDoUpdate({
        target: schema.competitors.id,
        targetWhere: eq(schema.competitors.workspaceId, this.workspaceId),
        set: {
          ...updateSet,
          version: sql`${schema.competitors.version} + 1`,
          updatedAt: sql`now()`,
        },
      })
      .returning();
    return competitorRowToType(row);
  }

  async saveMany(competitors: Competitor[], opts?: SaveOpts): Promise<void> {
    if (competitors.length === 0) return;
    const updatedBy = opts?.updatedBy ?? null;
    const seriesIds = [...new Set(competitors.map((c) => c.seriesId))];
    const owned = await filterSeriesIdsByWorkspace(
      this.db,
      this.workspaceId,
      seriesIds,
    );
    if (owned.length !== seriesIds.length) {
      throw new Error('some series not in workspace');
    }
    const values = competitors.map((c) => ({
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
      nationality: c.nationality ?? null,
      gender: c.gender,
      age: c.age,
      subdivision: c.subdivision ?? null,
      createdAt: new Date(c.createdAt),
      ircTcc: c.ircTcc ?? null,
      pyNumber: c.pyNumber ?? null,
      nhcStartingTcf: c.nhcStartingTcf ?? null,
      echoStartingTcf: c.echoStartingTcf ?? null,
      updatedBy,
    }));
    await this.db
      .insert(schema.competitors)
      .values(values)
      .onConflictDoUpdate({
        target: schema.competitors.id,
        targetWhere: eq(schema.competitors.workspaceId, this.workspaceId),
        set: {
          fleetIds: sql`excluded.fleet_ids`,
          sailNumber: sql`excluded.sail_number`,
          boatName: sql`excluded.boat_name`,
          boatClass: sql`excluded.boat_class`,
          name: sql`excluded.name`,
          owner: sql`excluded.owner`,
          helm: sql`excluded.helm`,
          crewName: sql`excluded.crew_name`,
          club: sql`excluded.club`,
          nationality: sql`excluded.nationality`,
          gender: sql`excluded.gender`,
          age: sql`excluded.age`,
          subdivision: sql`excluded.subdivision`,
          ircTcc: sql`excluded.irc_tcc`,
          pyNumber: sql`excluded.py_number`,
          nhcStartingTcf: sql`excluded.nhc_starting_tcf`,
          echoStartingTcf: sql`excluded.echo_starting_tcf`,
          updatedBy: sql`excluded.updated_by`,
          version: sql`${schema.competitors.version} + 1`,
          updatedAt: sql`now()`,
        },
      });
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

  async save(r: Race, opts?: SaveOpts): Promise<Race> {
    const updatedBy = opts?.updatedBy ?? null;
    const values = {
      id: r.id,
      seriesId: r.seriesId,
      workspaceId: this.workspaceId,
      raceNumber: r.raceNumber,
      date: r.date,
      createdAt: new Date(r.createdAt),
      updatedBy,
    };
    const updateSet = {
      raceNumber: values.raceNumber,
      date: values.date,
      updatedBy,
    };
    if (opts?.expectedVersion !== undefined) {
      const [row] = await this.db
        .update(schema.races)
        .set({
          ...updateSet,
          version: sql`${schema.races.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(schema.races.id, r.id),
            eq(schema.races.workspaceId, this.workspaceId),
            eq(schema.races.version, opts.expectedVersion),
          ),
        )
        .returning();
      if (!row) {
        throw await buildConflictError(
          this.db,
          schema.races,
          r.id,
          this.workspaceId,
          opts.expectedVersion,
        );
      }
      return raceRowToType(row);
    }
    const [row] = await this.db
      .insert(schema.races)
      .values(values)
      .onConflictDoUpdate({
        target: schema.races.id,
        targetWhere: eq(schema.races.workspaceId, this.workspaceId),
        set: {
          ...updateSet,
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

async function filterSeriesIdsByWorkspace(
  db: SailScoringDb,
  workspaceId: string,
  seriesIds: string[],
): Promise<string[]> {
  if (seriesIds.length === 0) return [];
  const rows = await db
    .select({ id: schema.series.id })
    .from(schema.series)
    .where(
      and(
        inArray(schema.series.id, seriesIds),
        eq(schema.series.workspaceId, workspaceId),
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

  async save(s: RaceStart, opts?: SaveOpts): Promise<RaceStart> {
    if (!(await isRaceInWorkspace(this.db, this.workspaceId, s.raceId))) {
      throw new Error(`race ${s.raceId} not in workspace`);
    }
    const updatedBy = opts?.updatedBy ?? null;
    const values = {
      id: s.id,
      raceId: s.raceId,
      fleetIds: s.fleetIds,
      startTime: s.startTime,
      updatedBy,
    };
    const updateSet = {
      fleetIds: values.fleetIds,
      startTime: values.startTime,
      updatedBy,
    };
    if (opts?.expectedVersion !== undefined) {
      const [row] = await this.db
        .update(schema.raceStarts)
        .set({
          ...updateSet,
          version: sql`${schema.raceStarts.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(schema.raceStarts.id, s.id),
            eq(schema.raceStarts.raceId, s.raceId),
            eq(schema.raceStarts.version, opts.expectedVersion),
          ),
        )
        .returning();
      if (!row) {
        throw await buildConflictError(
          this.db,
          schema.raceStarts,
          s.id,
          this.workspaceId,
          opts.expectedVersion,
          'parent-race',
        );
      }
      return raceStartRowToType(row);
    }
    const [row] = await this.db
      .insert(schema.raceStarts)
      .values(values)
      .onConflictDoUpdate({
        target: schema.raceStarts.id,
        set: {
          ...updateSet,
          version: sql`${schema.raceStarts.version} + 1`,
          updatedAt: sql`now()`,
        },
      })
      .returning();
    return raceStartRowToType(row);
  }

  async saveMany(starts: RaceStart[], opts?: SaveOpts): Promise<void> {
    if (starts.length === 0) return;
    const updatedBy = opts?.updatedBy ?? null;
    // Verify every parent race is in this workspace before writing anything.
    const raceIds = [...new Set(starts.map((s) => s.raceId))];
    const owned = await filterRaceIdsByWorkspace(
      this.db,
      this.workspaceId,
      raceIds,
    );
    if (owned.length !== raceIds.length) {
      throw new Error('some races not in workspace');
    }
    const values = starts.map((s) => ({
      id: s.id,
      raceId: s.raceId,
      fleetIds: s.fleetIds,
      startTime: s.startTime,
      updatedBy,
    }));
    await this.db
      .insert(schema.raceStarts)
      .values(values)
      .onConflictDoUpdate({
        target: schema.raceStarts.id,
        set: {
          fleetIds: sql`excluded.fleet_ids`,
          startTime: sql`excluded.start_time`,
          updatedBy: sql`excluded.updated_by`,
          version: sql`${schema.raceStarts.version} + 1`,
          updatedAt: sql`now()`,
        },
      });
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

  async save(f: Finish, opts?: SaveOpts): Promise<Finish> {
    if (!(await isRaceInWorkspace(this.db, this.workspaceId, f.raceId))) {
      throw new Error(`race ${f.raceId} not in workspace`);
    }
    const updatedBy = opts?.updatedBy ?? null;
    const values = { ...finishToRow(f), updatedBy };
    if (opts?.expectedVersion !== undefined) {
      const [row] = await this.db
        .update(schema.finishes)
        .set({
          ...finishUpdateSet(values),
          updatedBy,
          version: sql`${schema.finishes.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(schema.finishes.id, f.id),
            eq(schema.finishes.raceId, f.raceId),
            eq(schema.finishes.version, opts.expectedVersion),
          ),
        )
        .returning();
      if (!row) {
        throw await buildConflictError(
          this.db,
          schema.finishes,
          f.id,
          this.workspaceId,
          opts.expectedVersion,
          'parent-race',
        );
      }
      return finishRowToType(row);
    }
    const [row] = await this.db
      .insert(schema.finishes)
      .values(values)
      .onConflictDoUpdate({
        target: schema.finishes.id,
        set: {
          ...finishUpdateSet(values),
          updatedBy,
          version: sql`${schema.finishes.version} + 1`,
          updatedAt: sql`now()`,
        },
      })
      .returning();
    return finishRowToType(row);
  }

  async saveMany(finishes: Finish[], opts?: SaveOpts): Promise<void> {
    if (finishes.length === 0) return;
    const updatedBy = opts?.updatedBy ?? null;
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
    const values = finishes.map((f) => ({ ...finishToRow(f), updatedBy }));
    await this.db
      .insert(schema.finishes)
      .values(values)
      .onConflictDoUpdate({
        target: schema.finishes.id,
        set: {
          ...finishUpdateSetExcluded(),
          updatedBy: sql`excluded.updated_by`,
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
    tiedWithPrevious: f.tiedWithPrevious,
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
    tiedWithPrevious: values.tiedWithPrevious,
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
    tiedWithPrevious: sql`excluded.tied_with_previous`,
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

// ─── FTP servers ─────────────────────────────────────────────────────────────

export class PostgresFtpServerRepository implements FtpServerRepository {
  private readonly db: SailScoringDb;
  private readonly workspaceId: string;

  constructor(ctx: RepoCtx) {
    this.db = ctx.db ?? getDb();
    this.workspaceId = ctx.workspaceId;
  }

  async list(): Promise<FtpServer[]> {
    const rows = await this.db
      .select()
      .from(schema.ftpServers)
      .where(eq(schema.ftpServers.workspaceId, this.workspaceId))
      .orderBy(schema.ftpServers.createdAt);
    return rows.map((row) => ({
      id: row.id,
      host: row.host,
      port: row.port,
      username: row.username,
      password: decryptCredential(row.encryptedPassword),
      ftps: row.ftps,
      version: row.version,
    }));
  }

  async save(server: FtpServer, opts?: SaveOpts): Promise<FtpServer> {
    const updatedBy = opts?.updatedBy ?? null;
    const values = {
      id: server.id,
      workspaceId: this.workspaceId,
      host: server.host,
      port: server.port,
      username: server.username,
      encryptedPassword: encryptCredential(server.password),
      ftps: server.ftps,
      updatedBy,
    };
    const updateSet = {
      host: values.host,
      port: values.port,
      username: values.username,
      encryptedPassword: values.encryptedPassword,
      ftps: values.ftps,
      updatedBy,
    };
    if (opts?.expectedVersion !== undefined) {
      const [row] = await this.db
        .update(schema.ftpServers)
        .set({
          ...updateSet,
          version: sql`${schema.ftpServers.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(schema.ftpServers.id, server.id),
            eq(schema.ftpServers.workspaceId, this.workspaceId),
            eq(schema.ftpServers.version, opts.expectedVersion),
          ),
        )
        .returning();
      if (!row) {
        throw await buildConflictError(
          this.db,
          schema.ftpServers,
          server.id,
          this.workspaceId,
          opts.expectedVersion,
        );
      }
      return { ...server, version: row.version };
    }
    const [row] = await this.db
      .insert(schema.ftpServers)
      .values(values)
      .onConflictDoUpdate({
        target: schema.ftpServers.id,
        targetWhere: eq(schema.ftpServers.workspaceId, this.workspaceId),
        set: {
          ...updateSet,
          version: sql`${schema.ftpServers.version} + 1`,
          updatedAt: sql`now()`,
        },
      })
      .returning();
    return { ...server, version: row.version };
  }

  async delete(id: string): Promise<void> {
    await this.db
      .delete(schema.ftpServers)
      .where(
        and(
          eq(schema.ftpServers.id, id),
          eq(schema.ftpServers.workspaceId, this.workspaceId),
        ),
      );
  }
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
    ftpServers: new PostgresFtpServerRepository(ctx),
  };
}
