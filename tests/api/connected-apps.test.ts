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
  setConnectedApps,
  signInFreshUser,
  type SignedInUser,
} from '../auth/oauth-helpers';

const DATABASE_URL = process.env.DATABASE_URL;
const resolve = (token: string) => auth.api.resolveAccessToken({ body: { token } });

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
});
