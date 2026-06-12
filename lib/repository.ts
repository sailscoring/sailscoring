import type { Series, Competitor, Fleet, Race, Finish, FtpServer, RaceStart, RaceRatingOverride, SubSeries } from './types';

/**
 * Thrown by the Postgres-backed `save*` methods when a compare-and-swap
 * fails: the row's `version` in the database no longer matches the
 * caller's `expectedVersion`. The `/api/v1` wrapper maps this to a 409.
 *
 * Lives here (not in a route-handler module) so server-side callers can
 * import it without crossing the repository boundary.
 */
export class ConflictError extends Error {
  constructor(
    public readonly detail?: {
      expectedVersion?: number;
      currentVersion?: number;
      /** ISO-8601; the row's `updated_at` at the moment of conflict. */
      updatedAt?: string;
      /**
       * Reserved for ADR-008 Phase 7 (`updated_by` column populated by the
       * `workspaceRoute` wrapper). Phase 6 leaves this `undefined`.
       */
      actor?: { id: string; email?: string; displayName?: string };
    },
  ) {
    super('conflict');
    this.name = 'ConflictError';
  }
}

/**
 * Optional knobs threaded through every save method (ADR-008 Phase 4).
 *
 * `expectedVersion` carries the row's `version` from the prior read.
 * Postgres-backed repositories interpret it as a compare-and-swap:
 * the update succeeds only if the row in the database is still at
 * `expectedVersion`; otherwise a `ConflictError` is thrown and the API
 * layer returns 409. Dexie ignores the field — local mode has a single
 * writer.
 *
 * Omit `expectedVersion` for authoritative writes (file imports, the
 * server-side migration endpoint, fresh row creation). Bulk writes
 * (`FleetRepository.saveMany`, `CompetitorRepository.saveMany`,
 * `FinishRepository.saveMany`, `RaceStartRepository.saveMany`) are
 * authoritative by construction. The
 * autosave-driven finish-entry path uses per-row `save` calls — each
 * threads its own `expectedVersion` and the shared mutation scope
 * serializes them, so a window of related rows lands consistently
 * without needing a bespoke bulk endpoint.
 *
 * Phase 7 audit (issue #112) walked every `saveMany` caller and
 * confirmed each is authoritative-by-construction. The relevant
 * call sites carry `// Phase 7 audit:` comments documenting the
 * invariant they rely on. The known soft spot is the CSV competitor
 * importer's update branch — it overwrites in-progress hand-edits
 * during the rare window where a panel member edits a competitor at
 * the moment another runs an import. Acceptable tradeoff: imports are
 * a setup-time event, not concurrent with race-day edits.
 *
 * `updatedBy` is the Better Auth user id of the actor performing the
 * write (ADR-008 Phase 7). Postgres-backed repositories stamp it onto
 * the row's `updated_by` column so 409s can name the conflicting actor
 * and so a future activity log (Phase 10) has the foundation it needs.
 * Dexie ignores the field — local mode has a single user.
 */
export interface SaveOpts {
  expectedVersion?: number;
  updatedBy?: string;
}

export interface FleetRepository {
  listBySeries(seriesId: string): Promise<Fleet[]>;
  get(id: string): Promise<Fleet | undefined>;
  save(fleet: Fleet, opts?: SaveOpts): Promise<Fleet>;
  saveMany(fleets: Fleet[], opts?: SaveOpts): Promise<void>;
  delete(id: string): Promise<void>;
  deleteBySeries(seriesId: string): Promise<void>;
}

export interface SeriesRepository {
  list(): Promise<Series[]>;
  get(id: string): Promise<Series | undefined>;
  save(series: Series, opts?: SaveOpts): Promise<Series>;
  delete(id: string): Promise<void>;
  /** Rewrite the manual sort order to match the given id sequence. */
  reorder(orderedIds: string[]): Promise<void>;
}

export interface CompetitorRepository {
  listBySeries(seriesId: string): Promise<Competitor[]>;
  get(id: string): Promise<Competitor | undefined>;
  save(competitor: Competitor, opts?: SaveOpts): Promise<Competitor>;
  saveMany(competitors: Competitor[], opts?: SaveOpts): Promise<void>;
  delete(id: string): Promise<void>;
  deleteBySeries(seriesId: string): Promise<void>;
}

export interface RaceRepository {
  listBySeries(seriesId: string): Promise<Race[]>;
  get(id: string): Promise<Race | undefined>;
  save(race: Race, opts?: SaveOpts): Promise<Race>;
  delete(id: string): Promise<void>;
  deleteBySeries(seriesId: string): Promise<void>;
}

export interface SubSeriesRepository {
  listBySeries(seriesId: string): Promise<SubSeries[]>;
  get(id: string): Promise<SubSeries | undefined>;
  save(subSeries: SubSeries, opts?: SaveOpts): Promise<SubSeries>;
  saveMany(list: SubSeries[], opts?: SaveOpts): Promise<void>;
  delete(id: string): Promise<void>;
  deleteBySeries(seriesId: string): Promise<void>;
}

export interface FinishRepository {
  listByRace(raceId: string): Promise<Finish[]>;
  /** Every finish across the series' races, including unknown-sail rows
   *  (null competitorId) — whole-series consumers must see the full sheet. */
  listBySeries(seriesId: string): Promise<Finish[]>;
  save(finish: Finish, opts?: SaveOpts): Promise<Finish>;
  saveMany(finishes: Finish[], opts?: SaveOpts): Promise<void>;
  delete(id: string): Promise<void>;
  deleteByRace(raceId: string): Promise<void>;
  deleteByRaces(raceIds: string[]): Promise<void>;
}

export interface RaceStartRepository {
  listByRace(raceId: string): Promise<RaceStart[]>;
  /** All starts across every race of the series — whole-series consumers
   *  (standings, exports) use this instead of fanning out per race. */
  listBySeries(seriesId: string): Promise<RaceStart[]>;
  save(raceStart: RaceStart, opts?: SaveOpts): Promise<RaceStart>;
  saveMany(raceStarts: RaceStart[], opts?: SaveOpts): Promise<void>;
  delete(id: string): Promise<void>;
  deleteByRace(raceId: string): Promise<void>;
  deleteByRaces(raceIds: string[]): Promise<void>;
}

export interface RaceRatingOverrideRepository {
  listByRaces(raceIds: string[]): Promise<RaceRatingOverride[]>;
  /** All overrides across every race of the series — whole-series consumers
   *  (standings, exports) use this instead of fanning out per race. */
  listBySeries(seriesId: string): Promise<RaceRatingOverride[]>;
  saveMany(overrides: RaceRatingOverride[], opts?: SaveOpts): Promise<void>;
  delete(id: string): Promise<void>;
  deleteByRaces(raceIds: string[]): Promise<void>;
}

/**
 * Workspace-scoped FTP server credentials. Local Dexie store and remote
 * Postgres store both implement this interface; the Postgres backend
 * encrypts the password column at the application layer (lib/crypto.ts)
 * per ADR-008's sustainability posture.
 */
export interface FtpServerRepository {
  list(): Promise<FtpServer[]>;
  save(server: FtpServer, opts?: SaveOpts): Promise<FtpServer>;
  delete(id: string): Promise<void>;
}
