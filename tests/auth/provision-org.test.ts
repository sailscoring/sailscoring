// @vitest-environment node

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import {
  addMember,
  createOrg,
  declineRequest,
  deleteOrg,
  fulfilRequest,
  listMembers,
  listOrgsWithFeature,
  listRequests,
  preCreateUser,
  removeMember,
  setOrgFeature,
  setRole,
  summariseOrg,
} from '@/scripts/provision-org';
import { parseOrgMetadata } from '@/lib/features';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

describe.skipIf(skip)('provision-org operations', () => {
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

  test('createOrg + add/list/setRole/remove round-trip', async () => {
    const stamp = Date.now();
    const owner = `owner-${stamp}@sailscoring.test`;
    const second = `second-${stamp}@sailscoring.test`;
    await makeUser(owner);
    await makeUser(second);

    const org = await createOrg(db, { name: `Test Panel ${stamp}` });
    cleanupOrgIds.push(org.id);
    expect(org.slug).toContain('test-panel');

    await addMember(db, { orgSlugOrId: org.slug, email: owner, role: 'owner' });
    await addMember(db, { orgSlugOrId: org.slug, email: second });

    let listed = await listMembers(db, { orgSlugOrId: org.slug });
    expect(listed.members).toHaveLength(2);
    expect(listed.members.map((m) => m.email).sort()).toEqual([owner, second].sort());
    expect(listed.members.find((m) => m.email === second)?.role).toBe('member');

    await setRole(db, { orgSlugOrId: org.slug, email: second, role: 'admin' });
    listed = await listMembers(db, { orgSlugOrId: org.slug });
    expect(listed.members.find((m) => m.email === second)?.role).toBe('admin');

    const result = await removeMember(db, { orgSlugOrId: org.slug, email: second });
    expect(result.removed).toBe(true);
    listed = await listMembers(db, { orgSlugOrId: org.slug });
    expect(listed.members).toHaveLength(1);
  });

  test('createOrg rejects duplicate slug', async () => {
    const slug = `dup-${Date.now()}`;
    const a = await createOrg(db, { name: 'Alpha', slug });
    cleanupOrgIds.push(a.id);
    await expect(
      createOrg(db, { name: 'Beta', slug }),
    ).rejects.toThrow(/already exists/);
  });

  async function makeRequest(
    userId: string,
    email: string,
    requestedName: string,
  ): Promise<string> {
    const id = crypto.randomUUID();
    await db.insert(schema.orgRequest).values({
      id,
      userId,
      userEmail: email,
      requestedName,
      createdAt: new Date(),
    });
    return id;
  }

  test('fulfilRequest creates the workspace, adds the requester as owner, and marks it fulfilled', async () => {
    const stamp = Date.now();
    const email = `requester-${stamp}@sailscoring.test`;
    const userId = await makeUser(email);
    const requestId = await makeRequest(userId, email, `Requested Panel ${stamp}`);

    const pending = await listRequests(db);
    expect(pending.some((r) => r.id === requestId)).toBe(true);

    const { org } = await fulfilRequest(db, { requestId, slug: `req-${stamp}` });
    cleanupOrgIds.push(org.id);
    expect(org.name).toBe(`Requested Panel ${stamp}`);

    // Requester is the owner of the new workspace.
    const members = await listMembers(db, { orgSlugOrId: org.id });
    expect(members.members).toHaveLength(1);
    expect(members.members[0]).toMatchObject({ email, role: 'owner' });

    // Request is no longer pending, and points at the new org.
    const [row] = await db
      .select()
      .from(schema.orgRequest)
      .where(eq(schema.orgRequest.id, requestId));
    expect(row.status).toBe('fulfilled');
    expect(row.resolvedOrgId).toBe(org.id);
    expect(row.resolvedAt).not.toBeNull();

    // Already-resolved requests can't be fulfilled again.
    await expect(fulfilRequest(db, { requestId })).rejects.toThrow(/already fulfilled/);
  });

  test('createOrg --enable-feature, setOrgFeature toggle, and listOrgsWithFeature (#155)', async () => {
    const stamp = Date.now();
    // create-org with features set at birth
    const org = await createOrg(db, {
      name: `Featured ${stamp}`,
      slug: `feat-${stamp}`,
      enabledFeatures: ['echo', 'ftp-upload'],
    });
    cleanupOrgIds.push(org.id);

    async function featuresOf(orgId: string) {
      const [row] = await db
        .select({ metadata: schema.organization.metadata })
        .from(schema.organization)
        .where(eq(schema.organization.id, orgId));
      return parseOrgMetadata(row.metadata, org.slug).enabledFeatures.sort();
    }

    expect(await featuresOf(org.id)).toEqual(['echo', 'ftp-upload']);

    // enable-feature adds, idempotently
    await setOrgFeature(db, { orgSlugOrId: org.slug, feature: 'sailwave-import', enabled: true });
    await setOrgFeature(db, { orgSlugOrId: org.slug, feature: 'echo', enabled: true });
    expect(await featuresOf(org.id)).toEqual(['echo', 'ftp-upload', 'sailwave-import']);

    // disable-feature removes, idempotently
    const after = await setOrgFeature(db, { orgSlugOrId: org.slug, feature: 'echo', enabled: false });
    expect(after.enabledFeatures.sort()).toEqual(['ftp-upload', 'sailwave-import']);
    await setOrgFeature(db, { orgSlugOrId: org.slug, feature: 'echo', enabled: false });
    expect(await featuresOf(org.id)).toEqual(['ftp-upload', 'sailwave-import']);

    // list-feature audience query finds this org for ftp-upload, not echo
    const ftpOrgs = await listOrgsWithFeature(db, 'ftp-upload');
    expect(ftpOrgs.map((o) => o.id)).toContain(org.id);
    const echoOrgs = await listOrgsWithFeature(db, 'echo');
    expect(echoOrgs.map((o) => o.id)).not.toContain(org.id);
  });

  test('disabling a default-on feature records an opt-out; enabling clears it (#155)', async () => {
    const stamp = Date.now();
    const org = await createOrg(db, {
      name: `Default-on ${stamp}`,
      slug: `defon-${stamp}`,
    });
    cleanupOrgIds.push(org.id);

    async function disabledOf(orgId: string) {
      const [row] = await db
        .select({ metadata: schema.organization.metadata })
        .from(schema.organization)
        .where(eq(schema.organization.id, orgId));
      return parseOrgMetadata(row.metadata, org.slug).disabledFeatures.sort();
    }

    // Opting out of irc-rating (default-on) records it in disabledFeatures.
    await setOrgFeature(db, { orgSlugOrId: org.slug, feature: 'irc-rating', enabled: false });
    expect(await disabledOf(org.id)).toEqual(['irc-rating']);

    // Re-enabling clears the opt-out.
    const after = await setOrgFeature(db, { orgSlugOrId: org.slug, feature: 'irc-rating', enabled: true });
    expect(after.enabledFeatures).toContain('irc-rating');
    expect(await disabledOf(org.id)).toEqual([]);
  });

  test('declineRequest marks a pending request declined', async () => {
    const stamp = Date.now();
    const email = `declined-${stamp}@sailscoring.test`;
    const userId = await makeUser(email);
    const requestId = await makeRequest(userId, email, `Doomed Panel ${stamp}`);

    await declineRequest(db, { requestId });
    const [row] = await db
      .select()
      .from(schema.orgRequest)
      .where(eq(schema.orgRequest.id, requestId));
    expect(row.status).toBe('declined');
  });

  test('addMember rejects unknown user with a helpful message', async () => {
    const org = await createOrg(db, { name: `Empty ${Date.now()}` });
    cleanupOrgIds.push(org.id);
    await expect(
      addMember(db, { orgSlugOrId: org.slug, email: 'nobody@nowhere.test' }),
    ).rejects.toThrow(/sign in once/);
  });

  test('addMember rejects duplicate membership', async () => {
    const stamp = Date.now();
    const email = `dup-mem-${stamp}@sailscoring.test`;
    await makeUser(email);
    const org = await createOrg(db, { name: `DupMem ${stamp}` });
    cleanupOrgIds.push(org.id);
    await addMember(db, { orgSlugOrId: org.slug, email });
    await expect(
      addMember(db, { orgSlugOrId: org.slug, email }),
    ).rejects.toThrow(/already a member/);
  });

  test('lookup by id works as well as by slug', async () => {
    const org = await createOrg(db, { name: `ById ${Date.now()}` });
    cleanupOrgIds.push(org.id);
    const listed = await listMembers(db, { orgSlugOrId: org.id });
    expect(listed.org.id).toBe(org.id);
  });

  test('preCreateUser creates user + personal workspace, can then be added to an org', async () => {
    const stamp = Date.now();
    const email = `pre-${stamp}@sailscoring.test`;
    const result = await preCreateUser(db, { email, name: 'Pre Created' });
    cleanupUserIds.push(result.userId);
    cleanupOrgIds.push(result.personalWorkspaceId);

    const [u] = await db
      .select({ id: schema.user.id, email: schema.user.email, name: schema.user.name, emailVerified: schema.user.emailVerified })
      .from(schema.user)
      .where(eq(schema.user.id, result.userId));
    expect(u.email).toBe(email);
    expect(u.name).toBe('Pre Created');
    expect(u.emailVerified).toBe(false);

    // Personal workspace exists with the same slug shape lib/auth.ts uses.
    const [ws] = await db
      .select({ id: schema.organization.id, slug: schema.organization.slug })
      .from(schema.organization)
      .where(eq(schema.organization.id, result.personalWorkspaceId));
    expect(ws.slug.startsWith('u-')).toBe(true);

    // Owner membership in the personal workspace.
    const personalMembers = await db
      .select({ role: schema.member.role })
      .from(schema.member)
      .where(eq(schema.member.organizationId, result.personalWorkspaceId));
    expect(personalMembers).toHaveLength(1);
    expect(personalMembers[0].role).toBe('owner');

    // The whole point: pre-created users can be added to a shared org.
    const org = await createOrg(db, { name: `PreOrg ${stamp}` });
    cleanupOrgIds.push(org.id);
    await addMember(db, { orgSlugOrId: org.slug, email });
    const listed = await listMembers(db, { orgSlugOrId: org.slug });
    expect(listed.members.map((m) => m.email)).toContain(email);
  });

  test('preCreateUser rejects duplicate email', async () => {
    const stamp = Date.now();
    const email = `dup-pre-${stamp}@sailscoring.test`;
    const result = await preCreateUser(db, { email, name: 'First' });
    cleanupUserIds.push(result.userId);
    cleanupOrgIds.push(result.personalWorkspaceId);
    await expect(
      preCreateUser(db, { email, name: 'Second' }),
    ).rejects.toThrow(/already exists/);
  });

  test('preCreateUser requires a non-empty name', async () => {
    const email = `noname-${Date.now()}@sailscoring.test`;
    await expect(
      preCreateUser(db, { email, name: '   ' }),
    ).rejects.toThrow(/name is required/);
  });

  test('summariseOrg counts members and cascades; deleteOrg removes the org and all of it', async () => {
    const stamp = Date.now();
    const owner = `del-owner-${stamp}@sailscoring.test`;
    await makeUser(owner);

    const org = await createOrg(db, { name: `Delete Me ${stamp}` });
    // Not pushing onto cleanupOrgIds — deleteOrg removes it for us.
    await addMember(db, { orgSlugOrId: org.slug, email: owner, role: 'owner' });

    const before = await summariseOrg(db, { orgSlugOrId: org.slug });
    expect(before.org.id).toBe(org.id);
    expect(before.members).toBe(1);
    expect(before.series).toBe(0);

    const removed = await deleteOrg(db, { orgSlugOrId: org.slug });
    expect(removed.id).toBe(org.id);

    // Org row is gone.
    const stillThere = await db
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(eq(schema.organization.id, org.id));
    expect(stillThere).toHaveLength(0);

    // Membership cascaded.
    const orphanedMembers = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(eq(schema.member.organizationId, org.id));
    expect(orphanedMembers).toHaveLength(0);
  });

  test('summariseOrg rejects unknown org', async () => {
    await expect(
      summariseOrg(db, { orgSlugOrId: 'definitely-not-an-org' }),
    ).rejects.toThrow(/not found/);
  });

  test('deleteOrg rejects unknown org', async () => {
    await expect(
      deleteOrg(db, { orgSlugOrId: 'definitely-not-an-org' }),
    ).rejects.toThrow(/not found/);
  });

  test('preCreateUser normalises email to lowercase', async () => {
    const stamp = Date.now();
    const mixed = `Mixed-${stamp}@SailScoring.Test`;
    const result = await preCreateUser(db, { email: mixed, name: 'Mixed Case' });
    cleanupUserIds.push(result.userId);
    cleanupOrgIds.push(result.personalWorkspaceId);
    expect(result.email).toBe(mixed.toLowerCase());
    // addMember accepts any case; lookup is case-insensitive on the script side.
    const org = await createOrg(db, { name: `MixedOrg ${stamp}` });
    cleanupOrgIds.push(org.id);
    await addMember(db, { orgSlugOrId: org.slug, email: mixed });
    const listed = await listMembers(db, { orgSlugOrId: org.slug });
    expect(listed.members.map((m) => m.email)).toContain(mixed.toLowerCase());
  });
});
