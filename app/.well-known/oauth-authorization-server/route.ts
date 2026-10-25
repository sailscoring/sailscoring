import { oauthProviderAuthServerMetadata } from '@better-auth/oauth-provider';

import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * The OAuth authorization server's metadata (RFC 8414), where OAuth
 * libraries look for it: the site root. Better Auth serves its endpoints
 * under /api/auth, so the provider's own handler answers here as well, for
 * an app's library to find the authorize, token and revocation URLs, the
 * scopes, and PKCE's method (ADR-016).
 */
export const GET = oauthProviderAuthServerMetadata(auth, {
  headers: { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=3600' },
});
