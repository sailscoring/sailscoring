import { eq } from 'drizzle-orm';

import { getOptionalSession } from '@/lib/auth/require-session';
import { getDb } from '@/lib/db/client';
import { member, organization } from '@/lib/db/schema/auth';
import { FtpServersCard } from '@/components/workspace-settings/ftp-servers-card';

export const dynamic = 'force-dynamic';

/**
 * Workspace settings hub. Everything here is workspace-scoped, not
 * user-scoped; the user-level page is `/account`. Cards live here as
 * the section structure grows.
 */
export default async function WorkspacePage() {
  let workspaceName: string | null = null;
  const session = await getOptionalSession();
  if (session) {
    const activeId = session.session.activeOrganizationId ?? null;
    if (activeId) {
      const [row] = await getDb()
        .select({ name: organization.name })
        .from(organization)
        .where(eq(organization.id, activeId))
        .limit(1);
      workspaceName = row?.name ?? null;
    } else {
      // Bootstrap edge case: brand-new user lands here before
      // requireWorkspace's auto-pick has written activeOrganizationId.
      // Look at memberships directly to choose a label.
      const rows = await getDb()
        .select({ name: organization.name })
        .from(member)
        .innerJoin(organization, eq(member.organizationId, organization.id))
        .where(eq(member.userId, session.user.id))
        .orderBy(member.createdAt)
        .limit(1);
      workspaceName = rows[0]?.name ?? null;
    }
  }

  const title = workspaceName
    ? `Workspace settings: ${workspaceName}`
    : 'Workspace settings';

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <FtpServersCard />
    </div>
  );
}
