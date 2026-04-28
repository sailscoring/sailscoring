import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins/magic-link';
import { organization } from 'better-auth/plugins/organization';
import { eq } from 'drizzle-orm';

import { sendMagicLinkEmail } from '@/lib/auth/email';
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

function defaultPersonalWorkspaceName(email: string, fallback?: string | null): string {
  if (fallback && fallback.trim().length > 0) return `${fallback}'s workspace`;
  const localPart = email.split('@')[0] ?? email;
  return `${localPart}'s workspace`;
}

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
  emailAndPassword: {
    enabled: false,
  },
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        await sendMagicLinkEmail({ to: email, url });
      },
    }),
    organization(),
  ],
  databaseHooks: {
    user: {
      create: {
        async after(user) {
          // Auto-create a personal workspace on sign-up. The organization
          // plugin doesn't expose an autoCreate option today; calling
          // auth.api.createOrganization from inside this hook fails the
          // plugin's session check, so insert the organization + owner
          // member rows directly. session.create.before below picks up
          // the new org and sets it active on the first session.
          const db = getDb();
          const orgId = randomId('org');
          const memberId = randomId('mem');
          const now = new Date();
          await db.insert(authSchema.organization).values({
            id: orgId,
            name: defaultPersonalWorkspaceName(user.email, user.name),
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
        },
      },
    },
    session: {
      create: {
        async before(session) {
          if (session.activeOrganizationId) return;
          const rows = await getDb()
            .select({ id: authSchema.member.organizationId })
            .from(authSchema.member)
            .where(eq(authSchema.member.userId, session.userId))
            .limit(1);
          const first = rows[0];
          if (!first) return;
          return { data: { ...session, activeOrganizationId: first.id } };
        },
      },
    },
  },
});

export type Auth = typeof auth;
