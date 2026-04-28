import { eq } from 'drizzle-orm';

import { requireSession } from '@/lib/auth/require-session';
import { getDb } from '@/lib/db/client';
import { organization } from '@/lib/db/schema/auth';
import { SignOutButton } from './sign-out-button';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  // Defence in depth: middleware redirects unauthenticated users, but
  // the page enforces the check too. CVE-2025-29927 made middleware-only
  // auth a known failure mode.
  const session = await requireSession();

  const activeOrgId = session.session.activeOrganizationId;
  let activeWorkspace: { id: string; name: string; slug: string } | null = null;
  if (activeOrgId) {
    const rows = await getDb()
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
      })
      .from(organization)
      .where(eq(organization.id, activeOrgId))
      .limit(1);
    activeWorkspace = rows[0] ?? null;
  }

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
        <dd>{activeWorkspace ? activeWorkspace.name : '—'}</dd>
        {activeWorkspace && (
          <>
            <dt className="text-muted-foreground">Slug</dt>
            <dd className="font-mono">{activeWorkspace.slug}</dd>
          </>
        )}
      </dl>

      <SignOutButton />
    </section>
  );
}
