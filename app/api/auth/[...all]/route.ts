import { toNextJsHandler } from 'better-auth/next-js';

import { auth } from '@/lib/auth';
import { rateLimitedVerifyRedirect } from '@/lib/auth/verify-rate-limit';

const handlers = toNextJsHandler(auth.handler);

/**
 * An app with no server of its own (a public client: PKCE, no secret) calls
 * the OAuth token and revocation endpoints with fetch from its own page, and
 * the browser lets it read the reply only with CORS. Any origin may: neither
 * endpoint reads cookies, so what authorizes a call is the code and its
 * verifier, or the token being revoked, never where the call came from.
 */
const CORS_PATHS = new Set(['/api/auth/oauth2/token', '/api/auth/oauth2/revoke']);

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'WWW-Authenticate',
};

function isCorsPath(request: Request): boolean {
  return CORS_PATHS.has(new URL(request.url).pathname);
}

export async function POST(request: Request): Promise<Response> {
  const response = await handlers.POST(request);
  if (!isCorsPath(request)) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** The preflight a browser sends before a call it can't make plainly, such
 *  as one with an `Authorization` header. Elsewhere, what Next answers
 *  for a route with no OPTIONS handler. */
export function OPTIONS(request: Request): Response {
  if (!isCorsPath(request)) {
    return new Response(null, { status: 204, headers: { allow: 'GET, HEAD, OPTIONS, POST' } });
  }
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'Authorization, Content-Type, DPoP',
      'access-control-max-age': '86400',
    },
  });
}

/**
 * Magic-link verify arrives here as a top-level navigation, so any response
 * that isn't a redirect is something the user reads in the address bar. The
 * rate limiter answers before the endpoint runs and its 429 carries a JSON
 * body, which is why it needs translating into the same `/sign-in?error=…`
 * redirect every other verify failure produces.
 */
export async function GET(request: Request): Promise<Response> {
  const response = await handlers.GET(request);
  return rateLimitedVerifyRedirect(request, response) ?? response;
}
