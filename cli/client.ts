/**
 * ADR-009 M3 — the CLI's `/api/v1` client. A thin typed wrapper over `fetch`
 * that presents the Bearer token and the workspace header. `fetch` is
 * injectable so tests can route calls at the real route handler without a
 * network.
 */

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; text: () => Promise<string> }>;

export interface ClientOptions {
  baseUrl: string;
  token: string;
  /** Default workspace (slug or id) sent as `x-sailscoring-workspace`. */
  workspace?: string;
  fetch?: FetchLike;
}

/** A non-2xx response from the API, carrying the parsed error envelope. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class SailscoringClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly workspace?: string;
  private readonly doFetch: FetchLike;

  constructor(opts: ClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.token = opts.token;
    this.workspace = opts.workspace;
    this.doFetch = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  }

  private async request(
    method: string,
    path: string,
    opts?: { body?: unknown; idempotencyKey?: string },
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.token}`,
    };
    if (this.workspace) headers['x-sailscoring-workspace'] = this.workspace;
    if (opts?.body !== undefined) headers['content-type'] = 'application/json';
    if (opts?.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;

    const res = await this.doFetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(opts?.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    const raw = await res.text();
    const parsed = raw ? safeJson(raw) : undefined;
    if (res.status < 200 || res.status >= 300) {
      throw new ApiError(res.status, parsed, errorMessage(res.status, parsed));
    }
    return parsed;
  }

  /** Cheap authenticated read used to validate a token at login. */
  async verify(): Promise<void> {
    await this.request('GET', '/api/v1/series');
  }

  /** Import one `.sailscoring` file's text; returns the new series id. */
  async importSeries(
    content: string,
    opts: { idempotencyKey: string },
  ): Promise<{ id: string }> {
    const result = (await this.request('POST', '/api/v1/series/import', {
      body: { content },
      idempotencyKey: opts.idempotencyKey,
    })) as { id: string };
    return result;
  }

  /**
   * Publish a series' current standings. `input.slug` co-publishes into a
   * shared namespace; `input.join` confirms joining a slug that already holds
   * other series. Returns the slug and per-fleet public URLs.
   */
  async publishSeries(
    seriesId: string,
    input: PublishRequest,
  ): Promise<PublishResponse> {
    return (await this.request('POST', `/api/v1/series/${seriesId}/publish`, {
      body: input,
    })) as PublishResponse;
  }

  /** Remove a series' published pages. A series with no publication is a no-op. */
  async unpublishSeries(seriesId: string): Promise<void> {
    await this.request('DELETE', `/api/v1/series/${seriesId}/publish`);
  }

  /** Workspace categories (series-list organisation). */
  async listCategories(): Promise<{ items: Category[] }> {
    return (await this.request('GET', '/api/v1/categories')) as { items: Category[] };
  }

  /** Create a category; returns it. */
  async createCategory(name: string): Promise<Category> {
    return (await this.request('POST', '/api/v1/categories', { body: { name } })) as Category;
  }

  /** Move a series into a category (or `null` for uncategorised). Blocked on an
   *  archived series — categorise before you archive. */
  async setSeriesCategory(seriesId: string, categoryId: string | null): Promise<void> {
    await this.request('POST', `/api/v1/series/${seriesId}/category`, {
      body: { categoryId },
    });
  }

  /** The workspace's cross-series competitor identities (#212). Requires
   *  the workspace to have the competitor-reconcile feature. */
  async listIdentities(): Promise<{ items: IdentityListItem[] }> {
    return (await this.request(
      'GET',
      '/api/v1/competitor-identities',
    )) as { items: IdentityListItem[] };
  }

  /** Upsert one as-published series from its ingest document (ADR-010).
   *  `convert` replaces an existing full-fidelity series (the migration
   *  path); `force` re-applies an unchanged document. */
  async putArchiveSeries(
    seriesId: string,
    doc: unknown,
    opts: { convert?: boolean; force?: boolean } = {},
  ): Promise<ArchiveIngestResponse> {
    const params = new URLSearchParams();
    if (opts.convert) params.set('convert', '1');
    if (opts.force) params.set('force', '1');
    const qs = params.size > 0 ? `?${params.toString()}` : '';
    return (await this.request(
      'PUT',
      `/api/v1/archive/series/${seriesId}${qs}`,
      { body: doc },
    )) as ArchiveIngestResponse;
  }

  /** Remove an as-published series (publication and all). */
  async deleteArchiveSeries(seriesId: string): Promise<void> {
    await this.request('DELETE', `/api/v1/archive/series/${seriesId}`);
  }

  /** Delete a series and every child row (the schema cascades). */
  async deleteSeries(seriesId: string): Promise<void> {
    await this.request('DELETE', `/api/v1/series/${seriesId}`);
  }

  /** Apply the archive repo's identity manifest + the scoped auto-pass. */
  async applyArchiveIdentities(
    manifest: unknown,
  ): Promise<ArchiveIdentitiesResponse> {
    return (await this.request('POST', '/api/v1/archive/identities', {
      body: manifest,
    })) as ArchiveIdentitiesResponse;
  }

  /** Archive or unarchive a series. */
  async setSeriesArchived(seriesId: string, archived: boolean): Promise<void> {
    await this.request('POST', `/api/v1/series/${seriesId}/archive`, {
      body: { archived },
    });
  }

  /** Rewrite the workspace's series `displayOrder` to match `orderedIds`. Ids
   *  not listed keep their current order, so pass the full set for a clean
   *  total order. Drives the series-list order and the shared-slug published
   *  index order. */
  async reorderSeries(orderedIds: string[]): Promise<void> {
    await this.request('POST', '/api/v1/series/reorder', {
      body: { orderedIds },
    });
  }

  // ── Reads (ADR-009 M4). Returned shapes are passed straight to output, so
  //    they stay `unknown` here; the generated TS SDK (M6) will type them. ──

  /** The caller's identity + active workspace (role, features). */
  whoami(): Promise<unknown> {
    return this.request('GET', '/api/v1/workspace');
  }

  listSeries(): Promise<unknown> {
    return this.request('GET', '/api/v1/series');
  }

  getSeries(seriesId: string): Promise<unknown> {
    return this.request('GET', `/api/v1/series/${seriesId}`);
  }

  listFleets(seriesId: string): Promise<unknown> {
    return this.request('GET', `/api/v1/series/${seriesId}/fleets`);
  }

  listCompetitors(seriesId: string): Promise<unknown> {
    return this.request('GET', `/api/v1/series/${seriesId}/competitors`);
  }

  listRaces(seriesId: string): Promise<unknown> {
    return this.request('GET', `/api/v1/series/${seriesId}/races`);
  }

  listSubSeries(seriesId: string): Promise<unknown> {
    return this.request('GET', `/api/v1/series/${seriesId}/sub-series`);
  }

  /** Computed standings (the public-export JSON). */
  getStandings(seriesId: string): Promise<unknown> {
    return this.request('GET', `/api/v1/series/${seriesId}/standings`);
  }

  /** This series' publication status (slug + live fleet URLs), if any. */
  getPublication(seriesId: string): Promise<unknown> {
    return this.request('GET', `/api/v1/series/${seriesId}/publish`);
  }

  listPublished(): Promise<unknown> {
    return this.request('GET', '/api/v1/published');
  }

  listActivity(seriesId?: string): Promise<unknown> {
    const q = seriesId ? `?seriesId=${encodeURIComponent(seriesId)}` : '';
    return this.request('GET', `/api/v1/activity${q}`);
  }
}

export interface Category {
  id: string;
  name: string;
}

/** The identity list's row shape as the CLI consumes it (a subset of the
 *  server's IdentityWithArc; extra fields flow through untouched in --json). */
export interface IdentityListItem {
  id: string;
  slug: string | null;
  label: string;
  club: string | null;
  managedBy: string;
  firstYear: number | null;
  lastYear: number | null;
  entries: Array<{ seriesId: string; seriesName: string; sailNumber: string }>;
}

export interface ArchiveIngestResponse {
  seriesId: string;
  unchanged: boolean;
  published: {
    slug: string;
    pages: Array<{ fleetName: string; subPath: string }>;
  } | null;
}

export interface ArchiveIdentitiesResponse {
  manifest: {
    identitiesWritten: number;
    competitorsLinked: number;
    unresolvedMembers: number;
    duplicateSlugs: string[];
  };
  autoPass: {
    identitiesCreated: number;
    competitorsLinked: number;
    conflictsSkipped: number;
  };
  slugsBackfilled: number;
  orphansRemoved: number;
}

export interface PublishRequest {
  slug?: string;
  join?: boolean;
  fleets?: string[];
  subPaths?: Record<string, string>;
  defaultSubPath?: string;
}

export interface PublishResponse {
  slug: string;
  pages: { fleetName: string; subSeriesName?: string; url: string }[];
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function errorMessage(status: number, body: unknown): string {
  if (status === 401) return 'unauthenticated — check the token (sailscoring auth login)';
  if (status === 403) return 'forbidden — the token is not a member of that workspace';
  if (body && typeof body === 'object' && 'message' in body) {
    return `request failed (${status}): ${String((body as { message: unknown }).message)}`;
  }
  if (body && typeof body === 'object' && 'error' in body) {
    return `request failed (${status}): ${String((body as { error: unknown }).error)}`;
  }
  return `request failed (${status})`;
}
