/**
 * ADR-008 Phase 7 — manual workspace (organization) administration.
 *
 * Phase 10 (#153) added an in-app Members card (invite by email, role
 * changes, removal) on Workspace settings, so day-to-day membership no
 * longer needs this CLI. It remains the privileged/admin path for
 * provisioning the organization itself (create-org) — self-service org
 * creation is request-and-approve (see iteration 3) — and as the
 * out-of-process fallback for bulk or break-glass member operations.
 *
 * Operations write directly to the Better Auth Drizzle tables. The
 * organization plugin's HTTP endpoints all require a session (see
 * `node_modules/better-auth/dist/plugins/organization/routes/*`), which
 * makes them awkward for an out-of-process admin script. The
 * personal-workspace creation in `lib/auth.ts:76-92` already takes the
 * direct-write approach for the same reason — keep the two paths
 * symmetrical.
 *
 * Usage (production: against the production DATABASE_URL):
 *   pnpm tsx scripts/provision-org.ts create-org "HYC Scoring Panel" --slug hyc
 *   pnpm tsx scripts/provision-org.ts pre-create-user alice@example.com --name "Alice Adams"
 *   pnpm tsx scripts/provision-org.ts add-member hyc alice@example.com --role owner
 *   pnpm tsx scripts/provision-org.ts add-member hyc bob@example.com
 *   pnpm tsx scripts/provision-org.ts list-members hyc
 *   pnpm tsx scripts/provision-org.ts set-role hyc bob@example.com admin
 *   pnpm tsx scripts/provision-org.ts remove-member hyc bob@example.com
 *   pnpm tsx scripts/provision-org.ts delete-org hyc --force
 *
 * `add-member` looks members up by email, so they must exist as users
 * first. Either get them to sign in once (the magic-link flow creates the
 * user row and a personal workspace), or seed them ahead of time with
 * `pre-create-user`. Pre-created rows match what the sign-up hook in
 * lib/auth.ts produces, so when the user later requests a magic link
 * Better Auth recognises the email and signs them straight in.
 */

import { and, eq, or, sql } from 'drizzle-orm';

import { getDb, getDbClient, type SailScoringDb } from '@/lib/db/client';
import { member, organization, user } from '@/lib/db/schema/auth';
import { competitors, fleets, races, series } from '@/lib/db/schema/series';

export type Role = 'owner' | 'admin' | 'member';

const ROLES: Role[] = ['owner', 'admin', 'member'];

function isRole(value: string): value is Role {
  return (ROLES as string[]).includes(value);
}

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

function defaultSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

async function findOrgBySlugOrId(
  db: SailScoringDb,
  slugOrId: string,
): Promise<{ id: string; name: string; slug: string } | null> {
  const [row] = await db
    .select({ id: organization.id, name: organization.name, slug: organization.slug })
    .from(organization)
    .where(or(eq(organization.slug, slugOrId), eq(organization.id, slugOrId)))
    .limit(1);
  return row ?? null;
}

async function findUserByEmail(
  db: SailScoringDb,
  email: string,
): Promise<{ id: string; email: string; name: string } | null> {
  const [row] = await db
    .select({ id: user.id, email: user.email, name: user.name })
    .from(user)
    .where(eq(user.email, email.toLowerCase()))
    .limit(1);
  return row ?? null;
}

/**
 * Personal-workspace name used by the sign-up hook in `lib/auth.ts`.
 * Duplicated here on purpose — keeping the constant private to auth.ts
 * avoids accidentally importing the full Better Auth bundle into this
 * CLI; the workspace switcher already renders existing rows as-is, so
 * the two values just need to stay in sync by inspection.
 */
const PERSONAL_WORKSPACE_NAME = 'My Workspace';

export async function preCreateUser(
  db: SailScoringDb,
  args: { email: string; name: string },
): Promise<{ userId: string; email: string; name: string; personalWorkspaceId: string }> {
  const email = args.email.trim().toLowerCase();
  const name = args.name.trim();
  if (!email) throw new Error('email is required');
  if (!name) throw new Error('name is required');

  const existing = await findUserByEmail(db, email);
  if (existing) {
    throw new Error(`user "${email}" already exists (id: ${existing.id})`);
  }

  // Mirror lib/auth.ts databaseHooks.user.create.after — we are taking
  // the same direct-write path the sign-up hook takes, so a later
  // magic-link sign-in finds the user row by email and proceeds without
  // creating a duplicate. emailVerified stays false; Better Auth flips
  // it on first successful magic-link sign-in.
  const userId = randomId('usr');
  const orgId = randomId('org');
  const memberId = randomId('mem');
  const now = new Date();

  await db.insert(user).values({
    id: userId,
    name,
    email,
    emailVerified: false,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(organization).values({
    id: orgId,
    name: PERSONAL_WORKSPACE_NAME,
    slug: `u-${userId.slice(0, 16)}`,
    createdAt: now,
  });
  await db.insert(member).values({
    id: memberId,
    organizationId: orgId,
    userId,
    role: 'owner',
    createdAt: now,
  });
  return { userId, email, name, personalWorkspaceId: orgId };
}

export async function createOrg(
  db: SailScoringDb,
  args: { name: string; slug?: string },
): Promise<{ id: string; name: string; slug: string }> {
  const name = args.name.trim();
  if (!name) throw new Error('org name is required');
  const slug = (args.slug ?? defaultSlug(name)).trim();
  if (!slug) throw new Error('slug is required (could not derive from name)');

  const existing = await findOrgBySlugOrId(db, slug);
  if (existing) throw new Error(`org with slug "${slug}" already exists`);

  const id = randomId('org');
  await db.insert(organization).values({
    id,
    name,
    slug,
    createdAt: new Date(),
  });
  return { id, name, slug };
}

export async function addMember(
  db: SailScoringDb,
  args: { orgSlugOrId: string; email: string; role?: Role },
): Promise<{ memberId: string; userId: string; role: Role; organizationId: string }> {
  const role = args.role ?? 'member';
  if (!isRole(role)) {
    throw new Error(`invalid role "${role}" (expected one of: ${ROLES.join(', ')})`);
  }
  const org = await findOrgBySlugOrId(db, args.orgSlugOrId);
  if (!org) throw new Error(`org "${args.orgSlugOrId}" not found`);

  const u = await findUserByEmail(db, args.email);
  if (!u) {
    throw new Error(
      `user "${args.email}" not found — ask them to sign in once first to create the user row`,
    );
  }

  const [existing] = await db
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, org.id), eq(member.userId, u.id)))
    .limit(1);
  if (existing) {
    throw new Error(
      `${args.email} is already a member of "${org.slug}" (role: ${existing.role})`,
    );
  }

  const memberId = randomId('mem');
  await db.insert(member).values({
    id: memberId,
    organizationId: org.id,
    userId: u.id,
    role,
    createdAt: new Date(),
  });
  return { memberId, userId: u.id, role, organizationId: org.id };
}

export async function setRole(
  db: SailScoringDb,
  args: { orgSlugOrId: string; email: string; role: Role },
): Promise<{ memberId: string; userId: string; role: Role }> {
  if (!isRole(args.role)) {
    throw new Error(`invalid role "${args.role}" (expected one of: ${ROLES.join(', ')})`);
  }
  const org = await findOrgBySlugOrId(db, args.orgSlugOrId);
  if (!org) throw new Error(`org "${args.orgSlugOrId}" not found`);

  const u = await findUserByEmail(db, args.email);
  if (!u) throw new Error(`user "${args.email}" not found`);

  const [existing] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, org.id), eq(member.userId, u.id)))
    .limit(1);
  if (!existing) {
    throw new Error(`${args.email} is not a member of "${org.slug}"`);
  }
  await db.update(member).set({ role: args.role }).where(eq(member.id, existing.id));
  return { memberId: existing.id, userId: u.id, role: args.role };
}

export async function removeMember(
  db: SailScoringDb,
  args: { orgSlugOrId: string; email: string },
): Promise<{ removed: boolean }> {
  const org = await findOrgBySlugOrId(db, args.orgSlugOrId);
  if (!org) throw new Error(`org "${args.orgSlugOrId}" not found`);

  const u = await findUserByEmail(db, args.email);
  if (!u) throw new Error(`user "${args.email}" not found`);

  const result = await db
    .delete(member)
    .where(and(eq(member.organizationId, org.id), eq(member.userId, u.id)));
  // postgres-js delete doesn't return rowCount through Drizzle's typing;
  // a follow-up SELECT is the cheap way to confirm removal.
  const [stillThere] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, org.id), eq(member.userId, u.id)))
    .limit(1);
  void result;
  return { removed: !stillThere };
}

export interface DeleteOrgSummary {
  org: { id: string; name: string; slug: string };
  members: number;
  series: number;
  races: number;
  competitors: number;
  fleets: number;
}

export async function summariseOrg(
  db: SailScoringDb,
  args: { orgSlugOrId: string },
): Promise<DeleteOrgSummary> {
  const org = await findOrgBySlugOrId(db, args.orgSlugOrId);
  if (!org) throw new Error(`org "${args.orgSlugOrId}" not found`);
  const countExpr = sql<number>`count(*)::int`;
  const [membersRow, seriesRow, racesRow, competitorsRow, fleetsRow] = await Promise.all([
    db.select({ n: countExpr }).from(member).where(eq(member.organizationId, org.id)),
    db.select({ n: countExpr }).from(series).where(eq(series.workspaceId, org.id)),
    db.select({ n: countExpr }).from(races).where(eq(races.workspaceId, org.id)),
    db.select({ n: countExpr }).from(competitors).where(eq(competitors.workspaceId, org.id)),
    db.select({ n: countExpr }).from(fleets).where(eq(fleets.workspaceId, org.id)),
  ]);
  return {
    org,
    members: membersRow[0]?.n ?? 0,
    series: seriesRow[0]?.n ?? 0,
    races: racesRow[0]?.n ?? 0,
    competitors: competitorsRow[0]?.n ?? 0,
    fleets: fleetsRow[0]?.n ?? 0,
  };
}

export async function deleteOrg(
  db: SailScoringDb,
  args: { orgSlugOrId: string },
): Promise<{ id: string; slug: string; name: string }> {
  const org = await findOrgBySlugOrId(db, args.orgSlugOrId);
  if (!org) throw new Error(`org "${args.orgSlugOrId}" not found`);
  // Members, invitations, series, races, competitors, fleets, ftp_servers,
  // feedback, idempotency_keys all FK organization.id with onDelete cascade,
  // so the single delete cascades through everything.
  await db.delete(organization).where(eq(organization.id, org.id));
  return org;
}

export interface MemberRow {
  email: string;
  name: string;
  role: Role;
  joinedAt: Date;
}

export async function listMembers(
  db: SailScoringDb,
  args: { orgSlugOrId: string },
): Promise<{ org: { id: string; name: string; slug: string }; members: MemberRow[] }> {
  const org = await findOrgBySlugOrId(db, args.orgSlugOrId);
  if (!org) throw new Error(`org "${args.orgSlugOrId}" not found`);

  const rows = await db
    .select({
      email: user.email,
      name: user.name,
      role: member.role,
      joinedAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, org.id))
    .orderBy(member.createdAt);
  return {
    org,
    members: rows.map((r) => ({
      email: r.email,
      name: r.name,
      role: r.role as Role,
      joinedAt: r.joinedAt,
    })),
  };
}

// ─── CLI dispatcher ──────────────────────────────────────────────────────────

interface ParsedFlags {
  positional: string[];
  flags: Record<string, string>;
}

function parseArgs(argv: string[]): ParsedFlags {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = 'true';
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function usage(): string {
  return `provision-org — ADR-008 Phase 7 manual org administration

  create-org <name> [--slug <slug>]
  delete-org <org-slug-or-id> [--force]
  pre-create-user <email> --name <full-name>
  add-member <org-slug-or-id> <email> [--role owner|admin|member]
  set-role <org-slug-or-id> <email> <role>
  remove-member <org-slug-or-id> <email>
  list-members <org-slug-or-id>

delete-org without --force only prints what would be deleted. Cascades
through members, invitations, and all series/race/competitor data.

Members must already exist (signed in once, or seeded via pre-create-user).
Reads DATABASE_URL.`;
}

export async function runCli(argv: string[]): Promise<number> {
  const [subcommand, ...rest] = argv;
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    console.log(usage());
    return subcommand ? 0 : 1;
  }

  const { positional, flags } = parseArgs(rest);
  const db = getDb();

  try {
    switch (subcommand) {
      case 'create-org': {
        const [name] = positional;
        if (!name) throw new Error('create-org: <name> is required');
        const result = await createOrg(db, { name, slug: flags.slug });
        console.log(`created org "${result.name}" (slug: ${result.slug}, id: ${result.id})`);
        return 0;
      }
      case 'delete-org': {
        const [orgSlugOrId] = positional;
        if (!orgSlugOrId) throw new Error('delete-org: <org-slug-or-id> is required');
        const summary = await summariseOrg(db, { orgSlugOrId });
        const { org, members, series: nSeries, races: nRaces, competitors: nCompetitors, fleets: nFleets } = summary;
        console.log(`org "${org.name}" (slug: ${org.slug}, id: ${org.id})`);
        console.log(`  members:     ${members}`);
        console.log(`  series:      ${nSeries}`);
        console.log(`  races:       ${nRaces}`);
        console.log(`  competitors: ${nCompetitors}`);
        console.log(`  fleets:      ${nFleets}`);
        if (flags.force !== 'true') {
          console.log('\nDry run — pass --force to actually delete (cascades through all of the above).');
          return 0;
        }
        await deleteOrg(db, { orgSlugOrId: org.id });
        console.log(`\ndeleted org "${org.slug}"`);
        return 0;
      }
      case 'pre-create-user': {
        const [email] = positional;
        if (!email) throw new Error('pre-create-user: <email> is required');
        const name = flags.name;
        if (!name || name === 'true') {
          throw new Error('pre-create-user: --name <full-name> is required');
        }
        const result = await preCreateUser(db, { email, name });
        console.log(
          `pre-created user ${result.email} (id: ${result.userId}, personal workspace: ${result.personalWorkspaceId})`,
        );
        return 0;
      }
      case 'add-member': {
        const [orgSlugOrId, email] = positional;
        if (!orgSlugOrId || !email) {
          throw new Error('add-member: <org-slug-or-id> <email> are required');
        }
        const role = (flags.role as Role) ?? 'member';
        const result = await addMember(db, { orgSlugOrId, email, role });
        console.log(`added ${email} to ${orgSlugOrId} as ${result.role}`);
        return 0;
      }
      case 'set-role': {
        const [orgSlugOrId, email, role] = positional;
        if (!orgSlugOrId || !email || !role) {
          throw new Error('set-role: <org-slug-or-id> <email> <role> are required');
        }
        if (!isRole(role)) {
          throw new Error(`invalid role "${role}" (expected one of: ${ROLES.join(', ')})`);
        }
        const result = await setRole(db, { orgSlugOrId, email, role });
        console.log(`set ${email} role to ${result.role} in ${orgSlugOrId}`);
        return 0;
      }
      case 'remove-member': {
        const [orgSlugOrId, email] = positional;
        if (!orgSlugOrId || !email) {
          throw new Error('remove-member: <org-slug-or-id> <email> are required');
        }
        const result = await removeMember(db, { orgSlugOrId, email });
        if (result.removed) {
          console.log(`removed ${email} from ${orgSlugOrId}`);
        } else {
          console.log(`${email} was not a member of ${orgSlugOrId}`);
        }
        return 0;
      }
      case 'list-members': {
        const [orgSlugOrId] = positional;
        if (!orgSlugOrId) throw new Error('list-members: <org-slug-or-id> is required');
        const { org, members } = await listMembers(db, { orgSlugOrId });
        console.log(`${org.name} (slug: ${org.slug}, id: ${org.id})`);
        if (members.length === 0) {
          console.log('  (no members)');
        } else {
          for (const m of members) {
            const joined = m.joinedAt.toISOString().slice(0, 10);
            console.log(`  ${m.role.padEnd(6)}  ${m.email.padEnd(40)}  ${m.name || '(no name)'}  joined ${joined}`);
          }
        }
        return 0;
      }
      default:
        console.error(`unknown subcommand: ${subcommand}\n`);
        console.error(usage());
        return 1;
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

// ESM "main module" check. `tsx scripts/provision-org.ts` runs this file
// directly; importing it from a test does not.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const code = await runCli(process.argv.slice(2));
  await getDbClient().end();
  process.exit(code);
}
