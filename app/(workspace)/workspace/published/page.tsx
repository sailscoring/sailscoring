import { notFound } from 'next/navigation';

import { requireWorkspace } from '@/lib/auth/require-workspace';
import { PublishedList } from '@/components/published/published-list';

export const dynamic = 'force-dynamic';

/**
 * The workspace Published tab: management of every published results page.
 * Not feature-gated — publishing is core — and readable by any member; only
 * the Unpublish action needs the score permission (enforced in the list
 * component and by the API).
 */
export default async function PublishedPage() {
  try {
    await requireWorkspace();
  } catch {
    notFound();
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Published results</h1>
        <p className="text-sm text-muted-foreground">
          Every results page this workspace has published, live at its public
          URL until unpublished. Grouped the same way as the public listing.
        </p>
      </div>
      <PublishedList />
    </div>
  );
}
