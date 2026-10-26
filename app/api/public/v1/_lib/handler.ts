import 'server-only';
import type { NextRequest } from 'next/server';
import { ZodError, type z } from 'zod';

import {
  ArchivedError,
  BadRequestError,
  ConflictError,
  NotFoundError,
  RateLimitedError,
  WouldReplaceError,
} from '@/app/api/v1/_lib/handler';
import {
  lookupIdempotency,
  readIdempotencyKey,
  storeIdempotency,
} from '@/app/api/v1/_lib/idempotency';
import { bearerToken, isAccessToken, resolveAppCaller } from '@/lib/auth/app-token';
import { consumeGrantRateLimit } from '@/lib/auth/grant-rate-limit';
import { workspaceGrantable, type AppScope } from '@/lib/auth/oauth';
import {
  ForbiddenError,
  requirePermission,
  resolveWorkspace,
  type Permission,
  type WorkspaceContext,
} from '@/lib/auth/require-workspace';
import { FEATURES } from '@/lib/features';
import { RefusedSettingError } from '@/lib/refused-setting-error';
import type { PublicErrorCode } from '@/lib/validation/public-api-v1';

/**
 * The wrapper for the public API's authenticated part (ADR-016): every
 * route below `/api/public/v1` that acts in a workspace.
 *
 * - Takes an OAuth access token and nothing else: never the session cookie,
 *   never an API key. Without cookies a request from any origin is safe to
 *   answer, so every response allows any origin, and a browser-only app can
 *   call it.
 * - An outside app's token reaches the one workspace its grant names, while
 *   that workspace has the `connected-apps` gate on and the user is still a
 *   member; `x-sailscoring-workspace` may name it, or be left out. The CLI's
 *   token reaches any workspace its user belongs to, named by the header.
 * - The call needs its scope in the grant and its permission in the user's
 *   role there; a grant never reaches past the role.
 * - Answers in the public error envelope: a stable code, a message for a
 *   person, and for `invalid` the fields at fault.
 */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'Retry-After, WWW-Authenticate',
};
const NO_STORE = 'private, no-store';

/** The token is missing, malformed, or one the provider doesn't accept. */
class TokenError extends Error {}

export interface PublicCtx<P> {
  workspace: WorkspaceContext;
  params: P;
}

export interface PublicRouteOptions {
  /** The scope the grant must include. */
  scope: AppScope;
  /** The permission the user's role in the workspace must include. */
  requires: Permission;
}

type Entrypoint<P> = (req: NextRequest, raw: { params: Promise<P> }) => Promise<Response>;

function respond(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      ...(status === 204 ? {} : { 'content-type': 'application/json; charset=utf-8' }),
      'cache-control': NO_STORE,
      ...CORS,
      ...headers,
    },
  });
}

function problem(status: number, error: PublicErrorCode, message?: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response {
  return respond(status, { error, ...(message ? { message } : {}), ...extra }, headers);
}

/** Zod's issues, as the envelope's `problems`: a field path and a message. */
function problemsOf(issues: readonly z.core.$ZodIssue[]): { field: string; message: string }[] {
  return issues.map((i) => ({ field: i.path.map(String).join('.'), message: i.message }));
}

const FORBIDDEN_MESSAGES: Record<string, string> = {
  'workspace-not-a-member': 'You are not a member of that workspace.',
  'workspace-not-granted': 'This app was granted a different workspace.',
  'connected-apps-off': 'Apps can’t be connected to this workspace at the moment.',
  'no-workspace': 'You are not a member of any workspace.',
  'no-active-workspace': 'Name a workspace in the x-sailscoring-workspace header.',
  'submission-not-yours': 'Someone else made this submission; only they can revise or withdraw it.',
};

function forbiddenMessage(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  if (reason.startsWith('permission-denied:')) {
    return `Your role in this workspace doesn’t allow this (it needs ${reason.slice('permission-denied:'.length)}).`;
  }
  if (reason.startsWith('feature-disabled:')) {
    const key = reason.slice('feature-disabled:'.length);
    const label = (FEATURES as Record<string, { label: string } | undefined>)[key]?.label ?? key;
    return `This workspace doesn’t have ${label.toLowerCase()} switched on.`;
  }
  if (reason.startsWith('insufficient-scope:')) {
    return `This app wasn’t granted the ${reason.slice('insufficient-scope:'.length)} scope.`;
  }
  return FORBIDDEN_MESSAGES[reason] ?? reason;
}

export function publicErrorResponse(err: unknown): Response {
  if (err instanceof TokenError) {
    return problem(401, 'unauthenticated', err.message, {}, {
      'www-authenticate': 'Bearer realm="sailscoring", error="invalid_token"',
    });
  }
  if (err instanceof ForbiddenError) {
    const scope = err.reason?.startsWith('insufficient-scope:');
    return problem(403, 'forbidden', forbiddenMessage(err.reason), {}, scope
      ? { 'www-authenticate': `Bearer realm="sailscoring", error="insufficient_scope", scope="${err.reason!.split(':')[1]}"` }
      : {});
  }
  if (err instanceof NotFoundError) {
    return problem(404, 'not-found', err.resource ? `No such ${err.resource.split(' ')[0]}.` : undefined);
  }
  if (err instanceof ConflictError) {
    return problem(409, 'conflict', 'It was changed since you read it; read it again and retry.');
  }
  if (err instanceof WouldReplaceError) return problem(409, 'conflict', err.message);
  if (err instanceof ArchivedError) {
    const why = { 'series-archived': 'The series is archived.', 'series-as-published': 'The series is an archive, kept as published.', 'series-final': 'The series’ results are final.' };
    return problem(423, 'archived', why[err.reason]);
  }
  if (err instanceof BadRequestError) {
    const issues = Array.isArray(err.issues) ? problemsOf(err.issues as z.core.$ZodIssue[]) : undefined;
    return problem(400, 'invalid', err.message, issues ? { problems: issues } : {});
  }
  if (err instanceof ZodError) {
    return problem(400, 'invalid', 'The request body isn’t what this call takes.', { problems: problemsOf(err.issues) });
  }
  if (err instanceof RefusedSettingError) return problem(400, 'invalid', err.message);
  if (err instanceof RateLimitedError) {
    return problem(429, 'rate-limited', `Too many calls; try again in ${err.retryAfterSeconds}s.`, {}, {
      'retry-after': String(err.retryAfterSeconds),
    });
  }
  console.error('unhandled public API error:', err);
  return problem(500, 'internal');
}

/** Resolve the request's caller to the workspace it acts in, or throw. */
async function authenticate(req: NextRequest, options: PublicRouteOptions): Promise<WorkspaceContext> {
  const token = bearerToken(req.headers);
  if (!token) {
    throw new TokenError('Send an OAuth access token: Authorization: Bearer <token>.');
  }
  if (!isAccessToken(token)) {
    throw new TokenError('This API takes an OAuth access token, not an API key.');
  }
  const caller = await resolveAppCaller(token);
  if (!caller) {
    throw new TokenError('The access token isn’t valid: it may have expired or been revoked.');
  }
  const retryAfter = await consumeGrantRateLimit(caller);
  if (retryAfter !== null) throw new RateLimitedError(retryAfter);
  if (!caller.scopes.includes(options.scope)) {
    throw new ForbiddenError(`insufficient-scope:${options.scope}`);
  }

  const named = req.headers.get('x-sailscoring-workspace') ?? undefined;
  let workspace: WorkspaceContext;
  if (caller.firstParty) {
    workspace = await resolveWorkspace({
      userId: caller.userId,
      email: caller.email,
      activeOrganizationId: null,
      workspaceOverride: named,
    });
  } else {
    if (!caller.workspaceId) throw new TokenError('The access token names no workspace.');
    workspace = await resolveWorkspace({
      userId: caller.userId,
      email: caller.email,
      activeOrganizationId: null,
      workspaceOverride: named ?? caller.workspaceId,
    });
    if (workspace.workspaceId !== caller.workspaceId) throw new ForbiddenError('workspace-not-granted');
    // Checked on every call, so turning the gate off cuts apps off at once.
    if (!(await workspaceGrantable(caller.userId, caller.workspaceId))) {
      throw new ForbiddenError('connected-apps-off');
    }
    workspace.via = { clientId: caller.clientId, name: caller.clientName };
  }
  requirePermission(workspace, options.requires);
  return workspace;
}

export function publicRoute<P = Record<string, never>>(
  handler: (req: NextRequest, ctx: PublicCtx<P>) => Promise<unknown>,
  options: PublicRouteOptions,
): Entrypoint<P> {
  return async (req, raw) => {
    try {
      const workspace = await authenticate(req, options);
      const params = await raw.params;
      // Idempotency-Key replay, for writes, kept apart from /api/v1's keys.
      const key = req.method !== 'GET' ? readIdempotencyKey(req) : null;
      const stored = key ? `public-v1:${key}` : null;
      if (stored) {
        const hit = await lookupIdempotency(workspace.workspaceId, stored);
        if (hit) return respond(hit.status, hit.body);
      }
      const result = await handler(req, { workspace, params });
      const status = result === undefined || result === null ? 204 : 200;
      if (stored) await storeIdempotency(workspace.workspaceId, stored, status, status === 204 ? null : result);
      return respond(status, result);
    } catch (err) {
      return publicErrorResponse(err);
    }
  };
}

/** A route's answer to a CORS preflight. */
export function publicPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS,
      'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'access-control-allow-headers':
        'Authorization, Content-Type, X-Sailscoring-Workspace, Idempotency-Key, If-Match',
      'access-control-max-age': '86400',
    },
  });
}

/** The request's JSON body, parsed with `schema`; refused as `invalid`. */
export async function readBody<T>(req: NextRequest, schema: { parse: (v: unknown) => T }): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new BadRequestError('The request body isn’t JSON.');
  }
  return schema.parse(body);
}

/** `If-Match` as a version number, where one was sent. */
export function ifMatch(req: NextRequest): number | undefined {
  const raw = req.headers.get('if-match')?.replace(/^"|"$/g, '').trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n > 0 ? n : undefined;
}
