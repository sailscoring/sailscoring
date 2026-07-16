import { notFound } from 'next/navigation';

import { requireWorkspace } from '@/lib/auth/require-workspace';
import { RankingsList } from '@/components/rankings/rankings-list';

export const dynamic = 'force-dynamic';

/**
 * Workspace cross-series rankings (#209). Gated on the `rankings` feature:
 * the page 404s unless the workspace has the flag, matching the API gate.
 */
export default async function RankingsPage() {
  let workspaceSlug: string;
  try {
    const workspace = await requireWorkspace();
    if (!workspace.features.includes('rankings')) notFound();
    workspaceSlug = workspace.workspaceSlug;
  } catch {
    notFound();
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Rankings</h1>
        <p className="text-sm text-muted-foreground">
          Season ladders computed across several series — a championship plus
          best-N opens, summed per sailor. Each ranking is a saved selection of
          series; the table stays current as results land.
        </p>
      </div>
      <RankingsList workspaceSlug={workspaceSlug} />
    </div>
  );
}
