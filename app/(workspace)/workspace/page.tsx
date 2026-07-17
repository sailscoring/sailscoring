import { eq } from 'drizzle-orm';

import { getOptionalSession } from '@/lib/auth/require-session';
import {
  requireWorkspace,
  type WorkspaceContext,
} from '@/lib/auth/require-workspace';
import { hasPermission } from '@/lib/auth/permissions';
import { getDb } from '@/lib/db/client';
import { member, organization } from '@/lib/db/schema/auth';
import { CategoriesCard } from '@/components/workspace-settings/categories-card';
import { FeaturesCard } from '@/components/workspace-settings/features-card';
import { FtpServersCard } from '@/components/workspace-settings/ftp-servers-card';
import { LogosCard } from '@/components/workspace-settings/logos-card';
import { MembersCard } from '@/components/workspace-settings/members-card';

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

  // Feature-gated cards (#155) don't mount when their feature is off — they
  // would otherwise fetch and hit the server-side feature gate (403). The
  // same goes for cards whose API surface the viewer's role can't use: the
  // logo and FTP cards are manage-workspace tools (the FTP list endpoint
  // won't even answer reads below that), and the categories card's only
  // purpose is editing.
  let workspace: WorkspaceContext | null = null;
  try {
    workspace = await requireWorkspace();
  } catch {
    workspace = null;
  }
  const features = workspace?.features ?? [];
  const canManageSeries =
    workspace !== null && hasPermission(workspace.role, 'manage-series');
  const canManageWorkspace =
    workspace !== null && hasPermission(workspace.role, 'manage-workspace');

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <MembersCard
        currentUserEmail={session?.user.email ?? null}
        canAssignScorer={features.includes('fine-grained-roles')}
      />
      {canManageSeries && <CategoriesCard />}
      {canManageWorkspace && <FeaturesCard />}
      {features.includes('logo-library') && canManageWorkspace && <LogosCard />}
      {features.includes('ftp-upload') && canManageWorkspace && <FtpServersCard />}
    </div>
  );
}
