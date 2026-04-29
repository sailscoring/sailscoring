import 'server-only';
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';

import {
  ForbiddenError,
  UnauthenticatedError,
  requireWorkspace,
  type WorkspaceContext,
} from '@/lib/auth/require-workspace';

import {
  lookupIdempotency,
  readIdempotencyKey,
  storeIdempotency,
} from './idempotency';

/**
 * Common wrapper for `/api/v1` route handlers.
 *
 * - Resolves the active workspace via `requireWorkspace`. The repository
 *   layer is the second line of tenancy enforcement (CVE-2025-29927 made
 *   middleware-only auth a known failure mode).
 * - Awaits Next.js 16's Promise-shaped `params` once at the top so route
 *   logic stays sync about its inputs.
 * - Maps thrown errors to canonical HTTP responses: 401 unauthenticated,
 *   403 forbidden, 404 not-found, 409 conflict, 400 invalid (Zod issues).
 * - A handler that returns `undefined` becomes a 204 No Content; any other
 *   value becomes a JSON 200.
 */

export class NotFoundError extends Error {
  constructor(public readonly resource?: string) {
    super(resource ? `not-found: ${resource}` : 'not-found');
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(public readonly detail?: unknown) {
    super('conflict');
    this.name = 'ConflictError';
  }
}

export class BadRequestError extends Error {
  constructor(message: string, public readonly issues?: unknown) {
    super(message);
    this.name = 'BadRequestError';
  }
}

export interface HandlerCtx<P> {
  workspace: WorkspaceContext;
  params: P;
}

export type RouteHandler<P, R> = (
  req: NextRequest,
  ctx: HandlerCtx<P>,
) => Promise<R>;

export type RouteEntrypoint<P> = (
  req: NextRequest,
  raw: { params: Promise<P> },
) => Promise<Response>;

export function workspaceRoute<P, R>(
  handler: RouteHandler<P, R>,
): RouteEntrypoint<P> {
  return async (req, raw) => {
    try {
      const workspace = await requireWorkspace();
      const params = await raw.params;

      // Idempotency-Key replay (write methods only). The header is
      // ignored on GET because reads are naturally idempotent.
      const idemKey =
        req.method !== 'GET' ? readIdempotencyKey(req) : null;
      if (idemKey) {
        const hit = await lookupIdempotency(workspace.workspaceId, idemKey);
        if (hit) return jsonResponse(hit.status, hit.body);
      }

      const result = await handler(req, { workspace, params });
      const status = result === undefined || result === null ? 204 : 200;
      const body = status === 204 ? null : result;
      if (idemKey) {
        await storeIdempotency(workspace.workspaceId, idemKey, status, body);
      }
      return status === 204
        ? new Response(null, { status: 204 })
        : Response.json(result);
    } catch (err) {
      return errorToResponse(err);
    }
  };
}

function jsonResponse(status: number, body: unknown): Response {
  if (status === 204 || body === null) return new Response(null, { status });
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function errorToResponse(err: unknown): Response {
  if (err instanceof UnauthenticatedError) {
    return Response.json({ error: 'unauthenticated' }, { status: 401 });
  }
  if (err instanceof ForbiddenError) {
    return Response.json({ error: 'forbidden', reason: err.reason }, { status: 403 });
  }
  if (err instanceof NotFoundError) {
    return Response.json({ error: 'not-found', resource: err.resource }, { status: 404 });
  }
  if (err instanceof ConflictError) {
    return Response.json({ error: 'conflict', detail: err.detail }, { status: 409 });
  }
  if (err instanceof BadRequestError) {
    return Response.json({ error: 'invalid', issues: err.issues, message: err.message }, { status: 400 });
  }
  if (err instanceof ZodError) {
    return Response.json({ error: 'invalid', issues: err.issues }, { status: 400 });
  }
  console.error('unhandled route error:', err);
  return Response.json({ error: 'internal' }, { status: 500 });
}

/** Parse a JSON body and validate with the given Zod schema; throws BadRequestError. */
export async function readJson<T>(req: NextRequest, schema: { parse: (v: unknown) => T }): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new BadRequestError('invalid json body');
  }
  try {
    return schema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new BadRequestError('schema validation failed', err.issues);
    }
    throw err;
  }
}
