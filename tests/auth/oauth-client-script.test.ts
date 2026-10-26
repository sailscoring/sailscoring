// @vitest-environment node

/**
 * `scripts/oauth-client.ts`, the operator's way to register apps (ADR-016).
 *
 * Skipped when DATABASE_URL is unset; CI provides it.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';

import { parseClientMetadata } from '@/lib/auth/oauth';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import {
  createAppClient,
  createCliClient,
  listClients,
  setClientDisabled,
} from '@/scripts/oauth-client';
import { removeUser, signInFreshUser, type SignedInUser } from './oauth-helpers';

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('oauth-client script', () => {
  let operator!: SignedInUser;
  const created: string[] = [];

  beforeAll(async () => {
    operator = await signInFreshUser('oauth-operator');
  });

  afterAll(async () => {
    for (const id of created) {
      await getDb().delete(schema.oauthClient).where(eq(schema.oauthClient.clientId, id));
    }
    if (operator) await removeUser(operator);
  });

  test('registers a public web app, then disables and enables it', async () => {
    const app = await createAppClient({
      owner: operator.email,
      name: 'Course page',
      uri: 'https://example.com/course',
      redirectUris: ['https://example.com/course/callback'],
      confidential: false,
    });
    created.push(app.clientId);
    expect(app.clientSecret).toBeUndefined();

    const [row] = await getDb()
      .select()
      .from(schema.oauthClient)
      .where(eq(schema.oauthClient.clientId, app.clientId));
    expect(row).toMatchObject({
      name: 'Course page',
      uri: 'https://example.com/course',
      redirectUris: ['https://example.com/course/callback'],
      tokenEndpointAuthMethod: 'none',
      applicationType: 'web',
      grantTypes: ['authorization_code', 'refresh_token'],
      scopes: ['read', 'races', 'submissions', 'publish', 'offline_access'],
      userId: operator.userId,
    });

    expect((await listClients(getDb())).some((c) => c.clientId === app.clientId)).toBe(true);
    expect(await setClientDisabled(getDb(), app.clientId, true)).toBe(true);
    expect((await listClients(getDb())).find((c) => c.clientId === app.clientId)?.disabled).toBe(true);
    expect(await setClientDisabled(getDb(), app.clientId, false)).toBe(true);
    expect(await setClientDisabled(getDb(), 'no-such-client', true)).toBe(false);
  });

  test('a confidential app gets a secret, shown once', async () => {
    const app = await createAppClient({
      owner: operator.email,
      name: 'Race-day server',
      redirectUris: ['https://example.com/cb'],
      confidential: true,
    });
    created.push(app.clientId);
    expect(app.clientSecret).toBeTruthy();
    const [row] = await getDb()
      .select({ clientSecret: schema.oauthClient.clientSecret })
      .from(schema.oauthClient)
      .where(eq(schema.oauthClient.clientId, app.clientId));
    expect(row.clientSecret).not.toBe(app.clientSecret);
  });

  test('an app is registered with only the scopes it asked for', async () => {
    const app = await createAppClient({
      owner: operator.email,
      name: 'Race office',
      redirectUris: ['https://example.com/cb'],
      confidential: true,
      scopes: ['read', 'races', 'publish', 'offline_access'],
    });
    created.push(app.clientId);
    const [row] = await getDb()
      .select({ scopes: schema.oauthClient.scopes })
      .from(schema.oauthClient)
      .where(eq(schema.oauthClient.clientId, app.clientId));
    expect(row.scopes).toEqual(['read', 'races', 'publish', 'offline_access']);

    await expect(
      createAppClient({
        owner: operator.email,
        name: 'Greedy',
        redirectUris: ['https://example.com/cb'],
        confidential: false,
        scopes: ['read', 'admin'],
      }),
    ).rejects.toThrow(/unknown scope admin/);
  });

  test('an app being developed locally is registered with its loopback address', async () => {
    const app = await createAppClient({
      owner: operator.email,
      name: 'Local dev',
      redirectUris: ['http://127.0.0.1:8080/callback'],
      confidential: false,
    });
    created.push(app.clientId);
    await expect(
      createAppClient({
        owner: operator.email,
        name: 'Plain http',
        redirectUris: ['http://example.com/callback'],
        confidential: false,
      }),
    ).rejects.toThrow();
  });

  test('registers the CLI as first-party, for the device grant', async () => {
    const cli = await createCliClient(operator.email);
    created.push(cli.clientId);
    const [row] = await getDb()
      .select()
      .from(schema.oauthClient)
      .where(eq(schema.oauthClient.clientId, cli.clientId));
    expect(row.skipConsent).toBe(true);
    expect(row.grantTypes).toEqual(['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token']);
    expect(parseClientMetadata(row.metadata)).toEqual({ firstParty: true });
  });

  test('an unknown operator is refused', async () => {
    await expect(createCliClient('nobody@sailscoring.test')).rejects.toThrow(/no user/);
  });
});
