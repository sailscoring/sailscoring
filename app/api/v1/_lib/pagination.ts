import 'server-only';

/**
 * Cursor pagination utilities. The cursor is opaque — base64 of
 * `<createdAtUs>:<id>` — so internals never leak to clients. List
 * endpoints accept `?cursor=&limit=`; default limit 50, max 100.
 *
 * The time is in microseconds, Postgres's own precision: a cursor rounded to
 * the millisecond skips every row written earlier in the same millisecond as
 * the last row of the page, which a fast run of inserts reaches.
 */

export interface PageRequest {
  cursor: { createdAtUs: number; id: string } | null;
  limit: number;
}

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

export function readPageRequest(searchParams: URLSearchParams): PageRequest {
  const limitRaw = Number.parseInt(searchParams.get('limit') ?? '', 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(limitRaw, MAX_LIMIT)
    : DEFAULT_LIMIT;
  const cursorParam = searchParams.get('cursor');
  return { cursor: cursorParam ? decodeCursor(cursorParam) : null, limit };
}

export function encodeCursor(row: { createdAtUs: number; id: string }): string {
  return Buffer.from(`${row.createdAtUs}:${row.id}`, 'utf8').toString('base64url');
}

/** Below this, a cursor's time is in milliseconds: one handed out before the
 *  cursor moved to microseconds (a page loaded then, paged now). 1e14 µs is
 *  1973; 1e14 ms is millennia away. */
const LEGACY_MS_BELOW = 1e14;

export function decodeCursor(encoded: string): { createdAtUs: number; id: string } | null {
  try {
    const raw = Buffer.from(encoded, 'base64url').toString('utf8');
    const sep = raw.indexOf(':');
    if (sep < 0) return null;
    const time = Number.parseInt(raw.slice(0, sep), 10);
    const id = raw.slice(sep + 1);
    if (!Number.isFinite(time) || !id) return null;
    return { createdAtUs: time < LEGACY_MS_BELOW ? time * 1000 : time, id };
  } catch {
    return null;
  }
}
