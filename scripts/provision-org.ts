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
import { member, organization, orgRequest, user } from '@/lib/db/schema/auth';
import { competitors, fleets, races, series } from '@/lib/db/schema/series';
import {
  ALL_FEATURE_KEYS,
  DEFAULT_ON_FEATURES,
  isFeatureKey,
  parseOrgMetadata,
  serializeOrgMetadata,
  type FeatureKey,
} from '@/lib/features';

export type Role = 'owner' | 'admin' | 'member';

/**
 * Parse a comma-separated `--enable-feature` value into validated feature
 * keys. The single-value arg parser means repeated `--enable-feature` flags
 * collapse, so multiple features are given as `--enable-feature a,b`.
 */
function parseFeatureList(raw: string | undefined): FeatureKey[] {
  if (!raw || raw === 'true') return [];
  const keys = raw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  const unknown = keys.filter((k) => !isFeatureKey(k));
  if (unknown.length > 0) {
    throw new Error(
      `unknown feature(s): ${unknown.join(', ')} — valid keys: ${ALL_FEATURE_KEYS.join(', ')}`,
    );
  }
  return keys as FeatureKey[];
}

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
  // Mirror the sign-up hook: seed the new personal workspace with the sample
  // series. Best-effort — a seeding failure shouldn't abort user provisioning.
  try {
    const { seedSampleSeries } = await import('@/lib/sample-series/seed');
    await seedSampleSeries(orgId, db);
  } catch (err) {
    console.error(`[sample-series] seeding failed for ${email}'s workspace:`, err);
  }
  return { userId, email, name, personalWorkspaceId: orgId };
}

export async function createOrg(
  db: SailScoringDb,
  args: { name: string; slug?: string; enabledFeatures?: FeatureKey[] },
): Promise<{ id: string; name: string; slug: string }> {
  const name = args.name.trim();
  if (!name) throw new Error('org name is required');
  const slug = (args.slug ?? defaultSlug(name)).trim();
  if (!slug) throw new Error('slug is required (could not derive from name)');

  const existing = await findOrgBySlugOrId(db, slug);
  if (existing) throw new Error(`org with slug "${slug}" already exists`);

  const id = randomId('org');
  // provision-org always creates an onboarded club workspace (#155).
  const metadata =
    args.enabledFeatures && args.enabledFeatures.length > 0
      ? serializeOrgMetadata({
          kind: 'club',
          enabledFeatures: args.enabledFeatures,
          disabledFeatures: [],
        })
      : null;
  await db.insert(organization).values({
    id,
    name,
    slug,
    metadata,
    createdAt: new Date(),
  });
  return { id, name, slug };
}

/**
 * Turn an experimental feature (#155) on or off for an existing club
 * workspace. Reads the current metadata, mutates the enabled/disabled sets,
 * and writes it back. Returns the resulting enabled-feature list.
 *
 * Enabling adds to `enabledFeatures` and clears any opt-out. Disabling removes
 * from `enabledFeatures`; for a default-on feature it also records an explicit
 * opt-out in `disabledFeatures` (for opt-in features, dropping the enable is
 * enough). Both directions are idempotent.
 */
export async function setOrgFeature(
  db: SailScoringDb,
  args: { orgSlugOrId: string; feature: FeatureKey; enabled: boolean },
): Promise<{ org: { id: string; name: string; slug: string }; enabledFeatures: FeatureKey[] }> {
  const org = await findOrgBySlugOrId(db, args.orgSlugOrId);
  if (!org) throw new Error(`org "${args.orgSlugOrId}" not found`);
  const [row] = await db
    .select({ metadata: organization.metadata })
    .from(organization)
    .where(eq(organization.id, org.id))
    .limit(1);
  const meta = parseOrgMetadata(row?.metadata ?? null, org.slug);
  const enabled = new Set(meta.enabledFeatures);
  const disabled = new Set(meta.disabledFeatures);
  if (args.enabled) {
    enabled.add(args.feature);
    disabled.delete(args.feature);
  } else {
    enabled.delete(args.feature);
    if (DEFAULT_ON_FEATURES.includes(args.feature)) disabled.add(args.feature);
  }
  const enabledFeatures = [...enabled];
  await db
    .update(organization)
    .set({
      metadata: serializeOrgMetadata({
        kind: meta.kind,
        enabledFeatures,
        disabledFeatures: [...disabled],
      }),
    })
    .where(eq(organization.id, org.id));
  return { org, enabledFeatures };
}

/**
 * List the orgs that have a given feature enabled — the containment-audience
 * query (#155). Metadata is a text JSON column, so we scan and parse in JS;
 * there are few orgs and this runs from the CLI.
 */
export async function listOrgsWithFeature(
  db: SailScoringDb,
  feature: FeatureKey,
): Promise<Array<{ id: string; name: string; slug: string }>> {
  const rows = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      metadata: organization.metadata,
    })
    .from(organization);
  return rows
    .filter((r) => parseOrgMetadata(r.metadata, r.slug).enabledFeatures.includes(feature))
    .map(({ id, name, slug }) => ({ id, name, slug }));
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

// ─── Org-creation requests (#153, iteration 3) ───────────────────────────────

export interface OrgRequestSummary {
  id: string;
  userEmail: string;
  requestedName: string;
  note: string | null;
  status: string;
  createdAt: Date;
}

export async function listRequests(
  db: SailScoringDb,
  args: { all?: boolean } = {},
): Promise<OrgRequestSummary[]> {
  const select = {
    id: orgRequest.id,
    userEmail: orgRequest.userEmail,
    requestedName: orgRequest.requestedName,
    note: orgRequest.note,
    status: orgRequest.status,
    createdAt: orgRequest.createdAt,
  };
  return args.all
    ? db.select(select).from(orgRequest).orderBy(orgRequest.createdAt)
    : db
        .select(select)
        .from(orgRequest)
        .where(eq(orgRequest.status, 'pending'))
        .orderBy(orgRequest.createdAt);
}

/**
 * Fulfil a pending request: create the workspace, add the requester as its
 * owner, and mark the request fulfilled — all in one transaction so a partial
 * fulfilment can't leave an orphaned org or an unflagged request. The
 * requester already exists as a user (they were signed in to submit), so
 * `addMember` finds them by email.
 */
export async function fulfilRequest(
  db: SailScoringDb,
  args: { requestId: string; slug?: string; enabledFeatures?: FeatureKey[] },
): Promise<{ org: { id: string; name: string; slug: string }; email: string }> {
  const [req] = await db
    .select()
    .from(orgRequest)
    .where(eq(orgRequest.id, args.requestId))
    .limit(1);
  if (!req) throw new Error(`request "${args.requestId}" not found`);
  if (req.status !== 'pending') {
    throw new Error(`request "${args.requestId}" is already ${req.status}`);
  }

  return db.transaction(async (tx) => {
    const org = await createOrg(tx, {
      name: req.requestedName,
      slug: args.slug,
      enabledFeatures: args.enabledFeatures,
    });
    await addMember(tx, { orgSlugOrId: org.id, email: req.userEmail, role: 'owner' });
    await tx
      .update(orgRequest)
      .set({ status: 'fulfilled', resolvedAt: new Date(), resolvedOrgId: org.id })
      .where(eq(orgRequest.id, req.id));
    return { org, email: req.userEmail };
  });
}

export async function declineRequest(
  db: SailScoringDb,
  args: { requestId: string },
): Promise<{ requestedName: string; userEmail: string }> {
  const [req] = await db
    .select()
    .from(orgRequest)
    .where(eq(orgRequest.id, args.requestId))
    .limit(1);
  if (!req) throw new Error(`request "${args.requestId}" not found`);
  if (req.status !== 'pending') {
    throw new Error(`request "${args.requestId}" is already ${req.status}`);
  }
  await db
    .update(orgRequest)
    .set({ status: 'declined', resolvedAt: new Date() })
    .where(eq(orgRequest.id, req.id));
  return { requestedName: req.requestedName, userEmail: req.userEmail };
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

  create-org <name> [--slug <slug>] [--enable-feature <key[,key...]>]
  delete-org <org-slug-or-id> [--force]
  pre-create-user <email> --name <full-name>
  add-member <org-slug-or-id> <email> [--role owner|admin|member]
  set-role <org-slug-or-id> <email> <role>
  remove-member <org-slug-or-id> <email>
  list-members <org-slug-or-id>
  list-requests [--all]
  fulfil-request <request-id> [--slug <slug>] [--enable-feature <key[,key...]>]
  decline-request <request-id>
  enable-feature <org-slug-or-id> <feature>
  disable-feature <org-slug-or-id> <feature>
  list-feature <feature>

delete-org without --force only prints what would be deleted. Cascades
through members, invitations, and all series/race/competitor data.

list-requests shows pending self-service workspace requests (#153); --all
includes resolved ones. fulfil-request creates the workspace, adds the
requester as owner, and marks the request fulfilled.

enable-feature / disable-feature toggle an experimental feature (#155) for a
club workspace; list-feature prints which orgs have a feature enabled (the
containment-audience query). Feature keys: ${ALL_FEATURE_KEYS.join(', ')}.

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
        const enabledFeatures = parseFeatureList(flags['enable-feature']);
        const result = await createOrg(db, { name, slug: flags.slug, enabledFeatures });
        console.log(`created org "${result.name}" (slug: ${result.slug}, id: ${result.id})`);
        if (enabledFeatures.length > 0) {
          console.log(`  features: ${enabledFeatures.join(', ')}`);
        }
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
      case 'list-requests': {
        const requests = await listRequests(db, { all: flags.all === 'true' });
        if (requests.length === 0) {
          console.log(flags.all === 'true' ? '(no requests)' : '(no pending requests)');
          return 0;
        }
        for (const r of requests) {
          const when = r.createdAt.toISOString().slice(0, 10);
          console.log(`${r.status.padEnd(9)}  ${r.id}  ${r.userEmail.padEnd(36)}  "${r.requestedName}"  (${when})`);
          if (r.note) console.log(`             note: ${r.note}`);
        }
        return 0;
      }
      case 'fulfil-request': {
        const [requestId] = positional;
        if (!requestId) throw new Error('fulfil-request: <request-id> is required');
        const enabledFeatures = parseFeatureList(flags['enable-feature']);
        const { org, email } = await fulfilRequest(db, {
          requestId,
          slug: flags.slug,
          enabledFeatures,
        });
        console.log(
          `fulfilled: created "${org.name}" (slug: ${org.slug}, id: ${org.id}) and added ${email} as owner`,
        );
        if (enabledFeatures.length > 0) {
          console.log(`  features: ${enabledFeatures.join(', ')}`);
        }
        return 0;
      }
      case 'decline-request': {
        const [requestId] = positional;
        if (!requestId) throw new Error('decline-request: <request-id> is required');
        const { requestedName, userEmail } = await declineRequest(db, { requestId });
        console.log(`declined request "${requestedName}" from ${userEmail}`);
        return 0;
      }
      case 'enable-feature':
      case 'disable-feature': {
        const [orgSlugOrId, feature] = positional;
        if (!orgSlugOrId || !feature) {
          throw new Error(`${subcommand}: <org-slug-or-id> <feature> are required`);
        }
        if (!isFeatureKey(feature)) {
          throw new Error(
            `unknown feature "${feature}" — valid keys: ${ALL_FEATURE_KEYS.join(', ')}`,
          );
        }
        const enabled = subcommand === 'enable-feature';
        const result = await setOrgFeature(db, { orgSlugOrId, feature, enabled });
        console.log(
          `${enabled ? 'enabled' : 'disabled'} "${feature}" for ${result.org.slug} — now: ${
            result.enabledFeatures.length > 0 ? result.enabledFeatures.join(', ') : '(none)'
          }`,
        );
        return 0;
      }
      case 'list-feature': {
        const [feature] = positional;
        if (!feature) throw new Error('list-feature: <feature> is required');
        if (!isFeatureKey(feature)) {
          throw new Error(
            `unknown feature "${feature}" — valid keys: ${ALL_FEATURE_KEYS.join(', ')}`,
          );
        }
        const orgs = await listOrgsWithFeature(db, feature);
        if (orgs.length === 0) {
          console.log(`(no orgs have "${feature}" enabled)`);
          return 0;
        }
        console.log(`orgs with "${feature}" enabled:`);
        for (const o of orgs) {
          console.log(`  ${o.slug.padEnd(24)}  ${o.name}  (id: ${o.id})`);
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

// "main module" check. `tsx scripts/provision-org.ts` runs this file
// directly; importing it from a test does not.
const isMain = require.main === module;
if (isMain) {
  void (async () => {
    const code = await runCli(process.argv.slice(2));
    await getDbClient().end();
    process.exit(code);
  })();
}
