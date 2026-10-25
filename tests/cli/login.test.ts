// @vitest-environment node

/**
 * The CLI's device sign-in and its renewal (ADR-016), routed in process at
 * the real auth handler and route handlers: `auth login` waits for the code
 * to be approved and gets tokens, and a refused access token is renewed once
 * with the refresh token.
 *
 * Skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('@/lib/auth/require-workspace', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/auth/require-workspace')>();
  return { ...original, requireWorkspace: vi.fn() };
});

import { auth } from '@/lib/auth';
import { cliClientId } from '@/lib/auth/oauth';
import { requireWorkspace, workspaceFromHeaders } from '@/lib/auth/require-workspace';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { GET as cliClientGET } from '@/app/api/cli/client/route';
import { GET as seriesListGET } from '@/app/api/v1/series/route';
import { SailscoringClient, type FetchLike } from '@/cli/client';
import { deviceLogin } from '@/cli/commands/login';
import type { OAuthSession } from '@/cli/config';
import { registerApp, removeUser, request, signInFreshUser, type SignedInUser } from '../auth/oauth-helpers';

const DATABASE_URL = process.env.DATABASE_URL;
const BASE = 'http://localhost:3000';

describe.skipIf(!DATABASE_URL)('CLI sign-in', () => {
  let user!: SignedInUser;
  let cliId!: string;
  let lastUserCode: string | undefined;
  const clientIp = `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;

  const transport: FetchLike = async (url, init) => {
    const { pathname } = new URL(url);
    const wrap = async (res: Response) => ({ status: res.status, text: () => res.text() });
    if (pathname === '/api/cli/client') return wrap(await cliClientGET());
    if (pathname.startsWith('/api/auth/')) {
      // A private address of this run's own, so its rate-limit counts are too.
      const headers = { ...init.headers, 'x-forwarded-for': clientIp };
      const res = await auth.handler(new Request(url, { method: init.method, headers, body: init.body }));
      if (pathname === '/api/auth/device/code') {
        const text = await res.text();
        lastUserCode = (JSON.parse(text) as { user_code: string }).user_code;
        return { status: res.status, text: async () => text };
      }
      return wrap(res);
    }
    if (pathname === '/api/v1/series') {
      vi.mocked(requireWorkspace).mockImplementation(() => workspaceFromHeaders(new Headers(init.headers)));
      return wrap(await seriesListGET(new Request(url, { headers: init.headers }) as Parameters<typeof seriesListGET>[0], { params: Promise.resolve({}) }));
    }
    throw new Error(`unexpected ${init.method} ${pathname}`);
  };

  beforeAll(async () => {
    user = await signInFreshUser('cli-login');
    cliId = await registerApp(user, 'cli');
  });

  afterAll(async () => {
    if (cliId) await getDb().delete(schema.oauthClient).where(eq(schema.oauthClient.clientId, cliId));
    if (user) await removeUser(user);
  });

  test('auth login: a code to approve, then tokens, which the CLI renews', async () => {
    const printed: string[] = [];
    let approved = false;
    const session = await deviceLogin(BASE, {
      fetch: transport,
      print: (line) => printed.push(line),
      // The person approves the code in their browser while the CLI waits.
      sleep: async () => {
        if (approved || !lastUserCode) return;
        await request(user, `/api/auth/device?user_code=${lastUserCode}`);
        const res = await request(user, '/api/auth/device/approve', { json: { userCode: lastUserCode } });
        expect(res.status).toBe(200);
        approved = true;
      },
    });
    expect(printed.join('\n')).toContain(`/device?user_code=${lastUserCode}`);
    expect(printed.join('\n')).toContain(`${lastUserCode!.slice(0, 4)}-${lastUserCode!.slice(4)}`);
    expect(session.token).toMatch(/^ssat_/);
    // The server's CLI registration: this test's, or an older one on the database.
    expect(session.oauth.clientId).toBe(await cliClientId());

    // An access token the server refuses (expired, say) is renewed once.
    let renewed: { token: string; oauth: OAuthSession } | undefined;
    const client = new SailscoringClient({
      baseUrl: BASE,
      token: 'ssat_no_longer_valid',
      oauth: session.oauth,
      fetch: transport,
      onRenew: (token, oauth) => {
        renewed = { token, oauth };
      },
    });
    await client.verify();
    expect(renewed?.token).toMatch(/^ssat_/);
    expect(renewed?.oauth.refreshToken).not.toBe(session.oauth.refreshToken);

    // Signed out (the refresh token gone too): the CLI says to sign in again.
    await getDb().delete(schema.oauthRefreshToken).where(eq(schema.oauthRefreshToken.clientId, session.oauth.clientId));
    const stale = new SailscoringClient({
      baseUrl: BASE, token: 'ssat_no_longer_valid', oauth: renewed!.oauth, fetch: transport, onRenew: () => {},
    });
    await expect(stale.verify()).rejects.toThrow(/auth login/);
  });

  test('a server with no CLI registered says so', async () => {
    const none: FetchLike = async (url) => {
      if (new URL(url).pathname === '/api/cli/client') {
        return { status: 404, text: async () => JSON.stringify({ error: 'not-found', message: 'The command line can’t sign in to this server yet: it isn’t registered here.' }) };
      }
      throw new Error('should not get this far');
    };
    await expect(deviceLogin(BASE, { fetch: none, print: () => {}, sleep: async () => {} })).rejects.toThrow(/isn’t registered/);
  });
});
