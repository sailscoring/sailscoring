/**
 * Client-side repository. Implementations forward through fetch() to
 * `/api/v1`. UI callers wrap these in TanStack Query (see hooks/use-*.ts).
 */
import { apiFetch } from './api-client';
import type { IdentityWithArc } from './competitor-identity-repository';
import type { SeriesFileRevision } from './series-file';
import type { IrishSailingRatings } from './irish-sailing-ratings';
import type { IrcRatings } from './irc-rating';
import type { VprsClub, VprsRatings } from './vprs-rating';
import type { RrsOrgCompetitor, RrsOrgPushResult } from './rrs-org';
import type {
  CompetitorFieldPatch,
  CompetitorRepository,
  FinishRepository,
  FleetRepository,
  FtpServerRepository,
  RaceRepository,
  RaceStartRepository,
  RaceRatingOverrideRepository,
  SaveOpts,
  SeriesRepository,
  SubSeriesRepository,
} from './repository';
import type {
  ActivityEntry,
  AuditStamp,
  Category,
  Competitor,
  DeletedSeriesEntry,
  OrgRequest,
  Finish,
  Fleet,
  FtpServer,
  Logo,
  LogoClass,
  LogoDefaults,
  Race,
  RaceStart,
  RevisionEntry,
  RaceRatingOverride,
  Series,
  SubSeries,
  TcfRecord,
  PublishResult,
  PublishedListItem,
  PublicationStatus,
} from './types';

export const DEFAULT_FLEET_NAME = 'Default';

class ApiSeriesRepository implements SeriesRepository {
  async list(): Promise<Series[]> {
    const { items } = await apiFetch<{ items: Series[] }>('/api/v1/series');
    return items;
  }

  get(id: string): Promise<Series | undefined> {
    return apiFetch<Series | undefined>(`/api/v1/series/${id}`, { allow404: true });
  }

  save(s: Series, opts?: SaveOpts): Promise<Series> {
    return apiFetch<Series>(`/api/v1/series/${s.id}`, {
      method: 'PUT',
      body: s,
      expectedVersion: opts?.expectedVersion,
    });
  }

  async delete(id: string): Promise<void> {
    await apiFetch(`/api/v1/series/${id}`, { method: 'DELETE' });
  }

  async reorder(orderedIds: string[]): Promise<void> {
    await apiFetch('/api/v1/series/reorder', {
      method: 'POST',
      body: { orderedIds },
    });
  }
}

class ApiFleetRepository implements FleetRepository {
  listBySeries(seriesId: string): Promise<Fleet[]> {
    return apiFetch<Fleet[]>(`/api/v1/series/${seriesId}/fleets`);
  }

  get(id: string): Promise<Fleet | undefined> {
    // The /api/v1 surface routes fleets under /series/:id/fleets/:fleetId,
    // but the FleetRepository.get(id) signature only carries the fleet
    // id. No call site needs this; if one ever does, add a flat
    // /api/v1/fleets/:id endpoint.
    return Promise.reject(
      new Error('ApiFleetRepository.get(id) requires seriesId; use listBySeries'),
    ).catch(() => undefined);
  }

  save(fleet: Fleet, opts?: SaveOpts): Promise<Fleet> {
    return apiFetch<Fleet>(`/api/v1/series/${fleet.seriesId}/fleets/${fleet.id}`, {
      method: 'PUT',
      body: fleet,
      expectedVersion: opts?.expectedVersion,
    });
  }

  async saveMany(fleets: Fleet[]): Promise<void> {
    if (fleets.length === 0) return;
    const seriesIds = new Set(fleets.map((f) => f.seriesId));
    if (seriesIds.size !== 1) {
      throw new Error('saveMany: all fleets must share a seriesId');
    }
    const [seriesId] = seriesIds;
    await apiFetch(`/api/v1/series/${seriesId}/fleets`, {
      method: 'POST',
      body: { fleets },
    });
  }

  async delete(id: string): Promise<void> {
    await apiFetch(`/api/v1/fleets/${id}`, { method: 'DELETE' });
  }

  async deleteBySeries(seriesId: string): Promise<void> {
    await apiFetch(`/api/v1/series/${seriesId}/fleets`, { method: 'DELETE' });
  }
}

class ApiCompetitorRepository implements CompetitorRepository {
  listBySeries(seriesId: string): Promise<Competitor[]> {
    return apiFetch<Competitor[]>(`/api/v1/series/${seriesId}/competitors`);
  }

  get(id: string): Promise<Competitor | undefined> {
    return apiFetch<Competitor | undefined>(`/api/v1/competitors/${id}`, { allow404: true });
  }

  save(c: Competitor, opts?: SaveOpts): Promise<Competitor> {
    return apiFetch<Competitor>(
      `/api/v1/series/${c.seriesId}/competitors/${c.id}`,
      { method: 'PUT', body: c, expectedVersion: opts?.expectedVersion },
    );
  }

  async saveMany(competitors: Competitor[]): Promise<void> {
    if (competitors.length === 0) return;
    const seriesIds = new Set(competitors.map((c) => c.seriesId));
    if (seriesIds.size !== 1) {
      throw new Error('saveMany: all competitors must share a seriesId');
    }
    const [seriesId] = seriesIds;
    await apiFetch(`/api/v1/series/${seriesId}/competitors`, {
      method: 'POST',
      body: { competitors },
    });
  }

  async updateMany(
    seriesId: string,
    ids: string[],
    patch: CompetitorFieldPatch,
  ): Promise<void> {
    if (ids.length === 0) return;
    const set =
      patch.field === 'subdivision'
        ? { subdivision: { axisId: patch.axisId, value: patch.value } }
        : patch.field === 'fleet'
          ? { fleet: { fleetId: patch.fleetId, op: patch.op } }
          : { [patch.field]: patch.value };
    await apiFetch(`/api/v1/series/${seriesId}/competitors`, {
      method: 'PATCH',
      body: { ids, set },
    });
  }

  async delete(id: string): Promise<void> {
    await apiFetch(`/api/v1/competitors/${id}`, { method: 'DELETE' });
  }

  async deleteMany(seriesId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await apiFetch(`/api/v1/series/${seriesId}/competitors`, {
      method: 'DELETE',
      body: { ids },
    });
  }

  async deleteBySeries(seriesId: string): Promise<void> {
    await apiFetch(`/api/v1/series/${seriesId}/competitors`, { method: 'DELETE' });
  }
}

class ApiRaceRepository implements RaceRepository {
  listBySeries(seriesId: string): Promise<Race[]> {
    return apiFetch<Race[]>(`/api/v1/series/${seriesId}/races`);
  }

  get(id: string): Promise<Race | undefined> {
    return apiFetch<Race | undefined>(`/api/v1/races/${id}`, { allow404: true });
  }

  save(r: Race, opts?: SaveOpts): Promise<Race> {
    return apiFetch<Race>(`/api/v1/series/${r.seriesId}/races/${r.id}`, {
      method: 'PUT',
      body: r,
      expectedVersion: opts?.expectedVersion,
    });
  }

  async reorder(seriesId: string, orderedIds: string[]): Promise<void> {
    await apiFetch(`/api/v1/series/${seriesId}/races/reorder`, {
      method: 'POST',
      body: { orderedIds },
    });
  }

  async delete(id: string): Promise<void> {
    await apiFetch(`/api/v1/races/${id}`, { method: 'DELETE' });
  }

  async deleteBySeries(seriesId: string): Promise<void> {
    await apiFetch(`/api/v1/series/${seriesId}/races`, { method: 'DELETE' });
  }
}

class ApiRaceStartRepository implements RaceStartRepository {
  listByRace(raceId: string): Promise<RaceStart[]> {
    return apiFetch<RaceStart[]>(`/api/v1/races/${raceId}/starts`);
  }

  listBySeries(seriesId: string): Promise<RaceStart[]> {
    return apiFetch<RaceStart[]>(`/api/v1/series/${seriesId}/race-starts`);
  }

  save(s: RaceStart, opts?: SaveOpts): Promise<RaceStart> {
    return apiFetch<RaceStart>(`/api/v1/races/${s.raceId}/starts/${s.id}`, {
      method: 'PUT',
      body: s,
      expectedVersion: opts?.expectedVersion,
    });
  }

  async saveMany(starts: RaceStart[]): Promise<void> {
    if (starts.length === 0) return;
    // All starts must share a single race id for the bulk endpoint.
    const byRace = new Map<string, RaceStart[]>();
    for (const s of starts) {
      const list = byRace.get(s.raceId) ?? [];
      list.push(s);
      byRace.set(s.raceId, list);
    }
    await Promise.all(
      [...byRace.entries()].map(([raceId, list]) =>
        apiFetch(`/api/v1/races/${raceId}/starts`, {
          method: 'POST',
          body: { starts: list },
        }),
      ),
    );
  }

  async delete(id: string): Promise<void> {
    await apiFetch(`/api/v1/race-starts/${id}`, { method: 'DELETE' });
  }

  async deleteByRace(raceId: string): Promise<void> {
    await apiFetch(`/api/v1/races/${raceId}/starts`, { method: 'DELETE' });
  }

  async deleteByRaces(raceIds: string[]): Promise<void> {
    await Promise.all(raceIds.map((r) => this.deleteByRace(r)));
  }
}

class ApiRaceRatingOverrideRepository implements RaceRatingOverrideRepository {
  // Per-race reads (the ratings tab) pass a single id; whole-series readers
  // use listBySeries below rather than fanning out per race.
  async listByRaces(raceIds: string[]): Promise<RaceRatingOverride[]> {
    const lists = await Promise.all(
      raceIds.map((id) => apiFetch<RaceRatingOverride[]>(`/api/v1/races/${id}/rating-overrides`)),
    );
    return lists.flat();
  }

  listBySeries(seriesId: string): Promise<RaceRatingOverride[]> {
    return apiFetch<RaceRatingOverride[]>(`/api/v1/series/${seriesId}/rating-overrides`);
  }

  async saveMany(overrides: RaceRatingOverride[]): Promise<void> {
    if (overrides.length === 0) return;
    const byRace = new Map<string, RaceRatingOverride[]>();
    for (const o of overrides) {
      const list = byRace.get(o.raceId) ?? [];
      list.push(o);
      byRace.set(o.raceId, list);
    }
    await Promise.all(
      [...byRace.entries()].map(([raceId, list]) =>
        apiFetch(`/api/v1/races/${raceId}/rating-overrides`, {
          method: 'POST',
          body: { overrides: list },
        }),
      ),
    );
  }

  async delete(id: string): Promise<void> {
    await apiFetch(`/api/v1/race-rating-overrides/${id}`, { method: 'DELETE' });
  }

  async deleteByRaces(raceIds: string[]): Promise<void> {
    await Promise.all(
      raceIds.map((r) => apiFetch(`/api/v1/races/${r}/rating-overrides`, { method: 'DELETE' })),
    );
  }
}

class ApiSubSeriesRepository implements SubSeriesRepository {
  listBySeries(seriesId: string): Promise<SubSeries[]> {
    return apiFetch<SubSeries[]>(`/api/v1/series/${seriesId}/sub-series`);
  }

  get(_id: string): Promise<SubSeries | undefined> {
    return Promise.reject(
      new Error('ApiSubSeriesRepository.get(id) requires seriesId; use listBySeries'),
    );
  }

  save(s: SubSeries, opts?: SaveOpts): Promise<SubSeries> {
    return apiFetch<SubSeries>(`/api/v1/series/${s.seriesId}/sub-series/${s.id}`, {
      method: 'PUT',
      body: s,
      expectedVersion: opts?.expectedVersion,
    });
  }

  async saveMany(list: SubSeries[], opts?: SaveOpts): Promise<void> {
    for (const item of list) {
      await this.save(item, opts);
    }
  }

  delete(_id: string): Promise<void> {
    return Promise.reject(
      new Error('ApiSubSeriesRepository.delete(id) requires seriesId; use deleteSubSeries'),
    );
  }

  /** Raw collection delete (file-import replace path). The interactive
   *  "remove this block" gesture with merge semantics is deleteSubSeries. */
  async deleteBySeries(seriesId: string): Promise<void> {
    await apiFetch(`/api/v1/series/${seriesId}/sub-series`, { method: 'DELETE' });
  }
}

class ApiFinishRepository implements FinishRepository {
  listByRace(raceId: string): Promise<Finish[]> {
    return apiFetch<Finish[]>(`/api/v1/races/${raceId}/finishes`);
  }

  listBySeries(seriesId: string): Promise<Finish[]> {
    return apiFetch<Finish[]>(`/api/v1/series/${seriesId}/finishes`);
  }

  save(f: Finish, opts?: SaveOpts): Promise<Finish> {
    return apiFetch<Finish>(`/api/v1/races/${f.raceId}/finishes/${f.id}`, {
      method: 'PUT',
      body: f,
      expectedVersion: opts?.expectedVersion,
    });
  }

  async saveMany(finishes: Finish[]): Promise<void> {
    if (finishes.length === 0) return;
    // All finishes must share a single race id for the bulk endpoint.
    const byRace = new Map<string, Finish[]>();
    for (const f of finishes) {
      const list = byRace.get(f.raceId) ?? [];
      list.push(f);
      byRace.set(f.raceId, list);
    }
    await Promise.all(
      [...byRace.entries()].map(([raceId, list]) =>
        apiFetch(`/api/v1/races/${raceId}/finishes`, {
          method: 'POST',
          body: { finishes: list },
        }),
      ),
    );
  }

  async delete(id: string): Promise<void> {
    await apiFetch(`/api/v1/finishes/${id}`, { method: 'DELETE' });
  }

  async deleteByRace(raceId: string): Promise<void> {
    await apiFetch(`/api/v1/races/${raceId}/finishes`, { method: 'DELETE' });
  }

  async deleteByRaces(raceIds: string[]): Promise<void> {
    await Promise.all(raceIds.map((r) => this.deleteByRace(r)));
  }
}

class ApiFtpServerRepository implements FtpServerRepository {
  list(): Promise<FtpServer[]> {
    return apiFetch<FtpServer[]>('/api/v1/ftp-servers');
  }

  save(server: FtpServer, opts?: SaveOpts): Promise<FtpServer> {
    return apiFetch<FtpServer>(`/api/v1/ftp-servers/${server.id}`, {
      method: 'PUT',
      body: server,
      expectedVersion: opts?.expectedVersion,
    });
  }

  async delete(id: string): Promise<void> {
    await apiFetch(`/api/v1/ftp-servers/${id}`, { method: 'DELETE' });
  }
}

/** Fields the upload card supplies. `data` is the asset bytes base64-encoded;
 *  the server decodes, size-checks, and computes the sha256. */
export interface LogoUpload {
  id: string;
  displayName: string;
  logoClass: LogoClass;
  contentType: string;
  data: string;
  sourceUrl: string;
}

/** Metadata-only edit for an existing logo. */
export interface LogoMetaPatch {
  displayName: string;
  logoClass: LogoClass;
  sourceUrl: string;
}

class ApiLogoRepository {
  list(): Promise<Logo[]> {
    return apiFetch<Logo[]>('/api/v1/logos');
  }

  /** List the logos of another workspace the caller belongs to (copy picker). */
  listFrom(workspaceId: string): Promise<Logo[]> {
    return apiFetch<Logo[]>(`/api/v1/logos?from=${encodeURIComponent(workspaceId)}`);
  }

  /** Copy a logo from another workspace into the active one (copy, not ref). */
  copyFrom(sourceWorkspaceId: string, sourceLogoId: string): Promise<Logo> {
    return apiFetch<Logo>('/api/v1/logos/copy', {
      method: 'POST',
      body: { sourceWorkspaceId, sourceLogoId },
    });
  }

  create(upload: LogoUpload): Promise<Logo> {
    return apiFetch<Logo>('/api/v1/logos', { method: 'POST', body: upload });
  }

  updateMeta(id: string, patch: LogoMetaPatch): Promise<Logo> {
    return apiFetch<Logo>(`/api/v1/logos/${id}`, { method: 'PUT', body: patch });
  }

  async delete(id: string): Promise<void> {
    await apiFetch(`/api/v1/logos/${id}`, { method: 'DELETE' });
  }

  /** `<img src>` for a logo's bytes (authenticated, workspace-scoped). */
  rawUrl(id: string): string {
    return `/api/v1/logos/${id}/raw`;
  }

  getDefaults(): Promise<LogoDefaults> {
    return apiFetch<LogoDefaults>('/api/v1/logos/defaults');
  }

  setDefaults(defaults: LogoDefaults): Promise<LogoDefaults> {
    return apiFetch<LogoDefaults>('/api/v1/logos/defaults', {
      method: 'PUT',
      body: defaults,
    });
  }

  /** Set the active workspace's own logo (`organization.logo`); '' clears it. */
  setWorkspaceLogo(logo: string): Promise<{ logo: string }> {
    return apiFetch<{ logo: string }>('/api/v1/workspace', {
      method: 'PATCH',
      body: { logo },
    });
  }
}

export const seriesRepo: SeriesRepository = new ApiSeriesRepository();
export const fleetRepo: FleetRepository = new ApiFleetRepository();
export const competitorRepo: CompetitorRepository = new ApiCompetitorRepository();
export const raceRepo: RaceRepository = new ApiRaceRepository();
export const subSeriesRepo: SubSeriesRepository = new ApiSubSeriesRepository();
export const raceStartRepo: RaceStartRepository = new ApiRaceStartRepository();
export const raceRatingOverrideRepo: RaceRatingOverrideRepository = new ApiRaceRatingOverrideRepository();
export const finishRepo: FinishRepository = new ApiFinishRepository();
export const ftpServerRepo: FtpServerRepository = new ApiFtpServerRepository();
export const logoRepo = new ApiLogoRepository();

// ─── Sub-series (#203) ───────────────────────────────────────────────────────

/** The series' sub-series, displayOrder matching race order. */
export function listSubSeries(seriesId: string): Promise<SubSeries[]> {
  return apiFetch<SubSeries[]>(`/api/v1/series/${seriesId}/sub-series`);
}

/**
 * The "start a new sub-series here" gesture. The new block runs from
 * `firstRaceId` to the end of the block containing it. On the first split of
 * a blockless series, `initialName` names the block created for the races
 * before the split (required when there are any). Omit `firstRaceId` to
 * group every race into the new block (no blocks yet) or append an empty
 * block (blocks exist).
 */
export function createSubSeries(
  seriesId: string,
  input: {
    name: string;
    raceIds?: string[];
    fleetIds?: string[];
    raceFleetExclusions?: { raceId: string; fleetId: string }[];
    startingHandicapSource?: 'base' | 'continue';
    continueFromSubSeriesId?: string | null;
    excludeDncOnlyCompetitors?: boolean;
  },
): Promise<SubSeries> {
  return apiFetch<SubSeries>(`/api/v1/series/${seriesId}/sub-series`, {
    method: 'POST',
    body: input,
  });
}

/** Remove a sub-series; its membership rows are dropped, races untouched. */
export async function deleteSubSeries(seriesId: string, subSeriesId: string): Promise<void> {
  await apiFetch(`/api/v1/series/${seriesId}/sub-series/${subSeriesId}`, {
    method: 'DELETE',
  });
}

// ─── Series-list organisation (#154) ─────────────────────────────────────────

/** Scorer-defined categories for the active workspace, in display order. */
export async function listCategories(): Promise<Category[]> {
  const { items } = await apiFetch<{ items: Category[] }>('/api/v1/categories');
  return items;
}

export function createCategory(name: string): Promise<Category> {
  return apiFetch<Category>('/api/v1/categories', { method: 'POST', body: { name } });
}

export function renameCategory(id: string, name: string): Promise<Category> {
  return apiFetch<Category>(`/api/v1/categories/${id}`, { method: 'PATCH', body: { name } });
}

export async function deleteCategory(id: string): Promise<void> {
  await apiFetch(`/api/v1/categories/${id}`, { method: 'DELETE' });
}

/** Persist a new category order; returns the reordered list. */
export async function reorderCategories(orderedIds: string[]): Promise<Category[]> {
  const { items } = await apiFetch<{ items: Category[] }>('/api/v1/categories/reorder', {
    method: 'POST',
    body: { orderedIds },
  });
  return items;
}

/** Move a series to a category (`null` = Uncategorized). Blocked when archived. */
export function setSeriesCategory(
  seriesId: string,
  categoryId: string | null,
): Promise<Series> {
  return apiFetch<Series>(`/api/v1/series/${seriesId}/category`, {
    method: 'POST',
    body: { categoryId },
  });
}

/** Archive or unarchive a series — the read-only toggle (#154). */
export function archiveSeries(seriesId: string, archived: boolean): Promise<Series> {
  return apiFetch<Series>(`/api/v1/series/${seriesId}/archive`, {
    method: 'POST',
    body: { archived },
  });
}

/**
 * Progressive-handicap TCF history for a series. Server computes live
 * from the scoring engine — see `lib/api-handlers/tcf-history.ts`.
 */
export function listTcfHistoryBySeries(seriesId: string): Promise<TcfRecord[]> {
  return apiFetch<TcfRecord[]>(`/api/v1/series/${seriesId}/tcf-history`);
}

/**
 * The national Irish Sailing IRC & ECHO ratings list — a handicap source for
 * the Update Handicaps dialog (#168). Server-fetched from sailing.ie and
 * cached; gated behind the `echo` feature.
 */
export function loadIrishSailingRatings(): Promise<IrishSailingRatings> {
  return apiFetch<IrishSailingRatings>('/api/v1/handicap-sources/irish-sailing');
}

/**
 * The worldwide IRC TCC listing — the IRC handicap source for the Update
 * Handicaps dialog (#168 follow-up). Server-fetched from the RORC/IRC
 * ClubListing and cached; gated behind the `irc-rating` feature.
 */
export function loadIrcRatings(): Promise<IrcRatings> {
  return apiFetch<IrcRatings>('/api/v1/handicap-sources/irc-rating');
}

/**
 * The VPRS club index — the list of clubs that publish VPRS rating listings.
 * Server-fetched from vprs.org/ratings.html and cached; gated behind the `vprs`
 * feature (#175).
 */
export function loadVprsClubs(): Promise<{ clubs: VprsClub[] }> {
  return apiFetch<{ clubs: VprsClub[] }>('/api/v1/handicap-sources/vprs-rating/clubs');
}

/**
 * One club's VPRS rating listing, fetched (and cached server-side) on demand
 * when the scorer picks that club. `clubId` is a {@link VprsClub.id} from
 * {@link loadVprsClubs}; the server validates it against the index.
 */
export function loadVprsClubRatings(clubId: string): Promise<VprsRatings> {
  return apiFetch<VprsRatings>(
    `/api/v1/handicap-sources/vprs-rating?club=${encodeURIComponent(clubId)}`,
  );
}

/**
 * Publish a series' current results (ADR-008 Phase 9/10). `slug` is honoured
 * only on first publish; `join` confirms publishing into a slug that already
 * has results from other series (a slug is a shared namespace). `fleets` selects
 * which fleets to publish/update now (omit for all; ones left out keep their
 * current page); `subPaths` overrides a not-yet-published fleet's URL sub-path
 * (keyed by fleet name); `defaultSubPath` overrides a single-fleet series' lone
 * default page's sub-path. Returns the per-fleet public URLs.
 */
export function publishSeries(
  seriesId: string,
  input: {
    slug?: string;
    join?: boolean;
    fleets?: string[];
    subPaths?: Record<string, string>;
    defaultSubPath?: string;
  } = {},
): Promise<PublishResult> {
  return apiFetch<PublishResult>(`/api/v1/series/${seriesId}/publish`, {
    method: 'POST',
    body: input,
  });
}

/**
 * Push a competitor list to a racingrulesofsailing.org event. The rows are
 * built client-side (`buildRrsOrgCompetitors`) so the dialog previews exactly
 * what is sent; the server forwards them to rrs.org and, on success, remembers
 * the settings as `Series.rrsOrgPush`. An rrs.org rejection comes back as
 * `{ ok: false, … }`, not a thrown error — the dialog renders it with a retry.
 */
export function pushCompetitorsToRrsOrg(
  seriesId: string,
  input: {
    eventUuid: string;
    divisionSource: 'none' | 'fleet' | 'axis';
    divisionAxisId?: string;
    competitors: RrsOrgCompetitor[];
  },
): Promise<RrsOrgPushResult> {
  return apiFetch<RrsOrgPushResult>(`/api/v1/series/${seriesId}/rrs-org-push`, {
    method: 'POST',
    body: input,
  });
}

/** The publication state for a series (workspace slug, suggested slug, and the
 *  current publication if any) — drives the publish dialog. */
export function getPublication(seriesId: string): Promise<PublicationStatus> {
  return apiFetch<PublicationStatus>(`/api/v1/series/${seriesId}/publish`);
}

/** Unpublish this series' live publication (the publish dialog's convenience
 *  path). Takes the public page down and frees the slug. */
export async function unpublishSeries(seriesId: string): Promise<void> {
  await apiFetch(`/api/v1/series/${seriesId}/publish`, { method: 'DELETE' });
}

/** Every publication in the active workspace — the "Published" management page
 *  (#164), including orphaned snapshots. */
export function listPublished(): Promise<PublishedListItem[]> {
  return apiFetch<PublishedListItem[]>('/api/v1/published');
}

/** Unpublish by publication id — the management page's canonical delete, the
 *  only path that reaches an orphan. */
export async function unpublishById(id: string): Promise<void> {
  await apiFetch(`/api/v1/published/${id}`, { method: 'DELETE' });
}

/** The workspace Trash — soft-deleted series recoverable within the retention
 *  window ("Recover a deleted series"). */
export async function listTrash(): Promise<DeletedSeriesEntry[]> {
  const { items } = await apiFetch<{ items: DeletedSeriesEntry[] }>('/api/v1/trash');
  return items;
}

/** Recover a trashed series. `tombstoneId` is the {@link DeletedSeriesEntry.id};
 *  returns the restored series' (original) id. */
export async function restoreFromTrash(tombstoneId: string): Promise<{ seriesId: string }> {
  return apiFetch<{ seriesId: string }>(`/api/v1/trash/${tombstoneId}/restore`, {
    method: 'POST',
  });
}

/** Permanently delete a trashed series — the "delete forever" path. */
export async function purgeFromTrash(tombstoneId: string): Promise<void> {
  await apiFetch(`/api/v1/trash/${tombstoneId}`, { method: 'DELETE' });
}

/**
 * Used by the "new series" / "rename series" duplicate-name check.
 * Workspaces are small, so projecting names from the full series list
 * is acceptable. If list sizes ever justify it, add a `?fields=names`
 * projection on `/api/v1/series` and switch this helper.
 */
export async function listSeriesNames(
  opts: { excludeId?: string } = {},
): Promise<string[]> {
  const all = await seriesRepo.list();
  return all.filter((s) => s.id !== opts.excludeId).map((s) => s.name);
}

/**
 * Delete every child row (fleets, competitors, races, plus their FK-
 * cascaded descendants: race-starts, finishes, nhc-tcf-records) but
 * leave the series row itself in place. Mirror of the Dexie helper used
 * by `lib/series-file.ts`'s "update from file" flow.
 *
 * Server-side FK constraints handle race-starts/finishes/nhc-tcf-records
 * — deleting races cascades to all of them. We only need to clear the
 * three top-level child collections.
 */
export async function deleteSeriesChildren(seriesId: string): Promise<void> {
  await raceRepo.deleteBySeries(seriesId);
  await subSeriesRepo.deleteBySeries(seriesId);
  await competitorRepo.deleteBySeries(seriesId);
  await fleetRepo.deleteBySeries(seriesId);
}

/**
 * Delete a series and every child row. Mirror of the Dexie helper.
 * The Postgres schema's `onDelete: 'cascade'` on every child series_id
 * FK does the work; this wrapper exists so callers don't need to know.
 */
export async function deleteSeriesCascade(seriesId: string): Promise<void> {
  await seriesRepo.delete(seriesId);
}

/**
 * Delete a fleet only if no competitor in the series references it.
 * Mirror of the Dexie helper used by the fleets-card "remove fleet" flow.
 * Implemented client-side as list-then-delete; concurrent edits in the
 * same workspace would surface as a 409 in Phase 4 once `version` is
 * wired into the delete path.
 */
export async function pruneFleet(seriesId: string, fleetId: string): Promise<void> {
  const competitors = await competitorRepo.listBySeries(seriesId);
  const inUse = competitors.some((c) => c.fleetIds.includes(fleetId));
  if (inUse) return;
  await apiFetch(`/api/v1/series/${seriesId}/fleets/${fleetId}`, {
    method: 'DELETE',
  });
}

/**
 * Bulk handicap update — payload + return shape for `updateHandicaps`.
 * Each row's `expectedVersion` is the competitor row's `version` at read
 * time; the server returns a 409 (mapped to `ConflictApiError`) if any
 * row's version has moved on, rolling back the entire batch.
 */
export interface HandicapUpdateRow {
  competitorId: string;
  expectedVersion: number;
  ircTcc?: number;
  vprsTcc?: number;
  pyNumber?: number;
  nhcStartingTcf?: number;
  echoStartingTcf?: number;
  /** Canonical class name to write — the RYA PY source normalises a boat's
   *  class to the register spelling alongside its PY number. */
  boatClass?: string;
  /** Fleets to add this competitor to (#170) — unioned with current
   *  membership server-side. */
  addFleetIds?: string[];
}

export async function updateHandicaps(
  seriesId: string,
  updates: HandicapUpdateRow[],
  opts: { freezeScoredRaces?: boolean } = {},
): Promise<{ updated: Competitor[] }> {
  return apiFetch<{ updated: Competitor[] }>(
    `/api/v1/series/${seriesId}/competitors/handicaps`,
    { method: 'PATCH', body: { updates, freezeScoredRaces: opts.freezeScoredRaces } },
  );
}

/**
 * ADR-008 Phase 7 — copy a series into another workspace the caller is
 * a member of. Server-only feature; there's no Dexie equivalent because
 * local-first mode has only the implicit "this device" workspace.
 *
 * Returns the new series id in the target workspace. After success,
 * callers typically need to call `authClient.organization.setActive()`
 * to switch the session into the target workspace before navigating
 * to `/series/{newId}/...`.
 */
export async function copySeriesToWorkspace(
  sourceSeriesId: string,
  body: { targetWorkspaceId: string; name?: string },
): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/api/v1/series/${sourceSeriesId}/copy`, {
    method: 'POST',
    body,
  });
}

/**
 * Create a follow-on series in the same workspace: configuration, fleets,
 * and competitors carried over (no races or finishes), progressive starting
 * handicaps seeded from the source's end-of-series TCFs. `seededCount` is
 * how many starting handicaps the server seeded.
 */
export async function createFollowOnSeries(
  sourceSeriesId: string,
  body: { name?: string; startDate?: string },
): Promise<{ id: string; seededCount: number }> {
  return apiFetch<{ id: string; seededCount: number }>(
    `/api/v1/series/${sourceSeriesId}/follow-on`,
    { method: 'POST', body },
  );
}

/**
 * Find or create a fleet by case-insensitive name. Mirror of the Dexie
 * helper used by the CSV competitor importer. The server endpoint wraps
 * the lookup-then-insert in a Postgres transaction guarded by an
 * advisory lock keyed on series id, so concurrent imports never produce
 * duplicate fleets.
 *
 * `scoringSystem` and the alpha defaults apply only when *creating* a
 * new fleet.
 */
export async function ensureFleet(
  seriesId: string,
  name: string,
  options?: {
    scoringSystem?: 'scratch' | 'irc' | 'py' | 'nhc' | 'echo' | 'vprs';
    echoAlpha?: number;
    nhcProfile?: import('./types').NhcProfile;
  },
): Promise<string> {
  const { fleetId } = await apiFetch<{ fleetId: string }>(
    `/api/v1/series/${seriesId}/fleets/ensure`,
    { method: 'POST', body: { name, ...options } },
  );
  return fleetId;
}

// ─── Activity log (#153) ────────────────────────────────────────────────────

/**
 * Reverse-chronological activity feed for the active workspace. Pass a
 * `seriesId` to narrow it to one series (the Activity tab); omit it for the
 * whole workspace. `cursor` pages through older entries.
 */
export function listActivity(opts?: {
  seriesId?: string;
  cursor?: string;
  limit?: number;
}): Promise<{ items: ActivityEntry[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (opts?.seriesId) params.set('seriesId', opts.seriesId);
  if (opts?.cursor) params.set('cursor', opts.cursor);
  if (opts?.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return apiFetch<{ items: ActivityEntry[]; nextCursor: string | null }>(
    `/api/v1/activity${qs ? `?${qs}` : ''}`,
  );
}

/** Latest activity entry per series — feeds the series-list recency strips. */
export async function listRecentActivity(): Promise<ActivityEntry[]> {
  const { items } = await apiFetch<{ items: ActivityEntry[] }>(
    '/api/v1/activity/recent',
  );
  return items;
}

/** Revision history for one series — backs the History tab (#166). */
export async function listRevisions(seriesId: string): Promise<RevisionEntry[]> {
  const { items } = await apiFetch<{ items: RevisionEntry[] }>(
    `/api/v1/series/${seriesId}/revisions`,
  );
  return items;
}

/** Restore a series to an earlier revision (#166). The restore is recorded as
 *  a new revision server-side. */
export async function revertToRevision(
  seriesId: string,
  revisionId: string,
): Promise<void> {
  await apiFetch(`/api/v1/series/${seriesId}/revisions/${revisionId}/revert`, {
    method: 'POST',
  });
}

/** Record a "Saved to file" milestone revision (#166). Satisfies the optional
 *  `SeriesFileRepos` member, called from `saveSeriesFile`. */
export async function recordSaveMilestone(seriesId: string): Promise<void> {
  await apiFetch(`/api/v1/series/${seriesId}/revisions/saved`, { method: 'POST' });
}

/** Create a named checkpoint of the series' current state (#166). */
export async function createCheckpoint(seriesId: string, label: string): Promise<void> {
  await apiFetch(`/api/v1/series/${seriesId}/revisions`, {
    method: 'POST',
    body: { label },
  });
}

/** The series' revision history for embedding in a saved file (#166): readable
 *  metadata + an opaque whole-array zstd snapshot blob. Satisfies the optional
 *  `SeriesFileRepos.exportRevisions` member. */
export async function exportRevisions(
  seriesId: string,
): Promise<{ revisions: SeriesFileRevision[]; revisionSnapshots: string }> {
  return apiFetch<{ revisions: SeriesFileRevision[]; revisionSnapshots: string }>(
    `/api/v1/series/${seriesId}/revisions/export`,
  );
}

/** Restore an embedded revision history into a freshly imported series (#166).
 *  The blob is passed through opaque — decompression happens server-side. */
export async function importRevisions(
  seriesId: string,
  payload: { revisions: SeriesFileRevision[]; revisionSnapshots: string },
): Promise<void> {
  await apiFetch(`/api/v1/series/${seriesId}/revisions/import`, {
    method: 'POST',
    body: payload,
  });
}

/** "Who last edited this competitor" stamp for the edit dialog (#153). */
export function getCompetitorAudit(id: string): Promise<AuditStamp> {
  return apiFetch<AuditStamp>(`/api/v1/competitors/${id}/audit`);
}

// ─── Org-creation requests (#153) ───────────────────────────────────────────

/** The signed-in user's latest org-creation request, or null. */
export async function getMyOrgRequest(): Promise<OrgRequest | null> {
  const { request } = await apiFetch<{ request: OrgRequest | null }>(
    '/api/v1/org-requests',
  );
  return request;
}

/** Submit a request for a shared workspace; the project owner provisions it. */
export function submitOrgRequest(input: {
  requestedName: string;
  note?: string;
}): Promise<OrgRequest> {
  return apiFetch<OrgRequest>('/api/v1/org-requests', {
    method: 'POST',
    body: input,
  });
}

// ─── Cross-series competitor identity (#212) ─────────────────────────────────

/** The active workspace's recurring competitor identities with their arcs. */
export async function listCompetitorIdentities(): Promise<IdentityWithArc[]> {
  const { items } = await apiFetch<{ items: IdentityWithArc[] }>(
    '/api/v1/competitor-identities',
  );
  return items;
}

/** Rename an identity's canonical label; returns the updated arc. */
export function renameCompetitorIdentity(
  id: string,
  label: string,
): Promise<IdentityWithArc> {
  return apiFetch<IdentityWithArc>(`/api/v1/competitor-identities/${id}`, {
    method: 'PATCH',
    body: { label },
  });
}

/** Split a competitor row off an identity; returns the trimmed arc. */
export function unlinkCompetitorFromIdentity(
  id: string,
  competitorId: string,
): Promise<IdentityWithArc> {
  return apiFetch<IdentityWithArc>(
    `/api/v1/competitor-identities/${id}/unlink`,
    { method: 'POST', body: { competitorId } },
  );
}
