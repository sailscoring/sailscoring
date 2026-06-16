import { notFound } from 'next/navigation';

import { requireWorkspace } from '@/lib/auth/require-workspace';
import { IdentitiesReconcile } from '@/components/competitor-identities/identities-reconcile';

export const dynamic = 'force-dynamic';

/**
 * Cross-series competitor reconcile surface. Gated: the page 404s when the
 * workspace doesn't have the `competitor-identity` feature, so it's invisible
 * everywhere it isn't deliberately enabled. The list, rename, and split
 * actions all run against the gated `/api/v1/competitor-identities` endpoints.
 * (Internals keep the `CompetitorIdentity` framing; the user-facing surface
 * says "Competitors".)
 */
export default async function CompetitorsPage() {
  let workspaceSlug: string;
  try {
    const workspace = await requireWorkspace();
    if (!workspace.features.includes('competitor-identity')) notFound();
    workspaceSlug = workspace.workspaceSlug;
  } catch {
    notFound();
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Competitors</h1>
        <p className="text-sm text-muted-foreground">
          One recurring competitor per row, collapsed across every series they
          entered. Reconcile the auto-matched groups: rename a competitor, or
          split off a row that was grouped by mistake.
        </p>
      </div>
      <IdentitiesReconcile workspaceSlug={workspaceSlug} />
    </div>
  );
}
