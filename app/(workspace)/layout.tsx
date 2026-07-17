'use client';

import { useRouter } from 'next/navigation';

import { useFeatures } from '@/components/features-provider';
import { WorkspaceNav } from '@/components/workspace-nav';
import { useChordShortcut } from '@/hooks/use-keyboard-shortcut';
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions';

/**
 * Layout for the workspace-level pages — the series list (`/`) and the
 * `/workspace/*` area. Adds the workspace tab bar above the page content and
 * the `g`-chord tab navigation, mirroring the per-series layout. Width is left
 * to each page (the series list is wide, settings narrow); the bar aligns with
 * the widest of them.
 */
export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { has } = useFeatures();
  const { can } = useWorkspacePermissions();

  useChordShortcut({
    s: () => router.push('/'),
    // Only where the tab exists — same gates as WorkspaceNav.
    ...(has('competitor-reconcile') && can('manage-series')
      ? { c: () => router.push('/workspace/competitors') }
      : {}),
    ...(has('rankings')
      ? { r: () => router.push('/workspace/rankings') }
      : {}),
    p: () => router.push('/workspace/published'),
    t: () => router.push('/workspace'),
  });

  return (
    <div className="space-y-6">
      <div className="max-w-5xl mx-auto">
        <WorkspaceNav />
      </div>
      {children}
    </div>
  );
}
