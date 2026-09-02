// @vitest-environment node

/**
 * The support-grant lifecycle: a time-boxed, logged member row in a workspace
 * the operator is not otherwise a member of. Join writes the member row, the
 * grant, and a `support.joined` entry together; leave and the expiry sweep
 * undo exactly that member row and log `support.left`.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import {
  DEFAULT_SUPPORT_HOURS,
  findWorkspacesForEmail,
  joinAsSupport,
  leaveSupport,
  listSupportGrants,
  sweepExpiredSupportGrants,
} from '@/lib/support-grants';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const HOUR_MS = 60 * 60 * 1000;

describe.skipIf(skip)('support grants', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  const cleanupUserIds: string[] = [];
  const cleanupOrgIds: string[] = [];
  const stamp = Date.now();

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
  });

  afterAll(async () => {
    // Users and orgs cascade through member, support_grant, and activity_log.
    for (const id of cleanupUserIds) {
      await db.delete(schema.user).where(eq(schema.user.id, id));
    }
    for (const id of cleanupOrgIds) {
      await db.delete(schema.organization).where(eq(schema.organization.id, id));
    }
    await sql?.end();
  });

  async function makeUser(label: string): Promise<{ id: string; email: string }> {
    const id = `usr_${crypto.randomUUID().replace(/-/g, '')}`;
    const email = `${label}-${stamp}-${id.slice(4, 10)}@sailscoring.test`;
    cleanupUserIds.push(id);
    await db.insert(schema.user).values({
      id,
      name: `${label} person`,
      email,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return { id, email };
  }

  async function makeOrg(label: string, slugPrefix = 'sg'): Promise<{ id: string; slug: string }> {
    const id = `org_${crypto.randomUUID().replace(/-/g, '')}`;
    const slug = `${slugPrefix}-${label}-${id.slice(4, 12)}`;
    cleanupOrgIds.push(id);
    await db.insert(schema.organization).values({
      id,
      name: `${label} workspace`,
      slug,
      createdAt: new Date(),
    });
    return { id, slug };
  }

  async function addOwner(orgId: string, userId: string): Promise<string> {
    const id = `mem_${crypto.randomUUID().replace(/-/g, '')}`;
    await db.insert(schema.member).values({
      id,
      organizationId: orgId,
      userId,
      role: 'owner',
      createdAt: new Date(),
    });
    return id;
  }

  async function memberRows(orgId: string, userId: string) {
    return db
      .select({ id: schema.member.id, role: schema.member.role })
      .from(schema.member)
      .where(and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, userId)));
  }

  async function activityRows(orgId: string) {
    return db
      .select({
        action: schema.activityLog.action,
        summary: schema.activityLog.summary,
        actorUserId: schema.activityLog.actorUserId,
        seriesId: schema.activityLog.seriesId,
        metadata: schema.activityLog.metadata,
      })
      .from(schema.activityLog)
      .where(eq(schema.activityLog.workspaceId, orgId))
      .orderBy(schema.activityLog.createdAt);
  }

  test('join writes the member row, the grant, and a support.joined entry together', async () => {
    const org = await makeOrg('join');
    const owner = await makeUser('owner');
    await addOwner(org.id, owner.id);
    const support = await makeUser('support');
    const now = new Date();

    const grant = await joinAsSupport(db, {
      orgSlugOrId: org.slug,
      email: support.email,
      reason: 'standings query',
      now,
    });

    expect(grant.role).toBe('member');
    expect(grant.reason).toBe('standings query');
    expect(grant.expiresAt.getTime()).toBe(now.getTime() + DEFAULT_SUPPORT_HOURS * HOUR_MS);

    const members = await memberRows(org.id, support.id);
    expect(members).toEqual([{ id: grant.memberId, role: 'member' }]);

    const activity = await activityRows(org.id);
    expect(activity).toHaveLength(1);
    expect(activity[0].action).toBe('support.joined');
    expect(activity[0].actorUserId).toBe(support.id);
    expect(activity[0].seriesId).toBeNull();
    expect(activity[0].summary).toBe(
      'support person joined as support (read-only) for 24 hours: standings query',
    );
    expect(activity[0].metadata).toMatchObject({ grantId: grant.id, role: 'member' });

    const active = await listSupportGrants(db);
    expect(active.map((g) => g.id)).toContain(grant.id);
  });

  test('join refuses a second active grant and an ordinary membership', async () => {
    const org = await makeOrg('double');
    const support = await makeUser('support');
    await joinAsSupport(db, { orgSlugOrId: org.slug, email: support.email });
    await expect(
      joinAsSupport(db, { orgSlugOrId: org.slug, email: support.email }),
    ).rejects.toThrow(/already in .* as support .* leave first/);

    const owner = await makeUser('owner');
    await addOwner(org.id, owner.id);
    await expect(
      joinAsSupport(db, { orgSlugOrId: org.slug, email: owner.email }),
    ).rejects.toThrow(/ordinary membership, not a support grant/);

    // Neither refusal left a stray row behind.
    expect(await memberRows(org.id, support.id)).toHaveLength(1);
    expect(await memberRows(org.id, owner.id)).toHaveLength(1);
    expect(await activityRows(org.id)).toHaveLength(1);
  });

  test('join validates hours and role, and grants a higher role only when asked', async () => {
    const org = await makeOrg('role');
    const support = await makeUser('support');
    await expect(
      joinAsSupport(db, { orgSlugOrId: org.slug, email: support.email, hours: 0 }),
    ).rejects.toThrow(/--hours must be a positive number/);
    await expect(
      joinAsSupport(db, {
        orgSlugOrId: org.slug,
        email: support.email,
        role: 'root' as never,
      }),
    ).rejects.toThrow(/invalid role/);
    await expect(
      joinAsSupport(db, { orgSlugOrId: 'no-such-org', email: support.email }),
    ).rejects.toThrow(/org "no-such-org" not found/);
    await expect(
      joinAsSupport(db, { orgSlugOrId: org.slug, email: 'nobody@sailscoring.test' }),
    ).rejects.toThrow(/user "nobody@sailscoring.test" not found/);

    const now = new Date();
    const grant = await joinAsSupport(db, {
      orgSlugOrId: org.id,
      email: support.email,
      role: 'admin',
      hours: 2,
      now,
    });
    expect(grant.role).toBe('admin');
    expect(grant.expiresAt.getTime()).toBe(now.getTime() + 2 * HOUR_MS);
    expect(await memberRows(org.id, support.id)).toEqual([{ id: grant.memberId, role: 'admin' }]);
    const [entry] = await activityRows(org.id);
    expect(entry.summary).toBe('support person joined as support (admin) for 2 hours');
  });

  test('leave removes exactly the row join inserted and logs support.left', async () => {
    const org = await makeOrg('leave');
    const owner = await makeUser('owner');
    const ownerMemberId = await addOwner(org.id, owner.id);
    const support = await makeUser('support');
    const grant = await joinAsSupport(db, { orgSlugOrId: org.slug, email: support.email });

    const left = await leaveSupport(db, { orgSlugOrId: org.slug, email: support.email });
    expect(left.grant.id).toBe(grant.id);
    expect(left.how).toBe('left');
    expect(left.memberRemoved).toBe(true);

    expect(await memberRows(org.id, support.id)).toHaveLength(0);
    expect(await memberRows(org.id, owner.id)).toEqual([{ id: ownerMemberId, role: 'owner' }]);

    const [, entry] = await activityRows(org.id);
    expect(entry.action).toBe('support.left');
    expect(entry.summary).toBe('support person left; support access ended');
    expect(entry.metadata).toMatchObject({ grantId: grant.id, releasedBy: 'left' });

    const [released] = (await listSupportGrants(db, { all: true })).filter((g) => g.id === grant.id);
    expect(released.releasedBy).toBe('left');
    expect(released.releasedAt).not.toBeNull();
    expect((await listSupportGrants(db)).map((g) => g.id)).not.toContain(grant.id);

    // Leaving again, and leaving somewhere you hold an ordinary membership, both refuse.
    await expect(
      leaveSupport(db, { orgSlugOrId: org.slug, email: support.email }),
    ).rejects.toThrow(/is not in .* as support/);
    await expect(
      leaveSupport(db, { orgSlugOrId: org.slug, email: owner.email }),
    ).rejects.toThrow(/not via a support grant — use remove-member/);
  });

  test('the sweep expires grants at the boundary and leaves live ones alone', async () => {
    const org = await makeOrg('sweep');
    const soon = await makeUser('soon');
    const later = await makeUser('later');
    const now = new Date();
    const expiring = await joinAsSupport(db, {
      orgSlugOrId: org.slug,
      email: soon.email,
      hours: 1,
      now,
    });
    const live = await joinAsSupport(db, {
      orgSlugOrId: org.slug,
      email: later.email,
      hours: 48,
      now,
    });

    // One millisecond short: nothing is due.
    const early = await sweepExpiredSupportGrants(db, new Date(expiring.expiresAt.getTime() - 1));
    expect(early.map((c) => c.grant.id)).not.toContain(expiring.id);
    expect(await memberRows(org.id, soon.id)).toHaveLength(1);

    // On the boundary: the one-hour grant goes, the two-day grant stays.
    const closed = await sweepExpiredSupportGrants(db, expiring.expiresAt);
    expect(closed.map((c) => [c.grant.id, c.how])).toContainEqual([expiring.id, 'expired']);
    expect(closed.map((c) => c.grant.id)).not.toContain(live.id);
    expect(await memberRows(org.id, soon.id)).toHaveLength(0);
    expect(await memberRows(org.id, later.id)).toHaveLength(1);

    const entries = await activityRows(org.id);
    const leftEntry = entries.find((e) => e.action === 'support.left');
    expect(leftEntry?.actorUserId).toBe(soon.id);
    expect(leftEntry?.summary).toBe('soon person left; support access expired');

    const active = await listSupportGrants(db);
    expect(active.map((g) => g.id)).toContain(live.id);
    expect(active.map((g) => g.id)).not.toContain(expiring.id);
  });

  test('a member row removed out-of-band closes the grant as member-removed', async () => {
    const org = await makeOrg('removed');
    const support = await makeUser('support');
    const grant = await joinAsSupport(db, { orgSlugOrId: org.slug, email: support.email, hours: 48 });

    // The Members card (or remove-member) takes the row away underneath the grant.
    await db.delete(schema.member).where(eq(schema.member.id, grant.memberId!));

    const [orphaned] = await listSupportGrants(db).then((gs) => gs.filter((g) => g.id === grant.id));
    expect(orphaned.memberId).toBeNull();

    // Not yet expired, but nothing left to grant: the sweep closes it honestly.
    const closed = await sweepExpiredSupportGrants(db, new Date());
    expect(closed.map((c) => [c.grant.id, c.how])).toContainEqual([grant.id, 'member-removed']);
    const [entry] = (await activityRows(org.id)).filter((e) => e.action === 'support.left');
    expect(entry.summary).toBe('support person left; support membership had already been removed');
    expect(entry.metadata).toMatchObject({ releasedBy: 'member-removed', memberRemoved: false });
  });

  test('findWorkspacesForEmail lists memberships with role, series count, and grant status', async () => {
    const person = await makeUser('finder');
    const personal = await makeOrg('personal', 'u');
    await addOwner(personal.id, person.id);
    const club = await makeOrg('club');
    const clubOwner = await makeUser('clubowner');
    await addOwner(club.id, clubOwner.id);
    await db.insert(schema.series).values({
      id: crypto.randomUUID(),
      workspaceId: club.id,
      name: 'Autumn League',
      displayOrder: 0,
    });
    await joinAsSupport(db, { orgSlugOrId: club.slug, email: person.email });

    const found = await findWorkspacesForEmail(db, person.email.toUpperCase());
    expect(found.user.id).toBe(person.id);
    const bySlug = Object.fromEntries(found.workspaces.map((w) => [w.org.slug, w]));
    expect(bySlug[personal.slug]).toMatchObject({
      personal: true,
      role: 'owner',
      seriesCount: 0,
      supportGrant: false,
    });
    expect(bySlug[club.slug]).toMatchObject({
      personal: false,
      role: 'member',
      seriesCount: 1,
      supportGrant: true,
    });

    await expect(findWorkspacesForEmail(db, 'nobody@sailscoring.test')).rejects.toThrow(
      /not found/,
    );
  });
});
