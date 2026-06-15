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
