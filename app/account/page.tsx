import { eq } from 'drizzle-orm';

import { requireSession } from '@/lib/auth/require-session';
import { getDb } from '@/lib/db/client';
import { member, organization } from '@/lib/db/schema/auth';
import { SignOutButton } from './sign-out-button';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  // Defence in depth: middleware redirects unauthenticated users, but
  // the page enforces the check too. CVE-2025-29927 made middleware-only
  // auth a known failure mode.
  const session = await requireSession();

  // Phase 1 has one workspace per user. Read directly from member +
  // organization rather than session.activeOrganizationId — Better Auth
  // queues user.create.after past the session-create transaction, so
  // activeOrganizationId is null on the very first session of a new
  // user. A real "switch workspace" UI lands in Phase 4.
  const rows = await getDb()
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, session.user.id))
    .orderBy(member.createdAt)
    .limit(1);
  const workspace = rows[0] ?? null;

  return (
    <section className="max-w-xl">
      <h1 className="text-2xl font-semibold mb-6">Account</h1>

      <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm mb-6">
        <dt className="text-muted-foreground">Signed in as</dt>
        <dd>{session.user.email}</dd>
        {session.user.name && (
          <>
            <dt className="text-muted-foreground">Name</dt>
            <dd>{session.user.name}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Workspace</dt>
        <dd>{workspace ? workspace.name : '—'}</dd>
        {workspace && (
          <>
            <dt className="text-muted-foreground">Slug</dt>
            <dd className="font-mono">{workspace.slug}</dd>
            <dt className="text-muted-foreground">Role</dt>
            <dd>{workspace.role}</dd>
          </>
        )}
      </dl>

      <SignOutButton />
    </section>
  );
}
