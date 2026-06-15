import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins/magic-link';
import { organization } from 'better-auth/plugins/organization';
import { apiKey } from '@better-auth/api-key';
import { eq } from 'drizzle-orm';

import { sendInvitationEmail, sendMagicLinkEmail } from '@/lib/auth/email';
import { orgAccessControl, orgRoles } from '@/lib/auth/org-roles';
import { getDb, type SailScoringDb } from '@/lib/db/client';
import * as authSchema from '@/lib/db/schema/auth';

const lazyDb = new Proxy({} as SailScoringDb, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
}) as SailScoringDb;

function trustedOrigins(): string[] {
  const origins: string[] = [];
  if (process.env.BETTER_AUTH_URL) {
    origins.push(process.env.BETTER_AUTH_URL);
  }
  if (process.env.VERCEL_URL) {
    origins.push(`https://${process.env.VERCEL_URL}`);
  }
  return origins;
}

/** Personal workspaces all share the same generic name — they belong to
 * exactly one user, who already sees their own email and name on
 * `/account`. The switcher therefore reads "My Workspace" no matter who
 * is signed in. Existing rows from before this rename keep whatever name
 * they were created with; the switcher renders that as-is. */
const PERSONAL_WORKSPACE_NAME = 'My Workspace';

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

export const auth = betterAuth({
  appName: 'Sail Scoring',
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins: trustedOrigins(),
  database: drizzleAdapter(lazyDb, {
    provider: 'pg',
    schema: authSchema,
  }),
  // Sign-up = first magic-link verify, so the magic-link send endpoint is
  // the only realistic reputation-burn surface. Tighten it to 5 sends /
  // 600s per IP (set on the magicLink plugin below) and back the limiter
  // with Postgres so the cap holds across Vercel function instances. The
  // Playwright server-mode suite signs in many fresh users in parallel
  // from one localhost IP and would trip any limit — opt out via the env
  // var, set by `playwright.config.ts` only in server-mode CI.
  rateLimit:
    process.env.E2E_DISABLE_RATE_LIMIT === '1'
      ? { enabled: false }
      : { enabled: true, storage: 'database' },
  emailAndPassword: {
    enabled: false,
  },
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        const db = getDb();
        const [existing] = await db
          .select({ id: authSchema.user.id })
          .from(authSchema.user)
          .where(eq(authSchema.user.email, email.toLowerCase()))
          .limit(1);
        await sendMagicLinkEmail({ to: email, url, isNewUser: !existing });
      },
      rateLimit: { window: 600, max: 5 },
    }),
    organization({
      // Registers the app's role set — notably `scorer` — so the plugin's
      // invite / update-role endpoints accept it. App-level permissions are
      // enforced separately; see lib/auth/org-roles.ts.
      ac: orgAccessControl,
      roles: orgRoles,
      // Org creation is admin-approved out-of-band (Phase 10 #153, iteration 3):
      // users request a workspace and the project owner provisions it. The
      // plugin's self-serve create endpoint stays closed; personal workspaces
      // are still created directly in the sign-up hook below, not via the
      // plugin endpoint, so this flag doesn't affect them.
      allowUserToCreateOrganization: false,
      // Re-inviting an address with a pending invite supersedes the old one
      // rather than stacking duplicates.
      cancelPendingInvitationsOnReInvite: true,
      sendInvitationEmail: async (data) => {
        const base =
          process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || '';
        const inviterUser = data.inviter.user;
        await sendInvitationEmail({
          to: data.email,
          organizationName: data.organization.name,
          inviterLabel: inviterUser.name?.trim() || inviterUser.email,
          role: data.role,
          acceptUrl: `${base}/accept-invitation/${data.id}`,
        });
      },
    }),
    // Non-browser API access (ADR-009). The CLI and any API client present
    // the key as `Authorization: Bearer <key>` for public-API familiarity;
    // the plugin otherwise defaults to the `x-api-key` header. A request
    // carrying a valid key gets a synthesized session (no
    // `activeOrganizationId`); `lib/auth/require-workspace.ts` resolves the
    // target workspace from the `x-sailscoring-workspace` header or the key's
    // default-workspace metadata.
    apiKey({
      customAPIKeyGetter: (ctx) => {
        const header = ctx.headers?.get('authorization') ?? null;
        if (!header) return null;
        const match = /^Bearer\s+(.+)$/i.exec(header);
        return match ? match[1].trim() : null;
      },
    }),
  ],
  databaseHooks: {
    user: {
      create: {
        async after(user) {
          // Auto-create a personal workspace on sign-up. The organization
          // plugin doesn't expose an autoCreate option today, and calling
          // auth.api.createOrganization from inside this hook fails the
          // plugin's session check (UNAUTHORIZED on ctx.request without
          // a session). Insert the organization + owner member rows
          // directly. activeOrganizationId is intentionally not set
          // here — Better Auth queues create.after past the
          // surrounding transaction, so the session row would already
          // be committed by the time we run. /account derives the
          // workspace from member rows for now; a real switch-workspace
          // flow lands in Phase 4.
          const db = getDb();
          const orgId = randomId('org');
          const memberId = randomId('mem');
          const now = new Date();
          await db.insert(authSchema.organization).values({
            id: orgId,
            name: PERSONAL_WORKSPACE_NAME,
            slug: `u-${user.id.slice(0, 16)}`,
            createdAt: now,
          });
          await db.insert(authSchema.member).values({
            id: memberId,
            organizationId: orgId,
            userId: user.id,
            role: 'owner',
            createdAt: now,
          });
          // Seed the new personal workspace with the two synthetic sample
          // series so the first sign-in lands on a populated list. Awaited so
          // the data is present when the user reaches the series list, but
          // best-effort: a seeding failure logs and leaves an empty workspace
          // rather than failing sign-up. Dynamically imported to keep the
          // Drizzle/fs seed graph out of the auth module's eager load. The e2e
          // suite opts out so it can assert an empty baseline on fresh sign-in.
          if (process.env.E2E_DISABLE_SAMPLE_SEED !== '1') {
            try {
              const { seedSampleSeries } = await import('@/lib/sample-series/seed');
              await seedSampleSeries(orgId);
            } catch (err) {
              console.error('[sample-series] seeding failed for workspace', orgId, err);
            }
          }
        },
      },
    },
  },
});

export type Auth = typeof auth;
