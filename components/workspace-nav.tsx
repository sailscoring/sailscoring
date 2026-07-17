'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';
import { useFeatures } from '@/components/features-provider';
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions';

/**
 * Workspace-level tab bar — the counterpart of the series tabs for everything
 * that sits above a single series: the series list, the cross-series
 * competitor reconcile surface, and workspace settings. Rendered by the
 * `(workspace)` route-group layout so the workspace-level pages read as one
 * area rather than a home page with satellite pages hidden behind menus.
 *
 * Gated tabs don't render at all when their feature is off (or the viewer's
 * role can't use them) — same containment posture as the pages themselves.
 */
export function WorkspaceNav() {
  const pathname = usePathname();
  const { has } = useFeatures();
  const { can } = useWorkspacePermissions();

  const tabs: Array<{ label: string; href: string }> = [
    { label: 'Series', href: '/' },
  ];
  // The reconcile surface is a manage-series tool gated on
  // `competitor-reconcile` — mirrors the page's own server-side gate.
  if (has('competitor-reconcile') && can('manage-series')) {
    tabs.push({ label: 'Competitors', href: '/workspace/competitors' });
  }
  // Cross-series rankings (#209): any member can view the ladder.
  if (has('rankings')) {
    tabs.push({ label: 'Rankings', href: '/workspace/rankings' });
  }
  tabs.push({ label: 'Published', href: '/workspace/published' });
  tabs.push({ label: 'Settings', href: '/workspace' });

  return (
    <nav className="inline-flex flex-wrap gap-1 rounded-lg border bg-card p-1 shadow-sm">
      {tabs.map((tab) => {
        // `/` and `/workspace` are prefixes of every other tab, so they match
        // exactly; deeper tabs match their subtree.
        const active =
          tab.href === '/' || tab.href === '/workspace'
            ? pathname === tab.href
            : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.label}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
