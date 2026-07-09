import { notFound } from 'next/navigation';

import { requireWorkspace } from '@/lib/auth/require-workspace';
import { hasPermission } from '@/lib/auth/permissions';
import { RankingDetail } from '@/components/rankings/ranking-detail';

export const dynamic = 'force-dynamic';

/** One ranking: computed ladder + configuration editor. Same gate as the
 *  listing; the editor itself is hidden from read-only roles. */
export default async function RankingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let workspaceSlug: string;
  let canManage: boolean;
  try {
    const workspace = await requireWorkspace();
    if (!workspace.features.includes('rankings')) notFound();
    workspaceSlug = workspace.workspaceSlug;
    canManage = hasPermission(workspace.role, 'manage-series');
  } catch {
    notFound();
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <RankingDetail id={id} workspaceSlug={workspaceSlug} canManage={canManage} />
    </div>
  );
}
