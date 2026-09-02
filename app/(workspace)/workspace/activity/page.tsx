import { notFound } from 'next/navigation';

import { requireWorkspace } from '@/lib/auth/require-workspace';
import { WorkspaceActivity } from '@/components/activity/workspace-activity';

export const dynamic = 'force-dynamic';

/**
 * The workspace Activity tab: the whole workspace's log in one place — every
 * series' changes, and the workspace-level entries (a series deleted or
 * purged, a support session joining and leaving) that no series page can
 * show. Readable by any member; the log is what lets a panel keep each other
 * honest about who changed what.
 */
export default async function WorkspaceActivityPage() {
  try {
    await requireWorkspace();
  } catch {
    notFound();
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Activity</h1>
        <p className="text-sm text-muted-foreground">
          Everything that has happened in this workspace, newest first — across
          every series, and the workspace itself.
        </p>
      </div>
      <WorkspaceActivity />
    </div>
  );
}
