/**
 * ADR-009 M1 — bootstrap minting of API keys (Bearer tokens) for the CLI and
 * other API clients, before the self-service /account "API keys" card exists.
 *
 * `create` mints a key through the @better-auth/api-key plugin, so the stored
 * value is hashed; the plaintext is printed once and cannot be recovered. An
 * optional default workspace is written to the key's metadata and steers
 * workspace resolution when the client sends no `x-sailscoring-workspace`
 * header (see lib/auth/require-workspace.ts). The user must already exist —
 * get them to sign in once, or seed them with `provision-org pre-create-user`.
 *
 * Usage (production: against the production DATABASE_URL):
 *   pnpm provision-token create alice@example.com --name "alice laptop" --workspace hyc
 *   pnpm provision-token create alice@example.com --expires-in-days 90
 *   pnpm provision-token list alice@example.com
 *   pnpm provision-token revoke <key-id>
 */

import { and, eq } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { getDb, getDbClient, type SailScoringDb } from '@/lib/db/client';
import { apikey, member, organization, user } from '@/lib/db/schema/auth';

async function findUserByEmail(
  db: SailScoringDb,
  email: string,
): Promise<{ id: string; email: string } | null> {
  const [row] = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(eq(user.email, email.trim().toLowerCase()))
    .limit(1);
  return row ?? null;
}

/**
 * Resolve a workspace the user is actually a member of, by slug or id. Throws
 * if the org doesn't exist or the user isn't a member — minting a key whose
 * default workspace the user can't reach would be a silent footgun.
 */
async function findMembershipOrg(
  db: SailScoringDb,
  userId: string,
  slugOrId: string,
): Promise<{ id: string; slug: string }> {
  const [row] = await db
    .select({ id: organization.id, slug: organization.slug })
    .from(organization)
    .innerJoin(member, eq(member.organizationId, organization.id))
    .where(
      and(
        eq(member.userId, userId),
        slugOrId.startsWith('org_')
          ? eq(organization.id, slugOrId)
          : eq(organization.slug, slugOrId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new Error(
      `workspace "${slugOrId}" not found, or the user is not a member of it`,
    );
  }
  return row;
}

// An "admin" key (--admin) is minted near-unlimited — a high ceiling over a
// short window, enough to never trip a legitimate bulk import but still catch
// a runaway loop hammering the API. The plugin's own (much lower) default
// stays the floor for everything else, including future self-service keys.
const ADMIN_RATE_LIMIT_MAX = 100_000;
const ADMIN_RATE_LIMIT_WINDOW_SECONDS = 60;

export interface ResolvedRateLimit {
  enabled: boolean;
  /** undefined → fall back to the plugin's per-key default. */
  maxRequests?: number;
  windowSeconds?: number;
}

function resolveRateLimit(args: {
  admin?: boolean;
  rateLimitDisabled?: boolean;
  rateLimitMax?: number;
  rateLimitWindowSeconds?: number;
}): ResolvedRateLimit {
  if (args.rateLimitDisabled) return { enabled: false };
  const explicit =
    args.rateLimitMax !== undefined || args.rateLimitWindowSeconds !== undefined;
  if (args.admin || explicit) {
    return {
      enabled: true,
      maxRequests: args.rateLimitMax ?? (args.admin ? ADMIN_RATE_LIMIT_MAX : undefined),
      windowSeconds:
        args.rateLimitWindowSeconds ??
        (args.admin ? ADMIN_RATE_LIMIT_WINDOW_SECONDS : undefined),
    };
  }
  return { enabled: true };
}

function describeRateLimit(rl: ResolvedRateLimit): string {
  if (!rl.enabled) return 'disabled';
  if (rl.maxRequests === undefined && rl.windowSeconds === undefined) {
    return 'plugin default';
  }
  const max = rl.maxRequests ?? 'default';
  const window = rl.windowSeconds ? `${rl.windowSeconds}s` : 'default window';
  return `${max} requests / ${window}`;
}

export interface CreatedToken {
  key: string;
  id: string;
  userId: string;
  workspaceId?: string;
  workspaceSlug?: string;
  rateLimit: ResolvedRateLimit;
}

export async function createToken(
  db: SailScoringDb,
  args: {
    email: string;
    name?: string;
    workspaceSlugOrId?: string;
    expiresInDays?: number;
    admin?: boolean;
    rateLimitDisabled?: boolean;
    rateLimitMax?: number;
    rateLimitWindowSeconds?: number;
  },
): Promise<CreatedToken> {
  const u = await findUserByEmail(db, args.email);
  if (!u) {
    throw new Error(
      `user "${args.email}" not found — sign in once, or seed with provision-org pre-create-user`,
    );
  }

  let workspaceId: string | undefined;
  let workspaceSlug: string | undefined;
  if (args.workspaceSlugOrId) {
    const org = await findMembershipOrg(db, u.id, args.workspaceSlugOrId);
    workspaceId = org.id;
    workspaceSlug = org.slug;
  }

  const rateLimit = resolveRateLimit(args);

  // Mint through the plugin (no headers → server context, which keys the new
  // key to body.userId and stores the value hashed). The plaintext `key` is
  // returned exactly once. The rate-limit fields are persisted on the key row
  // and enforced per-request, so they take effect without a deploy.
  const result = await auth.api.createApiKey({
    body: {
      userId: u.id,
      ...(args.name ? { name: args.name } : {}),
      ...(workspaceId ? { metadata: { defaultWorkspace: workspaceId } } : {}),
      ...(args.expiresInDays
        ? { expiresIn: args.expiresInDays * 24 * 60 * 60 }
        : {}),
      ...(rateLimit.enabled === false
        ? { rateLimitEnabled: false }
        : rateLimit.maxRequests !== undefined || rateLimit.windowSeconds !== undefined
          ? {
              rateLimitEnabled: true,
              ...(rateLimit.maxRequests !== undefined
                ? { rateLimitMax: rateLimit.maxRequests }
                : {}),
              ...(rateLimit.windowSeconds !== undefined
                ? { rateLimitTimeWindow: rateLimit.windowSeconds * 1000 }
                : {}),
            }
          : {}),
    },
  });

  return { key: result.key, id: result.id, userId: u.id, workspaceId, workspaceSlug, rateLimit };
}

export interface TokenRow {
  id: string;
  name: string | null;
  start: string | null;
  enabled: boolean;
  createdAt: Date;
  expiresAt: Date | null;
  defaultWorkspace: string | null;
}

export async function listTokens(
  db: SailScoringDb,
  args: { email: string },
): Promise<TokenRow[]> {
  const u = await findUserByEmail(db, args.email);
  if (!u) throw new Error(`user "${args.email}" not found`);
  const rows = await db
    .select({
      id: apikey.id,
      name: apikey.name,
      start: apikey.start,
      enabled: apikey.enabled,
      createdAt: apikey.createdAt,
      expiresAt: apikey.expiresAt,
      metadata: apikey.metadata,
    })
    .from(apikey)
    .where(eq(apikey.referenceId, u.id))
    .orderBy(apikey.createdAt);
  return rows.map((r) => {
    let defaultWorkspace: string | null = null;
    if (r.metadata) {
      try {
        const meta = JSON.parse(r.metadata) as { defaultWorkspace?: unknown };
        if (typeof meta.defaultWorkspace === 'string') {
          defaultWorkspace = meta.defaultWorkspace;
        }
      } catch {
        // malformed metadata — leave defaultWorkspace null
      }
    }
    return {
      id: r.id,
      name: r.name,
      start: r.start,
      enabled: r.enabled,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      defaultWorkspace,
    };
  });
}

export async function revokeToken(
  db: SailScoringDb,
  args: { id: string },
): Promise<{ revoked: boolean }> {
  await db.delete(apikey).where(eq(apikey.id, args.id));
  const [still] = await db
    .select({ id: apikey.id })
    .from(apikey)
    .where(eq(apikey.id, args.id))
    .limit(1);
  return { revoked: !still };
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
  return `provision-token — ADR-009 M1 bootstrap API-key minting

  create <email> [--name <label>] [--workspace <slug-or-id>] [--expires-in-days <n>]
         [--admin | --no-rate-limit | --rate-limit-max <n> --rate-limit-window-seconds <n>]
  list <email>
  revoke <key-id>

create prints the plaintext key once — it is stored hashed and cannot be
recovered, so copy it immediately. --workspace sets the key's default
workspace (the client can still override per-request with the
x-sailscoring-workspace header); the user must be a member of it.

Rate limit (stored on the key, enforced per-request, no deploy needed):
  --admin                       near-unlimited (${ADMIN_RATE_LIMIT_MAX} / ${ADMIN_RATE_LIMIT_WINDOW_SECONDS}s) — for the
                                CLI and bulk import; still catches a runaway loop
  --rate-limit-max <n>          custom ceiling per window
  --rate-limit-window-seconds <n>  custom window
  --no-rate-limit               disable entirely (use sparingly)
Omit all of these to inherit the plugin's conservative default.

The user must already exist (signed in once, or seeded via
provision-org pre-create-user). Reads DATABASE_URL.`;
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
      case 'create': {
        const [email] = positional;
        if (!email) throw new Error('create: <email> is required');
        const expiresInDays =
          flags['expires-in-days'] && flags['expires-in-days'] !== 'true'
            ? Number(flags['expires-in-days'])
            : undefined;
        if (expiresInDays !== undefined && !Number.isFinite(expiresInDays)) {
          throw new Error('--expires-in-days must be a number');
        }
        const numericFlag = (name: string): number | undefined => {
          if (!flags[name] || flags[name] === 'true') return undefined;
          const n = Number(flags[name]);
          if (!Number.isFinite(n) || n <= 0) {
            throw new Error(`--${name} must be a positive number`);
          }
          return n;
        };
        const rateLimitMax = numericFlag('rate-limit-max');
        const rateLimitWindowSeconds = numericFlag('rate-limit-window-seconds');
        const rateLimitDisabled = flags['no-rate-limit'] === 'true';
        const admin = flags.admin === 'true';
        if (rateLimitDisabled && (admin || rateLimitMax || rateLimitWindowSeconds)) {
          throw new Error('--no-rate-limit cannot be combined with --admin / --rate-limit-*');
        }
        const result = await createToken(db, {
          email,
          name: flags.name && flags.name !== 'true' ? flags.name : undefined,
          workspaceSlugOrId:
            flags.workspace && flags.workspace !== 'true'
              ? flags.workspace
              : undefined,
          expiresInDays,
          admin,
          rateLimitDisabled,
          rateLimitMax,
          rateLimitWindowSeconds,
        });
        console.log(`created API key for ${email} (id: ${result.id})`);
        if (result.workspaceSlug) {
          console.log(`  default workspace: ${result.workspaceSlug}`);
        }
        console.log(`  rate limit: ${describeRateLimit(result.rateLimit)}`);
        console.log('\n  copy this now — it will not be shown again:\n');
        console.log(`  ${result.key}\n`);
        return 0;
      }
      case 'list': {
        const [email] = positional;
        if (!email) throw new Error('list: <email> is required');
        const tokens = await listTokens(db, { email });
        if (tokens.length === 0) {
          console.log(`(no API keys for ${email})`);
          return 0;
        }
        for (const t of tokens) {
          const created = t.createdAt.toISOString().slice(0, 10);
          const expires = t.expiresAt
            ? t.expiresAt.toISOString().slice(0, 10)
            : 'never';
          const status = t.enabled ? '' : ' [disabled]';
          console.log(
            `  ${t.id}  ${(t.name || '(no name)').padEnd(24)}  ${
              t.start ? `${t.start}…` : ''
            }  ws:${t.defaultWorkspace ?? '-'}  created ${created}  expires ${expires}${status}`,
          );
        }
        return 0;
      }
      case 'revoke': {
        const [id] = positional;
        if (!id) throw new Error('revoke: <key-id> is required');
        const { revoked } = await revokeToken(db, { id });
        console.log(revoked ? `revoked ${id}` : `no key with id ${id}`);
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

// "main module" check. `tsx scripts/provision-token.ts` runs this file
// directly; importing it from a test does not.
const isMain = require.main === module;
if (isMain) {
  void (async () => {
    const code = await runCli(process.argv.slice(2));
    await getDbClient().end();
    process.exit(code);
  })();
}
