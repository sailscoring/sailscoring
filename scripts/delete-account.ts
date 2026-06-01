/**
 * Manual admin script for deleting a user account and its private data.
 *
 * Scope today: cleaning up test accounts. There is deliberately no
 * backup-before-delete step — see `docs/account-admin.md`. Don't point this
 * at production without re-reading that caveat.
 *
 * Why this can't be a single `DELETE FROM user`: most things keyed on the
 * user cascade when the row goes (sessions, accounts, member rows,
 * invitations, org_requests — all FK `user.id` with `onDelete: cascade`,
 * see `lib/db/schema/auth.ts`). Workspaces do **not**: an `organization` has
 * no FK back to its owner, only `member` rows linking the two. So deleting
 * the user cascades their *memberships* away but leaves every workspace they
 * were in standing — including their personal workspace, which would become
 * an orphaned org with all its series/race/competitor data and no members.
 *
 * The rule this script applies: a workspace is deleted (cascading through all
 * its data — see `deleteOrg`) only if this user is its **sole member**. Shared
 * workspaces are preserved and the user is simply removed from them via the
 * cascade. If the user was the sole *owner* of a shared workspace, that's
 * flagged in the plan — deleting them leaves it ownerless, which an admin
 * should resolve with `provision-org set-role` first.
 *
 * Writes directly to the Drizzle tables, like `change-email.ts` and
 * `provision-org.ts`, for the same reason: Better Auth's HTTP endpoints want
 * a session, which is awkward from a one-shot admin script.
 *
 * Usage:
 *   pnpm delete-account <email>            # dry run — prints the plan
 *   pnpm delete-account <email> --force    # actually delete
 */

import { eq } from 'drizzle-orm';

import { getDb, getDbClient, type SailScoringDb } from '@/lib/db/client';
import { member, organization, user } from '@/lib/db/schema/auth';
import { deleteOrg, summariseOrg } from './provision-org';

export interface AccountWorkspace {
  id: string;
  name: string;
  slug: string;
  /** This user's role in the workspace. */
  role: string;
  /** Total members in the workspace, including this user. */
  memberCount: number;
  /** True when this user is the only member — the workspace gets deleted. */
  soleMember: boolean;
  /** Set when this user is the only owner but others remain (left ownerless). */
  ownerlessAfter: boolean;
  series: number;
  races: number;
  competitors: number;
  fleets: number;
}

export interface DeleteAccountPlan {
  user: { id: string; email: string; name: string };
  workspaces: AccountWorkspace[];
}

async function findUserByEmail(
  db: SailScoringDb,
  email: string,
): Promise<{ id: string; email: string; name: string } | null> {
  const [row] = await db
    .select({ id: user.id, email: user.email, name: user.name })
    .from(user)
    .where(eq(user.email, email.trim().toLowerCase()))
    .limit(1);
  return row ?? null;
}

/**
 * Read-only: work out what deleting `email` would do, without touching the DB.
 */
export async function planDeleteAccount(
  db: SailScoringDb,
  args: { email: string },
): Promise<DeleteAccountPlan> {
  const target = await findUserByEmail(db, args.email);
  if (!target) throw new Error(`no user with email "${args.email.trim().toLowerCase()}"`);

  const memberships = await db
    .select({
      orgId: member.organizationId,
      role: member.role,
      name: organization.name,
      slug: organization.slug,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, target.id))
    .orderBy(organization.name);

  const workspaces: AccountWorkspace[] = [];
  for (const m of memberships) {
    // summariseOrg gives both the total member count and the data counts.
    const summary = await summariseOrg(db, { orgSlugOrId: m.orgId });
    const soleMember = summary.members <= 1;
    let ownerlessAfter = false;
    if (!soleMember && m.role === 'owner') {
      // If this user is the workspace's only owner, removing them leaves it
      // ownerless (other members remain, but none can administer it).
      const owners = await db
        .select({ role: member.role })
        .from(member)
        .where(eq(member.organizationId, m.orgId));
      ownerlessAfter = owners.filter((r) => r.role === 'owner').length <= 1;
    }
    workspaces.push({
      id: m.orgId,
      name: m.name,
      slug: m.slug,
      role: m.role,
      memberCount: summary.members,
      soleMember,
      ownerlessAfter,
      series: summary.series,
      races: summary.races,
      competitors: summary.competitors,
      fleets: summary.fleets,
    });
  }

  return { user: target, workspaces };
}

/**
 * Execute the plan: delete each sole-member workspace (cascading through all
 * its data), then delete the user (cascading sessions, accounts, remaining
 * memberships, invitations, and org-creation requests). Ordered orgs-first so
 * the user delete only has to mop up shared-workspace membership rows.
 */
export async function deleteAccount(
  db: SailScoringDb,
  args: { email: string },
): Promise<DeleteAccountPlan> {
  const plan = await planDeleteAccount(db, args);
  for (const ws of plan.workspaces) {
    if (ws.soleMember) {
      await deleteOrg(db, { orgSlugOrId: ws.id });
    }
  }
  await db.delete(user).where(eq(user.id, plan.user.id));
  return plan;
}

// ─── CLI dispatcher ──────────────────────────────────────────────────────────

function usage(): string {
  return `delete-account — admin: delete a user account and its private data

  pnpm delete-account <email>            dry run — print what would be deleted
  pnpm delete-account <email> --force    actually delete

Deletes the user (cascading sessions, accounts, memberships, invitations, and
org-creation requests) plus any workspace where the user is the SOLE member —
which cascades through that workspace's series, races, competitors, and fleets.
Shared workspaces are preserved; the user is just removed from them. A workspace
the user solely owns but shares with others is flagged (left ownerless) — fix
with provision-org set-role before deleting.

No backup is taken. Intended for test-account cleanup. Reads DATABASE_URL.`;
}

function printPlan(plan: DeleteAccountPlan): void {
  console.log(`user "${plan.user.email}" (name: ${plan.user.name || '(no name)'}, id: ${plan.user.id})`);
  if (plan.workspaces.length === 0) {
    console.log('  (no workspace memberships)');
    return;
  }
  for (const ws of plan.workspaces) {
    const fate = ws.soleMember ? 'DELETE (sole member)' : `keep (${ws.memberCount} members)`;
    console.log(`\n  workspace "${ws.name}" (slug: ${ws.slug}, id: ${ws.id})`);
    console.log(`    role:        ${ws.role}`);
    console.log(`    members:     ${ws.memberCount}  → ${fate}`);
    console.log(`    series:      ${ws.series}`);
    console.log(`    races:       ${ws.races}`);
    console.log(`    competitors: ${ws.competitors}`);
    console.log(`    fleets:      ${ws.fleets}`);
    if (ws.ownerlessAfter) {
      console.log('    ⚠ you are the only owner — this workspace is left OWNERLESS.');
      console.log('      Fix with: provision-org set-role <slug> <other-email> owner');
    }
  }
}

export async function runCli(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    console.log(usage());
    return argv.length === 0 ? 1 : 0;
  }

  const positional = argv.filter((a) => !a.startsWith('--'));
  const force = argv.includes('--force');
  if (positional.length !== 1) {
    console.error('expected exactly one argument: <email>\n');
    console.error(usage());
    return 1;
  }
  const [email] = positional;
  const db = getDb();

  try {
    const plan = await planDeleteAccount(db, { email });
    printPlan(plan);
    if (!force) {
      console.log('\nDry run — pass --force to actually delete.');
      return 0;
    }
    await deleteAccount(db, { email });
    const deleted = plan.workspaces.filter((w) => w.soleMember).length;
    console.log(`\ndeleted user "${plan.user.email}" and ${deleted} sole-member workspace(s).`);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const code = await runCli(process.argv.slice(2));
  await getDbClient().end();
  process.exit(code);
}
