import 'server-only';

/**
 * Cursor pagination utilities. The cursor is opaque — base64 of
 * `<createdAtMs>:<id>` — so internals never leak to clients. List
 * endpoints accept `?cursor=&limit=`; default limit 50, max 100.
 */

export interface PageRequest {
  cursor: { createdAtMs: number; id: string } | null;
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

export function encodeCursor(row: { createdAt: number; id: string }): string {
  return Buffer.from(`${row.createdAt}:${row.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(encoded: string): { createdAtMs: number; id: string } | null {
  try {
    const raw = Buffer.from(encoded, 'base64url').toString('utf8');
    const sep = raw.indexOf(':');
    if (sep < 0) return null;
    const createdAtMs = Number.parseInt(raw.slice(0, sep), 10);
    const id = raw.slice(sep + 1);
    if (!Number.isFinite(createdAtMs) || !id) return null;
    return { createdAtMs, id };
  } catch {
    return null;
  }
}
