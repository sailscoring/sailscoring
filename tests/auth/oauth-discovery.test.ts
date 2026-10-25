// @vitest-environment node

/**
 * The OAuth discovery document at the site root (RFC 8414), where an app's
 * OAuth library looks for it (ADR-016).
 *
 * Skipped when DATABASE_URL is unset; the auth module needs one.
 */
import { describe, expect, test } from 'vitest';

import { GET } from '@/app/.well-known/oauth-authorization-server/route';
import { GET as GET_FOR_ISSUER } from '@/app/.well-known/oauth-authorization-server/api/auth/route';

describe.skipIf(!process.env.DATABASE_URL)('OAuth discovery', () => {
  test('names the endpoints, scopes and PKCE method an app needs', async () => {
    const res = await GET(new Request('http://localhost:3000/.well-known/oauth-authorization-server'));
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const doc = (await res.json()) as Record<string, unknown>;
    expect(doc).toMatchObject({
      authorization_endpoint: expect.stringMatching(/\/api\/auth\/oauth2\/authorize$/),
      token_endpoint: expect.stringMatching(/\/api\/auth\/oauth2\/token$/),
      revocation_endpoint: expect.stringMatching(/\/api\/auth\/oauth2\/revoke$/),
      code_challenge_methods_supported: ['S256'],
    });
    expect(doc.scopes_supported).toEqual(expect.arrayContaining(['read', 'races', 'publish', 'offline_access']));
  });

  test('is served where RFC 8414 puts it for the issuer’s path too', async () => {
    const res = await GET_FOR_ISSUER(new Request('http://localhost:3000/.well-known/oauth-authorization-server/api/auth'));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { issuer: string }).issuer).toMatch(/\/api\/auth$/);
  });
});
