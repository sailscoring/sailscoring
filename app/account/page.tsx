import { eq } from 'drizzle-orm';

import { requireSession } from '@/lib/auth/require-session';
import { getDb } from '@/lib/db/client';
import { member, organization } from '@/lib/db/schema/auth';
import { OrgRequestCard } from '@/components/account/org-request-card';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  // Defence in depth: middleware redirects unauthenticated users, but
  // the page enforces the check too. CVE-2025-29927 made middleware-only
  // auth a known failure mode.
  const session = await requireSession();

  // Show the *active* workspace (matches what every server-rendered page
  // sees via `requireWorkspace`), not "first by createdAt." The Phase 7
  // workspace switcher is the source of truth for picking among multiple
  // memberships; this page just reflects the current pick.
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
    .orderBy(member.createdAt);
  const activeId = session.session.activeOrganizationId ?? null;
  const workspace =
    (activeId ? rows.find((r) => r.id === activeId) : null) ??
    (rows.length === 1 ? rows[0] : null);

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
        {rows.length > 1 && (
          <>
            <dt className="text-muted-foreground">Memberships</dt>
            <dd>
              {rows.length} workspace{rows.length === 1 ? '' : 's'} — switch
              from the header.
            </dd>
          </>
        )}
      </dl>

      <OrgRequestCard />
    </section>
  );
}
