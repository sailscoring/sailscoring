import { Suspense } from 'react';
import { notFound } from 'next/navigation';

import { RecordFinishes } from '@/components/record-finishes/record-finishes';
import { hasPermission } from '@/lib/auth/permissions';
import { requireWorkspace } from '@/lib/auth/require-workspace';

export const dynamic = 'force-dynamic';

/**
 * Record finishes (#671): a phone-sized page for whoever records finishes
 * on the committee boat or in the finish hut. Pick the race, take the
 * finishing order down or import a spreadsheet of it, and submit it for a
 * scorer to review. Needs the `finish-submissions` feature and a role that
 * can submit finishes: a recorder's, or a scorer's.
 */
export default async function RecordFinishesPage() {
  let workspace;
  try {
    workspace = await requireWorkspace();
  } catch {
    notFound();
  }
  if (!workspace.features.includes('finish-submissions') || !hasPermission(workspace.role, 'submit-finishes')) {
    notFound();
  }

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Record finishes</h1>
        <p className="text-sm text-muted-foreground">
          Take a race’s finishes down and submit them. A scorer reviews them
          before they go on the finish sheet; until then you can correct them
          and submit again.
        </p>
      </div>
      <Suspense>
        <RecordFinishes userId={workspace.userId} />
      </Suspense>
    </div>
  );
}
