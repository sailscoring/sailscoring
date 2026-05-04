/**
 * Thin fetch wrapper for the /api/v1 surface used by lib/api-repository.ts.
 * Maps HTTP status codes to typed errors so callers can `instanceof`-check
 * their way to UX decisions in Phase 3 / 4.
 */

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export class AuthError extends ApiError {
  constructor() {
    super('unauthenticated', 401);
    this.name = 'AuthError';
  }
}

export class ForbiddenApiError extends ApiError {
  constructor(public readonly reason?: string) {
    super(reason ? `forbidden: ${reason}` : 'forbidden', 403);
    this.name = 'ForbiddenApiError';
  }
}

export class NotFoundApiError extends ApiError {
  constructor(public readonly resource?: string) {
    super(resource ? `not-found: ${resource}` : 'not-found', 404);
    this.name = 'NotFoundApiError';
  }
}

/**
 * Mirror of the server-side `ConflictError.detail` envelope. Optional
 * everywhere — older endpoints only carry `expectedVersion` /
 * `currentVersion`. The actor field is reserved for ADR-008 Phase 7.
 */
export interface ConflictDetail {
  expectedVersion?: number;
  currentVersion?: number;
  /** ISO-8601; the row's `updated_at` at the moment of conflict. */
  updatedAt?: string;
  actor?: { id: string; email?: string; displayName?: string };
}

export class ConflictApiError extends ApiError {
  constructor(public readonly detail?: ConflictDetail) {
    super('conflict', 409);
    this.name = 'ConflictApiError';
  }
}

export class ValidationApiError extends ApiError {
  constructor(public readonly issues?: unknown) {
    super('invalid', 400);
    this.name = 'ValidationApiError';
  }
}

export interface ApiFetchOptions {
  method?: string;
  body?: unknown;
  /** Sets Idempotency-Key on writes. Defaults to a fresh UUID for non-GET methods. */
  idempotencyKey?: string | null;
  /**
   * Compare-and-swap token (ADR-008 Phase 4). When set, sent as
   * `If-Match: <version>` on the request; the server-side route handler
   * reads it and threads it into the repository as `expectedVersion`.
   * Mismatches return 409 → `ConflictApiError`.
   */
  expectedVersion?: number;
  /** Returning `null` instead of throwing on 404. Used by `get(id)` lookups. */
  allow404?: boolean;
  /** Custom Zod-shaped validator. */
  schema?: { parse: (v: unknown) => unknown };
}

export async function apiFetch<T = unknown>(
  path: string,
  opts: ApiFetchOptions = {},
): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  if (method !== 'GET' && opts.idempotencyKey !== null) {
    headers['idempotency-key'] = opts.idempotencyKey ?? crypto.randomUUID();
  }
  if (opts.expectedVersion !== undefined) {
    headers['if-match'] = String(opts.expectedVersion);
  }

  const res = await fetch(path, {
    method,
    headers,
    body,
    credentials: 'same-origin',
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let parsed: unknown = undefined;
  if (text.length > 0) {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }

  if (!res.ok) {
    const errBody = parsed as { error?: string; reason?: string; resource?: string; issues?: unknown; detail?: unknown } | string | undefined;
    if (res.status === 404 && opts.allow404) return undefined as T;
    if (res.status === 401) throw new AuthError();
    if (res.status === 403) throw new ForbiddenApiError(typeof errBody === 'object' ? errBody?.reason : undefined);
    if (res.status === 404) throw new NotFoundApiError(typeof errBody === 'object' ? errBody?.resource : undefined);
    if (res.status === 409) throw new ConflictApiError(typeof errBody === 'object' ? errBody?.detail as ConflictDetail | undefined : undefined);
    if (res.status === 400) throw new ValidationApiError(typeof errBody === 'object' ? errBody?.issues : undefined);
    throw new ApiError(`HTTP ${res.status}`, res.status);
  }

  if (opts.schema) {
    return opts.schema.parse(parsed) as T;
  }
  return parsed as T;
}
