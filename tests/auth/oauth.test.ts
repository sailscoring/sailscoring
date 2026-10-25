// @vitest-environment node

/**
 * OAuth for outside apps and the CLI (ADR-016), end to end through
 * `auth.handler`: an app's grant reaches one workspace, and only one the
 * user may grant; the CLI's device sign-in reaches every workspace; tokens
 * resolve to who, which app and how far; and nobody but the operator can
 * register an app.
 *
 * Skipped when DATABASE_URL is unset; CI provides it. Locally run with
 * `pnpm test:unit:db tests/auth/oauth.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { ACCESS_TOKEN_PREFIX, REFRESH_TOKEN_PREFIX } from '@/lib/auth/oauth';
import { workspaceFromHeaders } from '@/lib/auth/require-workspace';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import {
  deviceSignIn,
  exchange,
  grantApp,
  registerApp,
  removeUser,
  request,
  setConnectedApps,
  signInFreshUser,
  type SignedInUser,
} from './oauth-helpers';

const DATABASE_URL = process.env.DATABASE_URL;

const resolve = (token: string) => auth.api.resolveAccessToken({ body: { token } });

describe.skipIf(!DATABASE_URL)('OAuth for outside apps and the CLI', () => {
  let user!: SignedInUser;
  let appId!: string;
  let cliId!: string;

  beforeAll(async () => {
    user = await signInFreshUser('oauth');
    await setConnectedApps(user.personalWorkspaceId, true);
    appId = await registerApp(user, 'app');
    cliId = await registerApp(user, 'cli');
  });

  afterAll(async () => {
    const db = getDb();
    for (const id of [appId, cliId]) {
      if (id) await db.delete(schema.oauthClient).where(eq(schema.oauthClient.clientId, id));
    }
    if (user) await removeUser(user);
  });

  test('an app granted a workspace gets tokens that resolve to that workspace', async () => {
    const tokens = await grantApp(user, appId, user.personalWorkspaceId, 'read races offline_access');
    expect(tokens.accessToken.startsWith(ACCESS_TOKEN_PREFIX)).toBe(true);
    expect(tokens.refreshToken.startsWith(REFRESH_TOKEN_PREFIX)).toBe(true);
    expect(await resolve(tokens.accessToken)).toEqual({
      userId: user.userId,
      clientId: appId,
      clientName: expect.stringMatching(/^Test app/),
      firstParty: false,
      scopes: ['read', 'races', 'offline_access'],
      workspaceId: user.personalWorkspaceId,
    });

    // A refreshed token keeps the grant's workspace and scopes.
    const refreshed = await exchange({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: appId,
    });
    expect((await resolve(refreshed.accessToken))?.workspaceId).toBe(user.personalWorkspaceId);
  });

  test('a workspace without connected apps cannot be granted', async () => {
    await setConnectedApps(user.personalWorkspaceId, false);
    try {
      await expect(grantApp(user, appId, user.personalWorkspaceId)).rejects.toThrow(/not the consent page/);
    } finally {
      await setConnectedApps(user.personalWorkspaceId, true);
    }
  });

  test('a revoked token, a disabled app and a made-up token resolve to nothing', async () => {
    const tokens = await grantApp(user, appId, user.personalWorkspaceId);
    const revoked = await request(null, '/api/auth/oauth2/revoke', {
      form: { token: tokens.accessToken, token_type_hint: 'access_token', client_id: appId },
    });
    expect(revoked.status).toBe(200);
    expect(await resolve(tokens.accessToken)).toBeNull();

    const other = await grantApp(user, appId, user.personalWorkspaceId);
    await getDb().update(schema.oauthClient).set({ disabled: true }).where(eq(schema.oauthClient.clientId, appId));
    try {
      expect(await resolve(other.accessToken)).toBeNull();
    } finally {
      await getDb().update(schema.oauthClient).set({ disabled: false }).where(eq(schema.oauthClient.clientId, appId));
    }

    expect(await resolve(`${ACCESS_TOKEN_PREFIX}not-a-real-token`)).toBeNull();
    expect(await resolve('not-even-prefixed')).toBeNull();
  });

  test('signing out ends the access token, and a refresh gives the app another', async () => {
    const other = await signInFreshUser('oauth-signout');
    try {
      await setConnectedApps(other.personalWorkspaceId, true);
      const tokens = await grantApp(other, appId, other.personalWorkspaceId);
      const out = await request(other, '/api/auth/sign-out', { json: {} });
      expect(out.status).toBe(200);
      expect(await resolve(tokens.accessToken)).toBeNull();
      const again = await exchange({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken, client_id: appId });
      expect((await resolve(again.accessToken))?.workspaceId).toBe(other.personalWorkspaceId);
    } finally {
      await removeUser(other);
    }
  });

  test('a lapsed session takes the app’s access with it', async () => {
    const other = await signInFreshUser('oauth-lapse');
    try {
      await setConnectedApps(other.personalWorkspaceId, true);
      const tokens = await grantApp(other, appId, other.personalWorkspaceId);
      await getDb()
        .update(schema.session)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.session.userId, other.userId));
      expect(await resolve(tokens.accessToken)).toBeNull();
      const again = await exchange({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken, client_id: appId });
      expect(await resolve(again.accessToken)).toBeNull();
    } finally {
      await removeUser(other);
    }
  });

  test('the CLI signs in with the device grant, for every workspace', async () => {
    const tokens = await deviceSignIn(user, cliId);
    expect(await resolve(tokens.accessToken)).toEqual({
      userId: user.userId,
      clientId: cliId,
      clientName: 'Sail Scoring CLI',
      firstParty: true,
      scopes: ['read', 'races', 'publish', 'offline_access'],
    });
  });

  test('an outside app cannot use the device grant', async () => {
    const res = await request(null, '/api/auth/device/code', { form: { client_id: appId, scope: 'read' } });
    expect(res.status).toBe(400);
  });

  test('users cannot register apps themselves', async () => {
    const created = await request(user, '/api/auth/oauth2/create-client', {
      json: { client_name: 'Mine', redirect_uris: ['https://example.com/cb'] },
    });
    expect(created.status).toBe(401);
    const registered = await request(user, '/api/auth/oauth2/register', {
      json: { client_name: 'Mine', redirect_uris: ['https://example.com/cb'] },
    });
    expect(registered.status).toBe(403);
    const deleted = await request(user, '/api/auth/oauth2/delete-client', { json: { client_id: appId } });
    expect(deleted.status).toBe(401);
  });
});

describe.skipIf(!DATABASE_URL)('OAuth tokens on /api/v1', () => {
  let user!: SignedInUser;
  let appId!: string;
  let cliId!: string;

  beforeAll(async () => {
    user = await signInFreshUser('oauth-v1');
    await setConnectedApps(user.personalWorkspaceId, true);
    appId = await registerApp(user, 'app');
    cliId = await registerApp(user, 'cli');
  });

  afterAll(async () => {
    for (const id of [appId, cliId]) {
      if (id) await getDb().delete(schema.oauthClient).where(eq(schema.oauthClient.clientId, id));
    }
    if (user) await removeUser(user);
  });

  const bearer = (token: string, extra: Record<string, string> = {}) =>
    new Headers({ authorization: `Bearer ${token}`, ...extra });

  test('the CLI’s token acts as its user, in the workspace the header names', async () => {
    const { accessToken } = await deviceSignIn(user, cliId);
    const ctx = await workspaceFromHeaders(bearer(accessToken));
    expect(ctx).toMatchObject({ userId: user.userId, email: user.email, workspaceId: user.personalWorkspaceId, role: 'owner' });
    expect(ctx.via).toBeUndefined();
    await expect(workspaceFromHeaders(bearer(accessToken, { 'x-sailscoring-workspace': 'nowhere' }))).rejects.toThrow(
      /workspace-not-a-member/,
    );
  });

  test('an outside app’s token is refused there', async () => {
    const { accessToken } = await grantApp(user, appId, user.personalWorkspaceId);
    await expect(workspaceFromHeaders(bearer(accessToken))).rejects.toThrow(/app-token-not-accepted/);
  });

  test('a token that resolves to nothing is unauthenticated', async () => {
    await expect(workspaceFromHeaders(bearer('ssat_made_up'))).rejects.toThrow(/unauthenticated/);
  });
});
