// @vitest-environment node

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import { auth } from '@/lib/auth';
import { createToken, listTokens, revokeToken } from '@/scripts/provision-token';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID().replace(/-/g, '');
}

describe.skipIf(skip)('provision-token', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  const cleanupUserIds: string[] = [];
  const cleanupOrgIds: string[] = [];

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    // Force lib/db/client's cached client (used by auth.api.createApiKey) onto
    // the same database the test reads.
    process.env.DATABASE_URL = DATABASE_URL;
  });

  afterAll(async () => {
    for (const id of cleanupUserIds) {
      await db.delete(schema.apikey).where(eq(schema.apikey.referenceId, id));
      await db.delete(schema.user).where(eq(schema.user.id, id));
    }
    for (const id of cleanupOrgIds) {
      await db.delete(schema.organization).where(eq(schema.organization.id, id));
    }
    await sql?.end();
  });

  async function makeUserWithWorkspaces(): Promise<{
    email: string;
    userId: string;
    personalOrgId: string;
    sharedOrgId: string;
    sharedSlug: string;
  }> {
    const userId = `usr_${uuid()}`;
    const email = `token-${Date.now()}-${userId.slice(4, 10)}@sailscoring.test`;
    cleanupUserIds.push(userId);
    await db.insert(schema.user).values({
      id: userId,
      name: 'Token Tester',
      email,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const personalOrgId = `org_${uuid()}`;
    const sharedOrgId = `org_${uuid()}`;
    const sharedSlug = `club-${userId.slice(4, 12)}`;
    cleanupOrgIds.push(personalOrgId, sharedOrgId);
    await db.insert(schema.organization).values([
      { id: personalOrgId, name: 'My Workspace', slug: `u-${userId.slice(0, 16)}`, createdAt: new Date() },
      { id: sharedOrgId, name: 'Club', slug: sharedSlug, createdAt: new Date() },
    ]);
    await db.insert(schema.member).values([
      { id: `mem_${uuid()}`, organizationId: personalOrgId, userId, role: 'owner', createdAt: new Date() },
      { id: `mem_${uuid()}`, organizationId: sharedOrgId, userId, role: 'member', createdAt: new Date() },
    ]);
    return { email, userId, personalOrgId, sharedOrgId, sharedSlug };
  }

  test('mints a hashed key, authenticates via Bearer, and resolves the default workspace', async () => {
    const { email, userId, sharedOrgId, sharedSlug } = await makeUserWithWorkspaces();

    const created = await createToken(db, {
      email,
      name: 'cli',
      workspaceSlugOrId: sharedSlug,
    });
    expect(created.key).toBeTruthy();
    expect(created.workspaceId).toBe(sharedOrgId);

    // Stored hashed — the plaintext is never persisted.
    const [row] = await db
      .select({ key: schema.apikey.key, referenceId: schema.apikey.referenceId, metadata: schema.apikey.metadata })
      .from(schema.apikey)
      .where(eq(schema.apikey.id, created.id));
    expect(row.referenceId).toBe(userId);
    expect(row.key).not.toBe(created.key);
    expect(JSON.parse(row.metadata!)).toMatchObject({ defaultWorkspace: sharedOrgId });

    // A Bearer request resolves to the user's session (full plugin path).
    const session = await auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${created.key}` }),
    });
    expect(session?.user.id).toBe(userId);

    // End-to-end: a key session (no activeOrganizationId) lands on the key's
    // default workspace via requireWorkspace's resolution.
    const { resolveWorkspace } = await import('@/lib/auth/require-workspace');
    const ctx = await resolveWorkspace({
      userId,
      email,
      activeOrganizationId: null,
      apiKeyId: session!.session.id,
    });
    expect(ctx).toMatchObject({ workspaceId: sharedOrgId, role: 'member' });
  });

  async function rateLimitColumns(id: string) {
    const [row] = await db
      .select({
        enabled: schema.apikey.rateLimitEnabled,
        max: schema.apikey.rateLimitMax,
        windowMs: schema.apikey.rateLimitTimeWindow,
      })
      .from(schema.apikey)
      .where(eq(schema.apikey.id, id));
    return row;
  }

  test('a default key inherits the conservative plugin rate limit', async () => {
    const { email } = await makeUserWithWorkspaces();
    const created = await createToken(db, { email, name: 'default' });
    expect(created.rateLimit).toEqual({ enabled: true });
    // Stored from the apiKey plugin config in lib/auth.ts (60 req / 60s).
    const row = await rateLimitColumns(created.id);
    expect(row.enabled).toBe(true);
    expect(row.max).toBe(60);
    expect(row.windowMs).toBe(60_000);
  });

  test('--admin mints a near-unlimited key', async () => {
    const { email } = await makeUserWithWorkspaces();
    const created = await createToken(db, { email, name: 'admin', admin: true });
    expect(created.rateLimit).toEqual({
      enabled: true,
      maxRequests: 100_000,
      windowSeconds: 60,
    });
    const row = await rateLimitColumns(created.id);
    expect(row.enabled).toBe(true);
    expect(row.max).toBe(100_000);
    expect(row.windowMs).toBe(60_000);
  });

  test('--no-rate-limit disables the per-key limit', async () => {
    const { email } = await makeUserWithWorkspaces();
    const created = await createToken(db, { email, name: 'unlimited', rateLimitDisabled: true });
    expect(created.rateLimit).toEqual({ enabled: false });
    const row = await rateLimitColumns(created.id);
    expect(row.enabled).toBe(false);
  });

  test('explicit --rate-limit-max / window override the default', async () => {
    const { email } = await makeUserWithWorkspaces();
    const created = await createToken(db, {
      email,
      name: 'custom',
      rateLimitMax: 500,
      rateLimitWindowSeconds: 30,
    });
    expect(created.rateLimit).toEqual({
      enabled: true,
      maxRequests: 500,
      windowSeconds: 30,
    });
    const row = await rateLimitColumns(created.id);
    expect(row.max).toBe(500);
    expect(row.windowMs).toBe(30_000);
  });

  test('rejects a workspace the user is not a member of', async () => {
    const { email } = await makeUserWithWorkspaces();
    const otherOrgId = `org_${uuid()}`;
    cleanupOrgIds.push(otherOrgId);
    await db.insert(schema.organization).values({
      id: otherOrgId,
      name: 'Stranger',
      slug: `stranger-${otherOrgId.slice(4, 12)}`,
      createdAt: new Date(),
    });
    await expect(
      createToken(db, { email, workspaceSlugOrId: otherOrgId }),
    ).rejects.toThrow(/not a member/);
  });

  test('lists and revokes keys', async () => {
    const { email } = await makeUserWithWorkspaces();
    const created = await createToken(db, { email, name: 'to-revoke' });

    const before = await listTokens(db, { email });
    expect(before.some((t) => t.id === created.id)).toBe(true);

    const { revoked } = await revokeToken(db, { id: created.id });
    expect(revoked).toBe(true);

    const after = await listTokens(db, { email });
    expect(after.some((t) => t.id === created.id)).toBe(false);
  });
});
