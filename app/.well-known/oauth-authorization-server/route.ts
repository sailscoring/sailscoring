import { metadataResponse } from '@better-auth/oauth-provider';

import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** The ways a client may authenticate at the token and revocation
 *  endpoints, which the provider lists without `none`. */
const AUTH_METHOD_KEYS = [
  'token_endpoint_auth_methods_supported',
  'revocation_endpoint_auth_methods_supported',
] as const;

/**
 * The OAuth authorization server's metadata (RFC 8414), where OAuth
 * libraries look for it: the site root. Better Auth serves its endpoints
 * under /api/auth, so the provider's own handler answers here as well, for
 * an app's library to find the authorize, token and revocation URLs, the
 * scopes, and PKCE's method (ADR-016).
 *
 * The provider advertises `none`, a public client's way of authenticating
 * (PKCE, no secret), only when anyone may register a client. Here only the
 * operator registers them, but public clients are what most apps and the
 * CLI are, and the endpoints accept them, so the document says so.
 */
export async function GET(request: Request): Promise<Response> {
  const doc: Record<string, unknown> = { ...(await auth.api.getOAuthServerConfig({ request, asResponse: false })) };
  for (const key of AUTH_METHOD_KEYS) {
    const methods = Array.isArray(doc[key]) ? (doc[key] as string[]) : [];
    if (!methods.includes('none')) doc[key] = ['none', ...methods];
  }
  return metadataResponse(doc, { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=3600' });
}
