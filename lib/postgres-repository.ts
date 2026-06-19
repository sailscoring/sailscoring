import 'server-only';
import { and, eq, getTableColumns, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgInsertValue, PgUpdateSetSource } from 'drizzle-orm/pg-core';

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
  type RaceRatingOverrideRepository,
  type SaveOpts,
  type SeriesRepository,
  type SubSeriesRepository,
} from './repository';
import type { SeriesFileRepos } from './series-file';
import type {
  Category,
  Competitor,
  Fleet,
  Finish,
  FtpServer,
  Logo,
  LogoClass,
  LogoDefaults,
  NhcProfile,
  PenaltyCode,
  Race,
  RaceStart,
  RaceRatingOverride,
  ResultCode,
  Series,
  SubSeries,
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
type SubSeriesRow = typeof schema.subSeries.$inferSelect;
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
    lastSavedAt: row.lastSavedAt ? row.lastSavedAt.getTime() : null,
    lastModifiedAt: row.lastModifiedAt.getTime(),
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
    source: row.source ?? undefined,
    previousSeriesId: row.previousSeriesId,
    displayOrder: row.displayOrder,
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
    ...(row.vprsTcc != null ? { vprsTcc: row.vprsTcc } : {}),
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

function subSeriesRowToType(row: SubSeriesRow, raceIds: string[]): SubSeries {
  return {
    id: row.id,
    seriesId: row.seriesId,
    name: row.name,
    displayOrder: row.displayOrder,
    raceIds,
    startingHandicapSource: row.startingHandicapSource as SubSeries['startingHandicapSource'],
    continueFromSubSeriesId: row.continueFromSubSeriesId,
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

type RaceRatingOverrideRow = typeof schema.raceRatingOverrides.$inferSelect;

function raceRatingOverrideRowToType(row: RaceRatingOverrideRow): RaceRatingOverride {
  return {
    id: row.id,
    raceId: row.raceId,
    competitorId: row.competitorId,
    field: row.field as RaceRatingOverride['field'],
    value: row.value,
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
    ...(row.penaltyOverrideByFleet != null ? { penaltyOverrideByFleet: row.penaltyOverrideByFleet } : {}),
    redressMethod: row.redressMethod as Finish['redressMethod'],
    redressExcludeRaces: row.redressExcludeRaces,
    redressIncludeRaces: row.redressIncludeRaces,
    redressIncludeAllLater: row.redressIncludeAllLater,
    redressPoints: row.redressPoints,
    ...(row.redressPointsByFleet != null ? { redressPointsByFleet: row.redressPointsByFleet } : {}),
    version: row.version,
  };
}

// ─── Concurrency helper ─────────────────────────────────────────────────────

type Versionable =
  | typeof schema.series
  | typeof schema.fleets
  | typeof schema.competitors
  | typeof schema.races
  | typeof schema.subSeries
  | typeof schema.ftpServers;

type RaceScopedVersionable =
  | typeof schema.raceStarts
  | typeof schema.finishes
  | typeof schema.raceRatingOverrides;

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

// ─── Versioned save helpers ─────────────────────────────────────────────────

type VersionedTable = Versionable | RaceScopedVersionable;

/**
 * Tenancy strategy for a versioned write:
 * - `workspace`: the table carries `workspace_id`; the CAS update filters on
 *   it and the upsert gets a `targetWhere` guard so a cross-workspace id
 *   collision (not supposed to happen — UUIDs are unique) can never update a
 *   row in another workspace.
 * - `parent-race`: race-scoped child rows whose tenancy is enforced by the
 *   caller's pre-check against the parent race; the CAS update filters on
 *   `race_id` and the upsert has no guard.
 */
type SaveTenancy = { kind: 'workspace' } | { kind: 'parent-race'; raceId: string };

interface VersionedSaveSpec<TTable extends VersionedTable> {
  db: SailScoringDb;
  table: TTable;
  workspaceId: string;
  /** Full row for the insert side of the upsert. `updatedBy` is stamped here,
   *  not by the caller's row builder. */
  values: PgInsertValue<TTable>;
  /**
   * The columns a save may change on an existing row. The CAS/upsert update
   * set and the bulk `excluded.*` set are all derived from this one list, so
   * a new field needs adding exactly once. Immutable columns (`id`,
   * `workspaceId`, `seriesId`, `createdAt`, …) stay off the list.
   */
  updateColumns: readonly Extract<keyof TTable['$inferInsert'], string>[];
  tenancy: SaveTenancy;
  opts?: SaveOpts;
}

function buildUpdateSet<TTable extends VersionedTable>(
  spec: Pick<VersionedSaveSpec<TTable>, 'table' | 'updateColumns'>,
  values: Record<string, unknown>,
  updatedBy: string | null,
): PgUpdateSetSource<TTable> {
  const set: Record<string, unknown> = { updatedBy };
  for (const col of spec.updateColumns) {
    set[col] = values[col];
  }
  return {
    ...set,
    version: sql`${spec.table.version} + 1`,
    updatedAt: sql`now()`,
  } as PgUpdateSetSource<TTable>;
}

/** `excluded.<column>` reference for the bulk-upsert path. ON CONFLICT DO
 *  UPDATE in Postgres can pick values from the `excluded` pseudo-row (the row
 *  that would have been inserted), which lets one statement upsert many rows.
 *  The DB column name comes from the Drizzle column metadata, so there are no
 *  hand-written snake_case strings to drift. */
function excludedColumn(table: VersionedTable, col: string): SQL {
  const columns: Record<string, { name: string } | undefined> =
    getTableColumns(table);
  const column = columns[col];
  if (!column) {
    throw new Error(`unknown column ${col} on table`);
  }
  return sql`excluded.${sql.identifier(column.name)}`;
}

/**
 * The save pattern shared by every versioned repository:
 * - `opts.expectedVersion` set → compare-and-swap update on
 *   id + tenancy + version; no row back means a concurrent write won, so
 *   throw the `ConflictError` (→ 409) with the current version attached.
 * - otherwise → unconditional upsert (first write or authoritative import),
 *   bumping `version` and `updatedAt` when the row already exists.
 */
async function versionedSave<TTable extends VersionedTable, T>(
  spec: VersionedSaveSpec<TTable> & {
    id: string;
    rowToType: (row: TTable['$inferSelect']) => T;
  },
): Promise<T> {
  const { db, table, workspaceId, id, tenancy, opts } = spec;
  const updatedBy = opts?.updatedBy ?? null;
  const values = { ...(spec.values as object), updatedBy } as PgInsertValue<TTable>;
  const updateSet = buildUpdateSet(spec, values as Record<string, unknown>, updatedBy);

  if (opts?.expectedVersion !== undefined) {
    const tenancyFilter =
      tenancy.kind === 'workspace'
        ? eq((table as Versionable).workspaceId, workspaceId)
        : eq((table as RaceScopedVersionable).raceId, tenancy.raceId);
    const [row] = await db
      .update(table)
      .set(updateSet)
      .where(
        and(
          eq(table.id, id),
          tenancyFilter,
          eq(table.version, opts.expectedVersion),
        ),
      )
      .returning();
    if (!row) {
      throw tenancy.kind === 'workspace'
        ? await buildConflictError(
            db,
            table as Versionable,
            id,
            workspaceId,
            opts.expectedVersion,
          )
        : await buildConflictError(
            db,
            table as RaceScopedVersionable,
            id,
            workspaceId,
            opts.expectedVersion,
            'parent-race',
          );
    }
    return spec.rowToType(row as TTable['$inferSelect']);
  }

  const [row] = await db
    .insert(table)
    .values(values)
    .onConflictDoUpdate({
      target: table.id,
      ...(tenancy.kind === 'workspace'
        ? { targetWhere: eq((table as Versionable).workspaceId, workspaceId) }
        : {}),
      set: updateSet,
    })
    .returning();
  return spec.rowToType(row as TTable['$inferSelect']);
}

/**
 * Bulk counterpart of `versionedSave`: one multi-row upsert whose conflict
 * set reads from `excluded.*`, derived from the same `updateColumns` list.
 * Callers do their workspace-ownership pre-check (via
 * `filterSeriesIdsByWorkspace` / `filterRaceIdsByWorkspace`) before calling.
 */
async function versionedSaveMany<TTable extends VersionedTable>(
  spec: Omit<VersionedSaveSpec<TTable>, 'values' | 'tenancy'> & {
    values: PgInsertValue<TTable>[];
    tenancy: SaveTenancy['kind'];
  },
): Promise<void> {
  const { db, table, workspaceId } = spec;
  const updatedBy = spec.opts?.updatedBy ?? null;
  const values = spec.values.map(
    (v) => ({ ...(v as object), updatedBy }) as PgInsertValue<TTable>,
  );
  const excludedSet: Record<string, unknown> = {
    updatedBy: excludedColumn(table, 'updatedBy'),
  };
  for (const col of spec.updateColumns) {
    excludedSet[col] = excludedColumn(table, col);
  }
  await db
    .insert(table)
    .values(values)
    .onConflictDoUpdate({
      target: table.id,
      ...(spec.tenancy === 'workspace'
        ? { targetWhere: eq((table as Versionable).workspaceId, workspaceId) }
        : {}),
      set: {
        ...excludedSet,
        version: sql`${table.version} + 1`,
        updatedAt: sql`now()`,
      } as PgUpdateSetSource<TTable>,
    });
}

// ─── Series ───────────────────────────────────────────────────────────────────

function seriesToRow(s: Series, workspaceId: string) {
  return {
    id: s.id,
    workspaceId,
    name: s.name,
    venue: s.venue,
    startDate: s.startDate,
    endDate: s.endDate,
    venueLogoUrl: s.venueLogoUrl,
    eventLogoUrl: s.eventLogoUrl,
    venueUrl: s.venueUrl,
    eventUrl: s.eventUrl,
    createdAt: new Date(s.createdAt),
    lastSavedAt: s.lastSavedAt != null ? new Date(s.lastSavedAt) : null,
    lastModifiedAt: new Date(s.lastModifiedAt),
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
    source: s.source ?? null,
    // New series append to the end of the active list. Computed
    // server-side so the client needn't know the current max; display_order
    // is not in seriesUpdateColumns, so updates preserve it.
    displayOrder: sql<number>`(select coalesce(max(${schema.series.displayOrder}) + 1, 0) from ${schema.series} where ${schema.series.workspaceId} = ${workspaceId})`,
  };
}

const seriesUpdateColumns = [
  'name', 'venue', 'startDate', 'endDate',
  'venueLogoUrl', 'eventLogoUrl', 'venueUrl', 'eventUrl',
  'lastSavedAt', 'lastModifiedAt',
  'scoringMode', 'defaultStartSequence', 'discardThresholds', 'dnfScoring',
  'ftpHost', 'ftpPath', 'ftpPaths', 'includeJsonExport',
  'publishRatingCalculations', 'showPerRaceRatingsInSummary',
  'enabledCompetitorFields', 'primaryPersonLabel', 'subdivisionLabel',
  'categoryId', 'archived', 'source',
] as const satisfies readonly (keyof ReturnType<typeof seriesToRow>)[];

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
      // Manual sort order; created_at desc breaks ties so the order is
      // stable if two rows briefly share a display_order under concurrent insert.
      .orderBy(schema.series.displayOrder, sql`${schema.series.createdAt} desc`);
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
    return versionedSave({
      db: this.db,
      table: schema.series,
      rowToType: seriesRowToType,
      workspaceId: this.workspaceId,
      id: s.id,
      values: seriesToRow(s, this.workspaceId),
      updateColumns: seriesUpdateColumns,
      tenancy: { kind: 'workspace' },
      opts,
    });
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

  /** Rewrites `display_order` to match the given id sequence. Ids not in
   *  this workspace are ignored (the per-row WHERE is workspace-scoped). Does
   *  not bump `version` — reordering is a list-organisation gesture, not an edit
   *  to the series payload. */
  async reorder(orderedIds: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx
          .update(schema.series)
          .set({ displayOrder: i })
          .where(
            and(
              eq(schema.series.id, orderedIds[i]),
              eq(schema.series.workspaceId, this.workspaceId),
            ),
          );
      }
    });
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

function fleetToRow(f: Fleet, workspaceId: string) {
  return {
    id: f.id,
    seriesId: f.seriesId,
    workspaceId,
    name: f.name,
    displayOrder: f.displayOrder,
    scoringSystem: f.scoringSystem,
    echoAlpha: f.echoAlpha ?? null,
    nhcProfile: f.nhcProfile ?? null,
  };
}

const fleetUpdateColumns = [
  'name', 'displayOrder', 'scoringSystem', 'echoAlpha', 'nhcProfile',
] as const satisfies readonly (keyof ReturnType<typeof fleetToRow>)[];

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
    return versionedSave({
      db: this.db,
      table: schema.fleets,
      rowToType: fleetRowToType,
      workspaceId: this.workspaceId,
      id: fleet.id,
      values: fleetToRow(fleet, this.workspaceId),
      updateColumns: fleetUpdateColumns,
      tenancy: { kind: 'workspace' },
      opts,
    });
  }

  async saveMany(fleets: Fleet[], opts?: SaveOpts): Promise<void> {
    if (fleets.length === 0) return;
    const seriesIds = [...new Set(fleets.map((f) => f.seriesId))];
    const owned = await filterSeriesIdsByWorkspace(
      this.db,
      this.workspaceId,
      seriesIds,
    );
    if (owned.length !== seriesIds.length) {
      throw new Error('some series not in workspace');
    }
    await versionedSaveMany({
      db: this.db,
      table: schema.fleets,
      workspaceId: this.workspaceId,
      values: fleets.map((f) => fleetToRow(f, this.workspaceId)),
      updateColumns: fleetUpdateColumns,
      tenancy: 'workspace',
      opts,
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

function competitorToRow(c: Competitor, workspaceId: string) {
  return {
    id: c.id,
    seriesId: c.seriesId,
    workspaceId,
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
    vprsTcc: c.vprsTcc ?? null,
    pyNumber: c.pyNumber ?? null,
    nhcStartingTcf: c.nhcStartingTcf ?? null,
    echoStartingTcf: c.echoStartingTcf ?? null,
  };
}

const competitorUpdateColumns = [
  'fleetIds', 'sailNumber', 'boatName', 'boatClass', 'name',
  'owner', 'helm', 'crewName', 'club', 'nationality',
  'gender', 'age', 'subdivision',
  'ircTcc', 'vprsTcc', 'pyNumber', 'nhcStartingTcf', 'echoStartingTcf',
] as const satisfies readonly (keyof ReturnType<typeof competitorToRow>)[];

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
    return versionedSave({
      db: this.db,
      table: schema.competitors,
      rowToType: competitorRowToType,
      workspaceId: this.workspaceId,
      id: c.id,
      values: competitorToRow(c, this.workspaceId),
      updateColumns: competitorUpdateColumns,
      tenancy: { kind: 'workspace' },
      opts,
    });
  }

  async saveMany(competitors: Competitor[], opts?: SaveOpts): Promise<void> {
    if (competitors.length === 0) return;
    const seriesIds = [...new Set(competitors.map((c) => c.seriesId))];
    const owned = await filterSeriesIdsByWorkspace(
      this.db,
      this.workspaceId,
      seriesIds,
    );
    if (owned.length !== seriesIds.length) {
      throw new Error('some series not in workspace');
    }
    await versionedSaveMany({
      db: this.db,
      table: schema.competitors,
      workspaceId: this.workspaceId,
      values: competitors.map((c) => competitorToRow(c, this.workspaceId)),
      updateColumns: competitorUpdateColumns,
      tenancy: 'workspace',
      opts,
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

function raceToRow(r: Race, workspaceId: string) {
  return {
    id: r.id,
    seriesId: r.seriesId,
    workspaceId,
    raceNumber: r.raceNumber,
    date: r.date,
    createdAt: new Date(r.createdAt),
  };
}

const raceUpdateColumns = [
  'raceNumber', 'date',
] as const satisfies readonly (keyof ReturnType<typeof raceToRow>)[];

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
    return versionedSave({
      db: this.db,
      table: schema.races,
      rowToType: raceRowToType,
      workspaceId: this.workspaceId,
      id: r.id,
      values: raceToRow(r, this.workspaceId),
      updateColumns: raceUpdateColumns,
      tenancy: { kind: 'workspace' },
      opts,
    });
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

// ─── Sub-series ───────────────────────────────────────────────────────────────

function subSeriesToRow(s: SubSeries, workspaceId: string) {
  return {
    id: s.id,
    seriesId: s.seriesId,
    workspaceId,
    name: s.name,
    displayOrder: s.displayOrder,
    startingHandicapSource: s.startingHandicapSource ?? 'base',
    continueFromSubSeriesId: s.continueFromSubSeriesId ?? null,
  };
}

const subSeriesUpdateColumns = [
  'name', 'displayOrder', 'startingHandicapSource', 'continueFromSubSeriesId',
] as const satisfies readonly (keyof ReturnType<typeof subSeriesToRow>)[];

export class PostgresSubSeriesRepository implements SubSeriesRepository {
  private readonly db: SailScoringDb;
  private readonly workspaceId: string;

  constructor(ctx: RepoCtx) {
    this.db = ctx.db ?? getDb();
    this.workspaceId = ctx.workspaceId;
  }

  /** Member race ids for each given sub-series id (many-to-many). */
  private async raceIdsBySubSeries(
    subSeriesIds: string[],
  ): Promise<Map<string, string[]>> {
    const byId = new Map<string, string[]>(subSeriesIds.map((id) => [id, []]));
    if (subSeriesIds.length === 0) return byId;
    const rows = await this.db
      .select({
        subSeriesId: schema.subSeriesRaces.subSeriesId,
        raceId: schema.subSeriesRaces.raceId,
        raceNumber: schema.races.raceNumber,
      })
      .from(schema.subSeriesRaces)
      .innerJoin(schema.races, eq(schema.subSeriesRaces.raceId, schema.races.id))
      .where(
        and(
          inArray(schema.subSeriesRaces.subSeriesId, subSeriesIds),
          eq(schema.subSeriesRaces.workspaceId, this.workspaceId),
        ),
      )
      .orderBy(schema.races.raceNumber);
    for (const row of rows) {
      byId.get(row.subSeriesId)?.push(row.raceId);
    }
    return byId;
  }

  /** Replace a sub-series' membership rows from its `raceIds` (workspace-scoped). */
  private async writeMembership(subSeriesId: string, raceIds: string[]): Promise<void> {
    await this.db
      .delete(schema.subSeriesRaces)
      .where(
        and(
          eq(schema.subSeriesRaces.subSeriesId, subSeriesId),
          eq(schema.subSeriesRaces.workspaceId, this.workspaceId),
        ),
      );
    const valid = await filterRaceIdsByWorkspace(this.db, this.workspaceId, raceIds);
    if (valid.length === 0) return;
    await this.db.insert(schema.subSeriesRaces).values(
      valid.map((raceId) => ({
        subSeriesId,
        raceId,
        workspaceId: this.workspaceId,
      })),
    );
  }

  async listBySeries(seriesId: string): Promise<SubSeries[]> {
    const rows = await this.db
      .select()
      .from(schema.subSeries)
      .where(
        and(
          eq(schema.subSeries.seriesId, seriesId),
          eq(schema.subSeries.workspaceId, this.workspaceId),
        ),
      )
      .orderBy(schema.subSeries.displayOrder);
    const membership = await this.raceIdsBySubSeries(rows.map((r) => r.id));
    return rows.map((row) => subSeriesRowToType(row, membership.get(row.id) ?? []));
  }

  async get(id: string): Promise<SubSeries | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.subSeries)
      .where(
        and(
          eq(schema.subSeries.id, id),
          eq(schema.subSeries.workspaceId, this.workspaceId),
        ),
      )
      .limit(1);
    if (!row) return undefined;
    const membership = await this.raceIdsBySubSeries([id]);
    return subSeriesRowToType(row, membership.get(id) ?? []);
  }

  async save(s: SubSeries, opts?: SaveOpts): Promise<SubSeries> {
    const saved = await versionedSave({
      db: this.db,
      table: schema.subSeries,
      rowToType: (row) => subSeriesRowToType(row, []),
      workspaceId: this.workspaceId,
      id: s.id,
      values: subSeriesToRow(s, this.workspaceId),
      updateColumns: subSeriesUpdateColumns,
      tenancy: { kind: 'workspace' },
      opts,
    });
    await this.writeMembership(s.id, s.raceIds);
    return { ...saved, raceIds: [...s.raceIds] };
  }

  async saveMany(list: SubSeries[], opts?: SaveOpts): Promise<void> {
    for (const s of list) {
      await this.save(s, opts);
    }
  }

  async delete(id: string): Promise<void> {
    await this.db
      .delete(schema.subSeries)
      .where(
        and(
          eq(schema.subSeries.id, id),
          eq(schema.subSeries.workspaceId, this.workspaceId),
        ),
      );
  }

  async deleteBySeries(seriesId: string): Promise<void> {
    await this.db
      .delete(schema.subSeries)
      .where(
        and(
          eq(schema.subSeries.seriesId, seriesId),
          eq(schema.subSeries.workspaceId, this.workspaceId),
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

function raceStartToRow(s: RaceStart) {
  return {
    id: s.id,
    raceId: s.raceId,
    fleetIds: s.fleetIds,
    startTime: s.startTime,
  };
}

const raceStartUpdateColumns = [
  'fleetIds', 'startTime',
] as const satisfies readonly (keyof ReturnType<typeof raceStartToRow>)[];

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

  /** All starts across the series' races in one query; tenancy via the
   *  parent races' workspace_id. */
  async listBySeries(seriesId: string): Promise<RaceStart[]> {
    const rows = await this.db
      .select({ raceStart: schema.raceStarts })
      .from(schema.raceStarts)
      .innerJoin(schema.races, eq(schema.raceStarts.raceId, schema.races.id))
      .where(
        and(
          eq(schema.races.seriesId, seriesId),
          eq(schema.races.workspaceId, this.workspaceId),
        ),
      );
    return rows.map((r) => raceStartRowToType(r.raceStart));
  }

  async save(s: RaceStart, opts?: SaveOpts): Promise<RaceStart> {
    if (!(await isRaceInWorkspace(this.db, this.workspaceId, s.raceId))) {
      throw new Error(`race ${s.raceId} not in workspace`);
    }
    return versionedSave({
      db: this.db,
      table: schema.raceStarts,
      rowToType: raceStartRowToType,
      workspaceId: this.workspaceId,
      id: s.id,
      values: raceStartToRow(s),
      updateColumns: raceStartUpdateColumns,
      tenancy: { kind: 'parent-race', raceId: s.raceId },
      opts,
    });
  }

  async saveMany(starts: RaceStart[], opts?: SaveOpts): Promise<void> {
    if (starts.length === 0) return;
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
    await versionedSaveMany({
      db: this.db,
      table: schema.raceStarts,
      workspaceId: this.workspaceId,
      values: starts.map(raceStartToRow),
      updateColumns: raceStartUpdateColumns,
      tenancy: 'parent-race',
      opts,
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

function raceRatingOverrideToRow(o: RaceRatingOverride) {
  return {
    id: o.id,
    raceId: o.raceId,
    competitorId: o.competitorId,
    field: o.field,
    value: o.value,
  };
}

const raceRatingOverrideUpdateColumns = [
  'field', 'value',
] as const satisfies readonly (keyof ReturnType<typeof raceRatingOverrideToRow>)[];

export class PostgresRaceRatingOverrideRepository implements RaceRatingOverrideRepository {
  private readonly db: SailScoringDb;
  private readonly workspaceId: string;

  constructor(ctx: RepoCtx) {
    this.db = ctx.db ?? getDb();
    this.workspaceId = ctx.workspaceId;
  }

  async listByRaces(raceIds: string[]): Promise<RaceRatingOverride[]> {
    const owned = await filterRaceIdsByWorkspace(this.db, this.workspaceId, raceIds);
    if (owned.length === 0) return [];
    const rows = await this.db
      .select()
      .from(schema.raceRatingOverrides)
      .where(inArray(schema.raceRatingOverrides.raceId, owned));
    return rows.map(raceRatingOverrideRowToType);
  }

  /** All overrides across the series' races in one query; tenancy via the
   *  parent races' workspace_id. */
  async listBySeries(seriesId: string): Promise<RaceRatingOverride[]> {
    const rows = await this.db
      .select({ override: schema.raceRatingOverrides })
      .from(schema.raceRatingOverrides)
      .innerJoin(schema.races, eq(schema.raceRatingOverrides.raceId, schema.races.id))
      .where(
        and(
          eq(schema.races.seriesId, seriesId),
          eq(schema.races.workspaceId, this.workspaceId),
        ),
      );
    return rows.map((r) => raceRatingOverrideRowToType(r.override));
  }

  async saveMany(overrides: RaceRatingOverride[], opts?: SaveOpts): Promise<void> {
    if (overrides.length === 0) return;
    const raceIds = [...new Set(overrides.map((o) => o.raceId))];
    const owned = await filterRaceIdsByWorkspace(this.db, this.workspaceId, raceIds);
    if (owned.length !== raceIds.length) {
      throw new Error('some races not in workspace');
    }
    await versionedSaveMany({
      db: this.db,
      table: schema.raceRatingOverrides,
      workspaceId: this.workspaceId,
      values: overrides.map(raceRatingOverrideToRow),
      updateColumns: raceRatingOverrideUpdateColumns,
      tenancy: 'parent-race',
      opts,
    });
  }

  async delete(id: string): Promise<void> {
    const [join] = await this.db
      .select({ id: schema.raceRatingOverrides.id })
      .from(schema.raceRatingOverrides)
      .innerJoin(schema.races, eq(schema.raceRatingOverrides.raceId, schema.races.id))
      .where(
        and(
          eq(schema.raceRatingOverrides.id, id),
          eq(schema.races.workspaceId, this.workspaceId),
        ),
      )
      .limit(1);
    if (!join) return;
    await this.db.delete(schema.raceRatingOverrides).where(eq(schema.raceRatingOverrides.id, id));
  }

  async deleteByRaces(raceIds: string[]): Promise<void> {
    const owned = await filterRaceIdsByWorkspace(this.db, this.workspaceId, raceIds);
    if (owned.length === 0) return;
    await this.db
      .delete(schema.raceRatingOverrides)
      .where(inArray(schema.raceRatingOverrides.raceId, owned));
  }
}

// ─── Finishes ────────────────────────────────────────────────────────────────

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
    penaltyOverrideByFleet: f.penaltyOverrideByFleet ?? null,
    redressMethod: f.redressMethod,
    redressExcludeRaces: f.redressExcludeRaces,
    redressIncludeRaces: f.redressIncludeRaces,
    redressIncludeAllLater: f.redressIncludeAllLater,
    redressPoints: f.redressPoints,
    redressPointsByFleet: f.redressPointsByFleet ?? null,
  };
}

const finishUpdateColumns = [
  'competitorId', 'unknownSailNumber', 'sortOrder', 'tiedWithPrevious',
  'finishTime', 'resultCode', 'startPresent', 'penaltyCode', 'penaltyOverride',
  'penaltyOverrideByFleet', 'redressMethod', 'redressExcludeRaces', 'redressIncludeRaces',
  'redressIncludeAllLater', 'redressPoints', 'redressPointsByFleet',
] as const satisfies readonly (keyof ReturnType<typeof finishToRow>)[];

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

  /** Every finish across the series' races in one query — including
   *  unknown-sail rows (null competitorId), which whole-series consumers
   *  (publish, exports, revision snapshots) and the series-scoped
   *  collection route all need. Tenancy via the parent races'
   *  workspace_id. */
  async listBySeries(seriesId: string): Promise<Finish[]> {
    const rows = await this.db
      .select({ finish: schema.finishes })
      .from(schema.finishes)
      .innerJoin(schema.races, eq(schema.finishes.raceId, schema.races.id))
      .where(
        and(
          eq(schema.races.seriesId, seriesId),
          eq(schema.races.workspaceId, this.workspaceId),
        ),
      );
    return rows.map((r) => finishRowToType(r.finish));
  }

  async save(f: Finish, opts?: SaveOpts): Promise<Finish> {
    if (!(await isRaceInWorkspace(this.db, this.workspaceId, f.raceId))) {
      throw new Error(`race ${f.raceId} not in workspace`);
    }
    return versionedSave({
      db: this.db,
      table: schema.finishes,
      rowToType: finishRowToType,
      workspaceId: this.workspaceId,
      id: f.id,
      values: finishToRow(f),
      updateColumns: finishUpdateColumns,
      tenancy: { kind: 'parent-race', raceId: f.raceId },
      opts,
    });
  }

  async saveMany(finishes: Finish[], opts?: SaveOpts): Promise<void> {
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
    await versionedSaveMany({
      db: this.db,
      table: schema.finishes,
      workspaceId: this.workspaceId,
      values: finishes.map(finishToRow),
      updateColumns: finishUpdateColumns,
      tenancy: 'parent-race',
      opts,
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

// ─── FTP servers ─────────────────────────────────────────────────────────────

function ftpServerToRow(server: FtpServer, workspaceId: string) {
  return {
    id: server.id,
    workspaceId,
    host: server.host,
    port: server.port,
    username: server.username,
    encryptedPassword: encryptCredential(server.password),
    ftps: server.ftps,
  };
}

const ftpServerUpdateColumns = [
  'host', 'port', 'username', 'encryptedPassword', 'ftps',
] as const satisfies readonly (keyof ReturnType<typeof ftpServerToRow>)[];

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
    return versionedSave({
      db: this.db,
      table: schema.ftpServers,
      // The plaintext password never round-trips through the row; echo the
      // input back with the version the write produced.
      rowToType: (row) => ({ ...server, version: row.version }),
      workspaceId: this.workspaceId,
      id: server.id,
      values: ftpServerToRow(server, this.workspaceId),
      updateColumns: ftpServerUpdateColumns,
      tenancy: { kind: 'workspace' },
      opts,
    });
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

// ─── Flag locker (logo library) ──────────────────────────────────────────────

/** Row fields a create needs once the bytes are stored and the locator known.
 *  The handler does the Blob IO; the repository only persists the row. */
export interface NewLogo {
  id: string;
  displayName: string;
  logoClass: LogoClass;
  locator: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  sourceUrl: string;
}

function logoRowToType(
  row: typeof schema.flagLockerLogos.$inferSelect,
): Logo {
  return {
    id: row.id,
    displayName: row.displayName,
    logoClass: row.logoClass as LogoClass,
    contentType: row.contentType,
    byteSize: row.byteSize,
    sha256: row.sha256,
    sourceUrl: row.sourceUrl ?? '',
  };
}

/**
 * Per-workspace logo library — the flag locker. Workspace-scoped, no optimistic
 * concurrency (like categories): logos are low-churn metadata, edited one at a
 * time, so last-write-wins is fine. Asset bytes live in Blob via
 * `flag-locker-storage`; this repository persists only the row. Metadata edits
 * (`updateMeta`) never touch the bytes, so the `locator` is stable across a
 * rename.
 */
export class PostgresLogoRepository {
  private readonly db: SailScoringDb;
  private readonly workspaceId: string;

  constructor(ctx: RepoCtx) {
    this.db = ctx.db ?? getDb();
    this.workspaceId = ctx.workspaceId;
  }

  async list(): Promise<Logo[]> {
    const rows = await this.db
      .select()
      .from(schema.flagLockerLogos)
      .where(eq(schema.flagLockerLogos.workspaceId, this.workspaceId))
      .orderBy(schema.flagLockerLogos.createdAt);
    return rows.map(logoRowToType);
  }

  async create(logo: NewLogo, opts?: { updatedBy?: string | null }): Promise<Logo> {
    const [row] = await this.db
      .insert(schema.flagLockerLogos)
      .values({
        id: logo.id,
        workspaceId: this.workspaceId,
        displayName: logo.displayName,
        logoClass: logo.logoClass,
        locator: logo.locator,
        contentType: logo.contentType,
        byteSize: logo.byteSize,
        sha256: logo.sha256,
        sourceUrl: logo.sourceUrl || null,
        updatedBy: opts?.updatedBy ?? null,
      })
      .returning();
    return logoRowToType(row);
  }

  async updateMeta(
    id: string,
    patch: { displayName: string; logoClass: LogoClass; sourceUrl: string },
    opts?: { updatedBy?: string | null },
  ): Promise<Logo | undefined> {
    const [row] = await this.db
      .update(schema.flagLockerLogos)
      .set({
        displayName: patch.displayName,
        logoClass: patch.logoClass,
        sourceUrl: patch.sourceUrl || null,
        version: sql`${schema.flagLockerLogos.version} + 1`,
        updatedAt: sql`now()`,
        updatedBy: opts?.updatedBy ?? null,
      })
      .where(
        and(
          eq(schema.flagLockerLogos.id, id),
          eq(schema.flagLockerLogos.workspaceId, this.workspaceId),
        ),
      )
      .returning();
    return row ? logoRowToType(row) : undefined;
  }

  /** The stored locator + content type for serving or deleting the bytes.
   *  Workspace-scoped so a caller can't reach another workspace's asset. */
  async getStored(
    id: string,
  ): Promise<{ locator: string; contentType: string } | undefined> {
    const [row] = await this.db
      .select({
        locator: schema.flagLockerLogos.locator,
        contentType: schema.flagLockerLogos.contentType,
      })
      .from(schema.flagLockerLogos)
      .where(
        and(
          eq(schema.flagLockerLogos.id, id),
          eq(schema.flagLockerLogos.workspaceId, this.workspaceId),
        ),
      )
      .limit(1);
    return row ?? undefined;
  }

  /** Whether any other logo in the workspace still references `locator` — the
   *  guard before deleting content-addressed bytes a duplicate upload may share. */
  async locatorReferencedElsewhere(
    locator: string,
    excludeId: string,
  ): Promise<boolean> {
    const rows = await this.db
      .select({ id: schema.flagLockerLogos.id })
      .from(schema.flagLockerLogos)
      .where(
        and(
          eq(schema.flagLockerLogos.workspaceId, this.workspaceId),
          eq(schema.flagLockerLogos.locator, locator),
        ),
      );
    return rows.some((r) => r.id !== excludeId);
  }

  async delete(id: string): Promise<void> {
    await this.db
      .delete(schema.flagLockerLogos)
      .where(
        and(
          eq(schema.flagLockerLogos.id, id),
          eq(schema.flagLockerLogos.workspaceId, this.workspaceId),
        ),
      );
  }

  /** The workspace's default venue/event logo URLs (Phase 3). Absent row or
   *  null column → ''. */
  async getDefaults(): Promise<LogoDefaults> {
    const [row] = await this.db
      .select({
        venueLogoUrl: schema.flagLockerDefaults.venueLogoUrl,
        eventLogoUrl: schema.flagLockerDefaults.eventLogoUrl,
      })
      .from(schema.flagLockerDefaults)
      .where(eq(schema.flagLockerDefaults.workspaceId, this.workspaceId))
      .limit(1);
    return {
      venueLogoUrl: row?.venueLogoUrl ?? '',
      eventLogoUrl: row?.eventLogoUrl ?? '',
    };
  }

  async setDefaults(
    defaults: LogoDefaults,
    opts?: { updatedBy?: string | null },
  ): Promise<LogoDefaults> {
    const venueLogoUrl = defaults.venueLogoUrl || null;
    const eventLogoUrl = defaults.eventLogoUrl || null;
    await this.db
      .insert(schema.flagLockerDefaults)
      .values({
        workspaceId: this.workspaceId,
        venueLogoUrl,
        eventLogoUrl,
        updatedBy: opts?.updatedBy ?? null,
      })
      .onConflictDoUpdate({
        target: schema.flagLockerDefaults.workspaceId,
        set: {
          venueLogoUrl,
          eventLogoUrl,
          updatedAt: sql`now()`,
          updatedBy: opts?.updatedBy ?? null,
        },
      });
    return { venueLogoUrl: venueLogoUrl ?? '', eventLogoUrl: eventLogoUrl ?? '' };
  }

  /** The workspace's own logo URL (Better Auth `organization.logo`), or ''. The
   *  default-default new-series venue logo, and what the switcher shows. */
  async getWorkspaceLogo(): Promise<string> {
    const [row] = await this.db
      .select({ logo: schema.organization.logo })
      .from(schema.organization)
      .where(eq(schema.organization.id, this.workspaceId))
      .limit(1);
    return row?.logo ?? '';
  }

  async setWorkspaceLogo(url: string): Promise<string> {
    const logo = url || null;
    await this.db
      .update(schema.organization)
      .set({ logo })
      .where(eq(schema.organization.id, this.workspaceId));
    return logo ?? '';
  }

  /** Clear any default that points at logo `id` (its indirection URL ends in
   *  `/logos/{id}`). Called when that logo is deleted, so a default never
   *  dangles at a removed asset — the URL-storage analogue of the old FK
   *  `ON DELETE SET NULL`. */
  async clearDefaultsReferencingLogo(id: string): Promise<void> {
    const suffix = `%/logos/${id}`;
    await this.db
      .update(schema.flagLockerDefaults)
      .set({
        venueLogoUrl: sql`case when ${schema.flagLockerDefaults.venueLogoUrl} like ${suffix} then null else ${schema.flagLockerDefaults.venueLogoUrl} end`,
        eventLogoUrl: sql`case when ${schema.flagLockerDefaults.eventLogoUrl} like ${suffix} then null else ${schema.flagLockerDefaults.eventLogoUrl} end`,
      })
      .where(eq(schema.flagLockerDefaults.workspaceId, this.workspaceId));
  }
}

// ─── Categories ──────────────────────────────────────────────────────────────

function categoryRowToType(row: typeof schema.categories.$inferSelect): Category {
  return { id: row.id, name: row.name, displayOrder: row.displayOrder };
}

/**
 * Scorer-defined series categories (#154). Workspace-scoped, no optimistic
 * concurrency — categories are low-churn metadata edited by one scorer at a
 * time, so last-write-wins is fine. Case-insensitive name uniqueness is
 * enforced at the handler layer; the DB has the exact-match backstop.
 */
export class PostgresCategoryRepository {
  private readonly db: SailScoringDb;
  private readonly workspaceId: string;

  constructor(ctx: RepoCtx) {
    this.db = ctx.db ?? getDb();
    this.workspaceId = ctx.workspaceId;
  }

  async list(): Promise<Category[]> {
    const rows = await this.db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.workspaceId, this.workspaceId))
      .orderBy(schema.categories.displayOrder);
    return rows.map(categoryRowToType);
  }

  async create(name: string): Promise<Category> {
    // New categories land at the end. `coalesce(max+1, 0)` seeds the first.
    const [{ next }] = await this.db
      .select({
        next: sql<number>`coalesce(max(${schema.categories.displayOrder}) + 1, 0)`,
      })
      .from(schema.categories)
      .where(eq(schema.categories.workspaceId, this.workspaceId));
    const [row] = await this.db
      .insert(schema.categories)
      .values({
        id: crypto.randomUUID(),
        workspaceId: this.workspaceId,
        name,
        displayOrder: next,
      })
      .returning();
    return categoryRowToType(row);
  }

  async rename(id: string, name: string): Promise<Category | undefined> {
    const [row] = await this.db
      .update(schema.categories)
      .set({ name })
      .where(
        and(
          eq(schema.categories.id, id),
          eq(schema.categories.workspaceId, this.workspaceId),
        ),
      )
      .returning();
    return row ? categoryRowToType(row) : undefined;
  }

  /** Deleting a category drops its series back to Uncategorized via the
   *  `series.category_id` ON DELETE SET NULL. */
  async delete(id: string): Promise<void> {
    await this.db
      .delete(schema.categories)
      .where(
        and(
          eq(schema.categories.id, id),
          eq(schema.categories.workspaceId, this.workspaceId),
        ),
      );
  }

  /** Rewrites `display_order` to match the given id sequence. Ids not in this
   *  workspace are ignored (the per-row WHERE is workspace-scoped). */
  async reorder(orderedIds: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx
          .update(schema.categories)
          .set({ displayOrder: i })
          .where(
            and(
              eq(schema.categories.id, orderedIds[i]),
              eq(schema.categories.workspaceId, this.workspaceId),
            ),
          );
      }
    });
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createRepos(ctx: RepoCtx) {
  return {
    series: new PostgresSeriesRepository(ctx),
    categories: new PostgresCategoryRepository(ctx),
    fleets: new PostgresFleetRepository(ctx),
    competitors: new PostgresCompetitorRepository(ctx),
    races: new PostgresRaceRepository(ctx),
    subSeries: new PostgresSubSeriesRepository(ctx),
    raceStarts: new PostgresRaceStartRepository(ctx),
    raceRatingOverrides: new PostgresRaceRatingOverrideRepository(ctx),
    finishes: new PostgresFinishRepository(ctx),
    ftpServers: new PostgresFtpServerRepository(ctx),
    logos: new PostgresLogoRepository(ctx),
  };
}

/**
 * Adapt the workspace-scoped repos to the `SeriesFileRepos` shape that the
 * `lib/series-file.ts` helpers (`buildSeriesFile`, `openSeriesFromFile`,
 * `updateSeriesFromFile`) consume. Server-side counterpart of the client
 * `api-repository` module that already satisfies the same interface.
 */
export function seriesFileReposFor(ctx: RepoCtx): SeriesFileRepos {
  const repos = createRepos(ctx);
  return {
    seriesRepo: repos.series,
    competitorRepo: repos.competitors,
    fleetRepo: repos.fleets,
    raceRepo: repos.races,
    subSeriesRepo: repos.subSeries,
    raceStartRepo: repos.raceStarts,
    raceRatingOverrideRepo: repos.raceRatingOverrides,
    finishRepo: repos.finishes,
    async listSeriesNames(opts) {
      const all = await repos.series.list();
      return all
        .filter((s) => s.id !== opts?.excludeId)
        .map((s) => s.name);
    },
    // Mirror of the client `deleteSeriesChildren`: races cascade to their
    // starts/finishes/overrides, so deleting races, competitors, and fleets
    // clears the lot.
    async deleteSeriesChildren(seriesId) {
      await repos.races.deleteBySeries(seriesId);
      await repos.subSeries.deleteBySeries(seriesId);
      await repos.competitors.deleteBySeries(seriesId);
      await repos.fleets.deleteBySeries(seriesId);
    },
  };
}
