// @vitest-environment node

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('resolveWorkspace', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  // Each test seeds its own user and orgs; clean them up at the end.
  const cleanupUserIds: string[] = [];
  const cleanupOrgIds: string[] = [];

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });

    // Force the lib/db/client.ts cached client to use the same connection
    // as the tests so the resolveWorkspace lookup hits the same DB.
    process.env.DATABASE_URL = DATABASE_URL;
  });

  afterAll(async () => {
    for (const id of cleanupUserIds) {
      await db.delete(schema.user).where(eq(schema.user.id, id));
    }
    for (const id of cleanupOrgIds) {
      await db.delete(schema.organization).where(eq(schema.organization.id, id));
    }
    await sql?.end();
  });

  async function makeUser(email: string): Promise<string> {
    const id = `usr_${uuid().replace(/-/g, '')}`;
    cleanupUserIds.push(id);
    await db.insert(schema.user).values({
      id,
      name: email.split('@')[0],
      email,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  async function makeOrg(name: string): Promise<string> {
    const id = `org_${uuid().replace(/-/g, '')}`;
    cleanupOrgIds.push(id);
    await db.insert(schema.organization).values({
      id,
      name,
      slug: `${name.toLowerCase()}-${id.slice(4, 12)}`,
      createdAt: new Date(),
    });
    return id;
  }

  async function makeMember(
    orgId: string,
    userId: string,
    role: 'owner' | 'admin' | 'member',
    createdAt: Date,
  ): Promise<void> {
    await db.insert(schema.member).values({
      id: `mem_${uuid().replace(/-/g, '')}`,
      organizationId: orgId,
      userId,
      role,
      createdAt,
    });
  }

  test('throws ForbiddenError("no-workspace") when the user has no memberships', async () => {
    const { resolveWorkspace, ForbiddenError } = await import(
      '@/lib/auth/require-workspace'
    );
    const userId = await makeUser(`solo-${Date.now()}@sailscoring.test`);
    await expect(
      resolveWorkspace({ userId, email: 'x@y', activeOrganizationId: null }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('returns the activeOrganizationId membership when set', async () => {
    const { resolveWorkspace } = await import('@/lib/auth/require-workspace');
    const userId = await makeUser(`active-${Date.now()}@sailscoring.test`);
    const orgA = await makeOrg('A');
    const orgB = await makeOrg('B');
    // Both memberships, A older.
    await makeMember(orgA, userId, 'owner', new Date(Date.now() - 60_000));
    await makeMember(orgB, userId, 'member', new Date());

    const ctx = await resolveWorkspace({
      userId,
      email: 'a@b',
      activeOrganizationId: orgB,
    });
    expect(ctx).toMatchObject({ workspaceId: orgB, role: 'member' });
  });

  test('throws no-active-workspace when activeOrganizationId is null and the user has multiple memberships', async () => {
    const { resolveWorkspace, ForbiddenError } = await import(
      '@/lib/auth/require-workspace'
    );
    const userId = await makeUser(`multi-${Date.now()}@sailscoring.test`);
    const orgA = await makeOrg('A');
    const orgB = await makeOrg('B');
    await makeMember(orgA, userId, 'owner', new Date(Date.now() - 60_000));
    await makeMember(orgB, userId, 'admin', new Date());

    const err = await resolveWorkspace({
      userId,
      email: 'a@b',
      activeOrganizationId: null,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect((err as InstanceType<typeof ForbiddenError>).reason).toBe(
      'no-active-workspace',
    );
  });

  test('bootstrap-picks the only membership when activeOrganizationId is null', async () => {
    const { resolveWorkspace } = await import('@/lib/auth/require-workspace');
    const userId = await makeUser(`solo-pick-${Date.now()}@sailscoring.test`);
    const onlyOrg = await makeOrg('Only');
    await makeMember(onlyOrg, userId, 'owner', new Date());

    const ctx = await resolveWorkspace({
      userId,
      email: 'a@b',
      activeOrganizationId: null,
    });
    expect(ctx).toMatchObject({ workspaceId: onlyOrg, role: 'owner' });
  });

  test('bootstrap-pick persists the choice back to the session row when sessionId is provided', async () => {
    const { resolveWorkspace } = await import('@/lib/auth/require-workspace');
    const userId = await makeUser(`persist-${Date.now()}@sailscoring.test`);
    const onlyOrg = await makeOrg('Persist');
    await makeMember(onlyOrg, userId, 'owner', new Date());

    const sessionId = `ses_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.session).values({
      id: sessionId,
      userId,
      token: sessionId,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await resolveWorkspace({
      userId,
      email: 'a@b',
      activeOrganizationId: null,
      sessionId,
    });

    const [row] = await db
      .select({ activeOrganizationId: schema.session.activeOrganizationId })
      .from(schema.session)
      .where(eq(schema.session.id, sessionId));
    expect(row.activeOrganizationId).toBe(onlyOrg);

    await db.delete(schema.session).where(eq(schema.session.id, sessionId));
  });

  test('falls back to the only membership when activeOrganizationId is stale', async () => {
    const { resolveWorkspace } = await import('@/lib/auth/require-workspace');
    const userId = await makeUser(`stale-${Date.now()}@sailscoring.test`);
    const orgA = await makeOrg('Member');
    const stale = await makeOrg('Stale');
    await makeMember(orgA, userId, 'owner', new Date());

    const ctx = await resolveWorkspace({
      userId,
      email: 'a@b',
      activeOrganizationId: stale,
    });
    expect(ctx).toMatchObject({ workspaceId: orgA });
  });

  test('throws no-active-workspace when activeOrganizationId is stale and the user has multiple memberships', async () => {
    const { resolveWorkspace, ForbiddenError } = await import(
      '@/lib/auth/require-workspace'
    );
    const userId = await makeUser(`stale-multi-${Date.now()}@sailscoring.test`);
    const orgA = await makeOrg('A2');
    const orgB = await makeOrg('B2');
    const stale = await makeOrg('Stale2');
    await makeMember(orgA, userId, 'owner', new Date());
    await makeMember(orgB, userId, 'member', new Date());

    await expect(
      resolveWorkspace({ userId, email: 'a@b', activeOrganizationId: stale }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('UnauthenticatedError shape', () => {
  test('is named correctly and identifiable via instanceof', async () => {
    // Pure unit test, no DB needed; force-import via a vitest mock to
    // avoid the auth.api.getSession path firing.
    vi.doMock('next/headers', () => ({ headers: async () => new Headers() }));
    const { UnauthenticatedError } = await import('@/lib/auth/require-workspace');
    const e = new UnauthenticatedError();
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('UnauthenticatedError');
    expect(e.message).toBe('unauthenticated');
  });
});
