/**
 * Support grants — time-boxed, logged access to a workspace the operator is
 * not a member of. The lifecycle behind `provision-org support …` and the
 * hourly expiry sweep.
 *
 * A grant is two rows written together: an ordinary `member` row, which is
 * what actually confers access (every membership lookup in the app stays as
 * it is), and a `support_grant` row that remembers which member row that was,
 * why it exists, and when it expires. Joining and leaving each also append an
 * activity entry in the target workspace, in the same transaction as the
 * membership change — that entry is what makes the practice legible to the
 * people whose workspace it is, so it must not be able to go missing while
 * the grant exists. The write is a direct insert rather than the app's
 * best-effort `recordActivity` seam for exactly that reason (and because
 * that seam is server-only, which an operator script cannot import).
 *
 * Every function takes the database handle explicitly, like the rest of the
 * provisioning operations, so a transaction can be threaded through and the
 * tests can hand in their own connection.
 *
 * None of this is a security control: anyone holding the production database
 * URL can bypass it. Its value is a paved path plus an audit trail, so that a
 * support session with no activity entry looks wrong to whoever reads the log
 * later.
 */

import { and, asc, desc, eq, isNull, lte, or, sql } from 'drizzle-orm';

import { isWorkspaceRole, type WorkspaceRole } from '@/lib/auth/permissions';
import type { SailScoringDb } from '@/lib/db/client';
import { member, organization, supportGrant, user } from '@/lib/db/schema/auth';
import { activityLog, series } from '@/lib/db/schema/series';

/** Without `--hours`, a grant lasts one day. */
export const DEFAULT_SUPPORT_HOURS = 24;

/** How a grant ended. */
export type SupportGrantRelease = 'left' | 'expired' | 'member-removed';

export interface OrgRef {
  id: string;
  name: string;
  slug: string;
}

export interface UserRef {
  id: string;
  email: string;
  name: string;
}

export interface SupportGrantRow {
  id: string;
  org: OrgRef;
  user: UserRef;
  /** The member row the grant inserted; null once something else removed it. */
  memberId: string | null;
  role: string;
  reason: string | null;
  grantedAt: Date;
  expiresAt: Date;
  releasedAt: Date | null;
  releasedBy: SupportGrantRelease | null;
}

export interface WorkspaceMembership {
  org: OrgRef;
  /** A personal workspace: the one-person sandbox every account gets. */
  personal: boolean;
  role: string;
  joinedAt: Date;
  seriesCount: number;
  /** Whether this membership is itself an active support grant. */
  supportGrant: boolean;
}

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

async function findOrg(db: SailScoringDb, slugOrId: string): Promise<OrgRef> {
  const [row] = await db
    .select({ id: organization.id, name: organization.name, slug: organization.slug })
    .from(organization)
    .where(or(eq(organization.slug, slugOrId), eq(organization.id, slugOrId)))
    .limit(1);
  if (!row) throw new Error(`org "${slugOrId}" not found`);
  return row;
}

async function findUser(db: SailScoringDb, email: string): Promise<UserRef> {
  const [row] = await db
    .select({ id: user.id, email: user.email, name: user.name })
    .from(user)
    .where(eq(user.email, email.trim().toLowerCase()))
    .limit(1);
  if (!row) throw new Error(`user "${email}" not found`);
  return row;
}

const GRANT_SELECTION = {
  id: supportGrant.id,
  orgId: organization.id,
  orgName: organization.name,
  orgSlug: organization.slug,
  userId: user.id,
  userEmail: user.email,
  userName: user.name,
  memberId: supportGrant.memberId,
  role: supportGrant.role,
  reason: supportGrant.reason,
  grantedAt: supportGrant.grantedAt,
  expiresAt: supportGrant.expiresAt,
  releasedAt: supportGrant.releasedAt,
  releasedBy: supportGrant.releasedBy,
};

function grantQuery(db: SailScoringDb) {
  return db
    .select(GRANT_SELECTION)
    .from(supportGrant)
    .innerJoin(organization, eq(supportGrant.organizationId, organization.id))
    .innerJoin(user, eq(supportGrant.userId, user.id));
}

type GrantSelection = Awaited<ReturnType<typeof grantQuery>>[number];

function toRow(r: GrantSelection): SupportGrantRow {
  return {
    id: r.id,
    org: { id: r.orgId, name: r.orgName, slug: r.orgSlug },
    user: { id: r.userId, email: r.userEmail, name: r.userName },
    memberId: r.memberId,
    role: r.role,
    reason: r.reason,
    grantedAt: r.grantedAt,
    expiresAt: r.expiresAt,
    releasedAt: r.releasedAt,
    releasedBy: r.releasedBy as SupportGrantRelease | null,
  };
}

async function activeGrantFor(
  db: SailScoringDb,
  orgId: string,
  userId: string,
): Promise<SupportGrantRow | null> {
  const [row] = await grantQuery(db)
    .where(
      and(
        eq(supportGrant.organizationId, orgId),
        eq(supportGrant.userId, userId),
        isNull(supportGrant.releasedAt),
      ),
    )
    .limit(1);
  return row ? toRow(row) : null;
}

/** `member` is the read-only tier; say so rather than make the reader look it up. */
function describeRole(role: string): string {
  return role === 'member' ? 'read-only' : role;
}

function formatHours(ms: number): string {
  const hours = ms / (60 * 60 * 1000);
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded} hour${rounded === 1 ? '' : 's'}`;
}

/**
 * The workspaces a person belongs to, personal one included — the lookup a
 * support request starts with, since it arrives as an email address.
 */
export async function findWorkspacesForEmail(
  db: SailScoringDb,
  email: string,
): Promise<{ user: UserRef; workspaces: WorkspaceMembership[] }> {
  const u = await findUser(db, email);
  const rows = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      role: member.role,
      joinedAt: member.createdAt,
      seriesCount: sql<number>`(select count(*)::int from ${series} where ${series.workspaceId} = ${organization.id})`,
      supportGrant: sql<boolean>`exists (select 1 from ${supportGrant} where ${supportGrant.memberId} = ${member.id} and ${supportGrant.releasedAt} is null)`,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, u.id))
    .orderBy(asc(organization.name));
  return {
    user: u,
    workspaces: rows.map((r) => ({
      org: { id: r.id, name: r.name, slug: r.slug },
      personal: r.slug.startsWith('u-'),
      role: r.role,
      joinedAt: r.joinedAt,
      seriesCount: r.seriesCount,
      supportGrant: r.supportGrant,
    })),
  };
}

/**
 * Join a workspace as support: a member row (read-only unless a higher role
 * is asked for explicitly), the grant that time-boxes it, and the activity
 * entry that announces it — one transaction. Refuses if the person is
 * already in the workspace, whether by an earlier grant or by an ordinary
 * membership: a support grant must only ever own a row it created.
 */
export async function joinAsSupport(
  db: SailScoringDb,
  args: {
    orgSlugOrId: string;
    email: string;
    hours?: number;
    reason?: string;
    role?: WorkspaceRole;
    now?: Date;
  },
): Promise<SupportGrantRow> {
  const role = args.role ?? 'member';
  if (!isWorkspaceRole(role)) throw new Error(`invalid role "${role}"`);
  const hours = args.hours ?? DEFAULT_SUPPORT_HOURS;
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error(`--hours must be a positive number (got ${args.hours})`);
  }
  const reason = args.reason?.trim() || null;
  const now = args.now ?? new Date();
  const expiresAt = new Date(now.getTime() + hours * 60 * 60 * 1000);

  const org = await findOrg(db, args.orgSlugOrId);
  const u = await findUser(db, args.email);

  return db.transaction(async (tx) => {
    const active = await activeGrantFor(tx, org.id, u.id);
    if (active) {
      throw new Error(
        `${u.email} is already in "${org.slug}" as support since ${active.grantedAt.toISOString()} (expires ${active.expiresAt.toISOString()}) — leave first`,
      );
    }
    const [existing] = await tx
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, org.id), eq(member.userId, u.id)))
      .limit(1);
    if (existing) {
      throw new Error(
        `${u.email} is already a member of "${org.slug}" (role: ${existing.role}) — that is an ordinary membership, not a support grant`,
      );
    }

    const memberId = randomId('mem');
    await tx.insert(member).values({
      id: memberId,
      organizationId: org.id,
      userId: u.id,
      role,
      createdAt: now,
    });
    const grantId = randomId('sg');
    await tx.insert(supportGrant).values({
      id: grantId,
      organizationId: org.id,
      userId: u.id,
      memberId,
      role,
      reason,
      grantedAt: now,
      expiresAt,
    });
    await tx.insert(activityLog).values({
      id: crypto.randomUUID(),
      workspaceId: org.id,
      seriesId: null,
      actorUserId: u.id,
      action: 'support.joined',
      summary: `${u.name} joined as support (${describeRole(role)}) for ${formatHours(expiresAt.getTime() - now.getTime())}${reason ? `: ${reason}` : ''}`,
      metadata: { count: 1, grantId, role, reason, expiresAt: expiresAt.toISOString() },
      createdAt: now,
    });
    return {
      id: grantId,
      org,
      user: u,
      memberId,
      role,
      reason,
      grantedAt: now,
      expiresAt,
      releasedAt: null,
      releasedBy: null,
    };
  });
}

/**
 * Close a grant: remove the member row it inserted (if it is still there),
 * mark the grant released, and log it. Shared by `leave` and the sweep; the
 * activity entry names how it ended.
 */
async function releaseGrant(
  db: SailScoringDb,
  grant: SupportGrantRow,
  how: SupportGrantRelease,
  now: Date,
): Promise<{ how: SupportGrantRelease; memberRemoved: boolean }> {
  return db.transaction(async (tx) => {
    let memberRemoved = false;
    if (grant.memberId) {
      const removed = await tx
        .delete(member)
        .where(eq(member.id, grant.memberId))
        .returning({ id: member.id });
      memberRemoved = removed.length > 0;
    }
    // If the row is already gone, the membership ended before we got here,
    // whatever the caller was doing.
    const effective: SupportGrantRelease = memberRemoved ? how : 'member-removed';
    await tx
      .update(supportGrant)
      .set({ releasedAt: now, releasedBy: effective })
      .where(eq(supportGrant.id, grant.id));
    const ending =
      effective === 'expired'
        ? 'support access expired'
        : effective === 'member-removed'
          ? 'support membership had already been removed'
          : 'support access ended';
    await tx.insert(activityLog).values({
      id: crypto.randomUUID(),
      workspaceId: grant.org.id,
      seriesId: null,
      actorUserId: grant.user.id,
      action: 'support.left',
      summary: `${grant.user.name} left; ${ending}`,
      metadata: {
        count: 1,
        grantId: grant.id,
        role: grant.role,
        reason: grant.reason,
        releasedBy: effective,
        memberRemoved,
      },
      createdAt: now,
    });
    return { how: effective, memberRemoved };
  });
}

/** The undo of `joinAsSupport`. Refuses when there is no active grant. */
export async function leaveSupport(
  db: SailScoringDb,
  args: { orgSlugOrId: string; email: string; now?: Date },
): Promise<{ grant: SupportGrantRow; how: SupportGrantRelease; memberRemoved: boolean }> {
  const now = args.now ?? new Date();
  const org = await findOrg(db, args.orgSlugOrId);
  const u = await findUser(db, args.email);
  const grant = await activeGrantFor(db, org.id, u.id);
  if (!grant) {
    const [existing] = await db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, org.id), eq(member.userId, u.id)))
      .limit(1);
    throw new Error(
      existing
        ? `${u.email} is a member of "${org.slug}" (role: ${existing.role}) but not via a support grant — use remove-member`
        : `${u.email} is not in "${org.slug}" as support`,
    );
  }
  const result = await releaseGrant(db, grant, 'left', now);
  return { grant, ...result };
}

/** Active grants (the audit question "am I still sitting in someone's workspace?"), or the full history with `all`. */
export async function listSupportGrants(
  db: SailScoringDb,
  args: { all?: boolean } = {},
): Promise<SupportGrantRow[]> {
  const q = grantQuery(db);
  const rows = args.all
    ? await q.orderBy(desc(supportGrant.grantedAt))
    : await q.where(isNull(supportGrant.releasedAt)).orderBy(desc(supportGrant.grantedAt));
  return rows.map(toRow);
}

/**
 * Close every active grant whose time is up, and any whose member row has
 * already gone underneath it. Run hourly by the cron route; returns what it
 * closed so the operator can see the sweep working.
 */
export async function sweepExpiredSupportGrants(
  db: SailScoringDb,
  now: Date = new Date(),
): Promise<Array<{ grant: SupportGrantRow; how: SupportGrantRelease }>> {
  const due = await grantQuery(db)
    .where(
      and(
        isNull(supportGrant.releasedAt),
        or(lte(supportGrant.expiresAt, now), isNull(supportGrant.memberId)),
      ),
    )
    .orderBy(asc(supportGrant.expiresAt));
  const closed: Array<{ grant: SupportGrantRow; how: SupportGrantRelease }> = [];
  for (const r of due) {
    const grant = toRow(r);
    const { how } = await releaseGrant(db, grant, 'expired', now);
    closed.push({ grant, how });
  }
  return closed;
}
