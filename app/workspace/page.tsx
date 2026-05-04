import { eq } from 'drizzle-orm';

import { USE_SERVER_DATA } from '@/lib/flags';
import { getOptionalSession } from '@/lib/auth/require-session';
import { getDb } from '@/lib/db/client';
import { member, organization } from '@/lib/db/schema/auth';
import { FtpServersCard } from '@/components/workspace-settings/ftp-servers-card';

export const dynamic = 'force-dynamic';

/**
 * ADR-008 Phase 7 — workspace settings hub.
 *
 * Renamed from `/settings` so the URL matches the page's actual scope:
 * everything here is workspace-scoped, not user-scoped. The user-level
 * page is `/account`. Cards live here as the section structure grows
 * — Phase 10 adds members + invitations + danger zone in this same hub.
 *
 * In local-first mode (USE_SERVER_DATA=false) there is no signed-in
 * workspace; the page renders without a workspace name and the FTP
 * servers card uses the IndexedDB-backed repository.
 */
export default async function WorkspacePage() {
  let workspaceName: string | null = null;
  if (USE_SERVER_DATA) {
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
  }

  const workspaceShared = USE_SERVER_DATA;
  const title = workspaceName
    ? `Workspace settings: ${workspaceName}`
    : 'Workspace settings';

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <FtpServersCard workspaceShared={workspaceShared} />
    </div>
  );
}
