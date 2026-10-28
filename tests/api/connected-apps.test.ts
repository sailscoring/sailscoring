// @vitest-environment node

/**
 * A user's connected apps (ADR-016): listing every grant and CLI sign-in,
 * and taking one back, which stops its tokens at once.
 *
 * Skipped when DATABASE_URL is unset; CI provides it.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { disconnectApp, listConnectedApps } from '@/lib/api-handlers/connected-apps';
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
} from '../auth/oauth-helpers';

const DATABASE_URL = process.env.DATABASE_URL;
const resolve = (token: string) => auth.api.resolveAccessToken({ body: { token } });

/** The revocation endpoint, as an app signing out calls it. */
async function revoke(token: string, hint: 'access_token' | 'refresh_token', clientId: string): Promise<void> {
  const res = await request(null, '/api/auth/oauth2/revoke', {
    form: { token, token_type_hint: hint, client_id: clientId },
  });
  expect(res.status).toBe(200);
}

describe.skipIf(!DATABASE_URL)('connected apps', () => {
  let user!: SignedInUser;
  let appId!: string;
  let cliId!: string;

  beforeAll(async () => {
    user = await signInFreshUser('connected-apps');
    appId = await registerApp(user, 'app', 'Course plotter');
    cliId = await registerApp(user, 'cli');
  });

  afterAll(async () => {
    for (const id of [appId, cliId]) {
      if (id) await getDb().delete(schema.oauthClient).where(eq(schema.oauthClient.clientId, id));
    }
    if (user) await removeUser(user);
  });

  test('with nothing connected and nowhere to connect an app, there is nothing to show', async () => {
    expect(await listConnectedApps(user.userId)).toEqual({ apps: [], canConnect: false });
    await setConnectedApps(user.personalWorkspaceId, true);
    expect(await listConnectedApps(user.userId)).toEqual({ apps: [], canConnect: true });
  });

  test('lists an app per workspace granted, and the CLI', async () => {
    await grantApp(user, appId, user.personalWorkspaceId, 'read races offline_access');
    await deviceSignIn(user, cliId);
    const { apps } = await listConnectedApps(user.userId);
    expect(apps).toEqual([
      expect.objectContaining({
        clientId: appId, name: 'Course plotter', firstParty: false,
        workspaceId: user.personalWorkspaceId, workspaceName: 'My Workspace',
        scopes: expect.arrayContaining(['read', 'races', 'offline_access']),
      }),
      expect.objectContaining({ clientId: cliId, name: 'Sail Scoring CLI', firstParty: true, workspaceId: null }),
    ]);
  });

  test('disconnecting stops the app’s tokens at once, refresh and all', async () => {
    const tokens = await grantApp(user, appId, user.personalWorkspaceId, 'read races offline_access');
    expect(await resolve(tokens.accessToken)).not.toBeNull();
    await disconnectApp(user.userId, { clientId: appId, workspaceId: user.personalWorkspaceId });
    expect(await resolve(tokens.accessToken)).toBeNull();
    await expect(
      exchange({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken, client_id: appId }),
    ).rejects.toThrow();
    const { apps } = await listConnectedApps(user.userId);
    expect(apps.map((a) => a.clientId)).toEqual([cliId]);
  });

  test('signing the CLI out', async () => {
    const tokens = await deviceSignIn(user, cliId);
    await disconnectApp(user.userId, { clientId: cliId, workspaceId: null });
    expect(await resolve(tokens.accessToken)).toBeNull();
    expect((await listConnectedApps(user.userId)).apps).toEqual([]);
  });

  test('an app revoking its last refresh token is disconnected, as if from the account page', async () => {
    const tokens = await grantApp(user, appId, user.personalWorkspaceId, 'read races offline_access');
    expect((await listConnectedApps(user.userId)).apps.map((a) => a.clientId)).toEqual([appId]);
    await revoke(tokens.refreshToken, 'refresh_token', appId);
    expect(await resolve(tokens.accessToken)).toBeNull();
    expect((await listConnectedApps(user.userId)).apps).toEqual([]);
    // No consent left, so signing in again asks for approval again.
    const consents = await getDb()
      .select()
      .from(schema.oauthConsent)
      .where(eq(schema.oauthConsent.userId, user.userId));
    expect(consents).toEqual([]);
  });

  test('the grant stays while another of its refresh tokens is live, or when only an access token is revoked', async () => {
    const here = await grantApp(user, appId, user.personalWorkspaceId, 'read races offline_access');
    const there = await grantApp(user, appId, user.personalWorkspaceId, 'read races offline_access');

    await revoke(here.accessToken, 'access_token', appId);
    expect((await listConnectedApps(user.userId)).apps.map((a) => a.clientId)).toEqual([appId]);

    await revoke(here.refreshToken, 'refresh_token', appId);
    expect((await listConnectedApps(user.userId)).apps.map((a) => a.clientId)).toEqual([appId]);
    expect((await resolve(there.accessToken))?.workspaceId).toBe(user.personalWorkspaceId);

    await revoke(there.refreshToken, 'refresh_token', appId);
    expect((await listConnectedApps(user.userId)).apps).toEqual([]);
  });

  test('the CLI signing out with its last refresh token leaves nothing listed', async () => {
    const tokens = await deviceSignIn(user, cliId);
    await revoke(tokens.refreshToken, 'refresh_token', cliId);
    expect(await resolve(tokens.accessToken)).toBeNull();
    expect((await listConnectedApps(user.userId)).apps).toEqual([]);
  });
});
