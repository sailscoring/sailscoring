// @vitest-environment node

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import { addMember, createOrg } from '@/scripts/provision-org';
import { deleteAccount, planDeleteAccount } from '@/scripts/delete-account';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

describe.skipIf(skip)('delete-account', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  const cleanupUserIds: string[] = [];
  const cleanupOrgIds: string[] = [];

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
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
    const id = `usr_${crypto.randomUUID().replace(/-/g, '')}`;
    cleanupUserIds.push(id);
    await db.insert(schema.user).values({
      id,
      name: email.split('@')[0],
      email: email.toLowerCase(),
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  async function makeSeries(workspaceId: string, name: string): Promise<string> {
    const id = crypto.randomUUID();
    await db.insert(schema.series).values({ id, workspaceId, name, displayOrder: 0 });
    return id;
  }

  test('deletes the user and a sole-member workspace, cascading its data', async () => {
    const stamp = Date.now();
    const email = `solo-${stamp}@sailscoring.test`;
    await makeUser(email);

    const org = await createOrg(db, { name: `Solo Panel ${stamp}`, slug: `solo-${stamp}` });
    cleanupOrgIds.push(org.id);
    await addMember(db, { orgSlugOrId: org.id, email, role: 'owner' });
    const seriesId = await makeSeries(org.id, 'Spring Series');

    const plan = await planDeleteAccount(db, { email });
    expect(plan.workspaces).toHaveLength(1);
    expect(plan.workspaces[0]).toMatchObject({
      id: org.id,
      role: 'owner',
      memberCount: 1,
      soleMember: true,
      ownerlessAfter: false,
      series: 1,
    });

    await deleteAccount(db, { email });

    // User, workspace, and the workspace's series are all gone.
    const users = await db.select().from(schema.user).where(eq(schema.user.email, email));
    expect(users).toHaveLength(0);
    const orgs = await db
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.id, org.id));
    expect(orgs).toHaveLength(0);
    const seriesRows = await db
      .select()
      .from(schema.series)
      .where(eq(schema.series.id, seriesId));
    expect(seriesRows).toHaveLength(0);
  });

  test('preserves a shared workspace; only the deleted user leaves it', async () => {
    const stamp = Date.now();
    const leaver = `leaver-${stamp}@sailscoring.test`;
    const stayer = `stayer-${stamp}@sailscoring.test`;
    await makeUser(leaver);
    const stayerId = await makeUser(stayer);

    const org = await createOrg(db, { name: `Shared Panel ${stamp}`, slug: `shared-${stamp}` });
    cleanupOrgIds.push(org.id);
    await addMember(db, { orgSlugOrId: org.id, email: leaver, role: 'admin' });
    await addMember(db, { orgSlugOrId: org.id, email: stayer, role: 'owner' });

    const plan = await planDeleteAccount(db, { email: leaver });
    expect(plan.workspaces[0]).toMatchObject({
      memberCount: 2,
      soleMember: false,
      ownerlessAfter: false,
    });

    await deleteAccount(db, { email: leaver });

    // Workspace survives; the other member's membership is intact.
    const orgs = await db
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.id, org.id));
    expect(orgs).toHaveLength(1);
    const remaining = await db
      .select()
      .from(schema.member)
      .where(eq(schema.member.organizationId, org.id));
    expect(remaining).toHaveLength(1);
    expect(remaining[0].userId).toBe(stayerId);
  });

  test('flags ownerlessAfter when the sole owner of a shared workspace is deleted', async () => {
    const stamp = Date.now();
    const owner = `lastowner-${stamp}@sailscoring.test`;
    const helper = `helper-${stamp}@sailscoring.test`;
    await makeUser(owner);
    await makeUser(helper);

    const org = await createOrg(db, { name: `Orphan Panel ${stamp}`, slug: `orphan-${stamp}` });
    cleanupOrgIds.push(org.id);
    await addMember(db, { orgSlugOrId: org.id, email: owner, role: 'owner' });
    await addMember(db, { orgSlugOrId: org.id, email: helper, role: 'member' });

    const plan = await planDeleteAccount(db, { email: owner });
    expect(plan.workspaces[0]).toMatchObject({
      memberCount: 2,
      soleMember: false,
      ownerlessAfter: true,
    });
  });

  test('dry-run plan does not modify anything', async () => {
    const stamp = Date.now();
    const email = `dryrun-${stamp}@sailscoring.test`;
    const userId = await makeUser(email);

    const org = await createOrg(db, { name: `Dry Panel ${stamp}`, slug: `dry-${stamp}` });
    cleanupOrgIds.push(org.id);
    await addMember(db, { orgSlugOrId: org.id, email, role: 'owner' });

    await planDeleteAccount(db, { email });

    const users = await db.select().from(schema.user).where(eq(schema.user.id, userId));
    expect(users).toHaveLength(1);
    const members = await db
      .select()
      .from(schema.member)
      .where(and(eq(schema.member.organizationId, org.id), eq(schema.member.userId, userId)));
    expect(members).toHaveLength(1);
  });

  test('throws for an unknown email', async () => {
    await expect(
      planDeleteAccount(db, { email: `nobody-${Date.now()}@sailscoring.test` }),
    ).rejects.toThrow(/no user with email/);
  });
});
