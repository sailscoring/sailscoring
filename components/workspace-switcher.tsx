'use client';

/**
 * ADR-008 Phase 7 — workspace switcher in the global header.
 *
 * Reads the user's memberships + active workspace id from the layout
 * (server-fetched) and renders a dropdown that flips the active workspace
 * via Better Auth's `setActiveOrganization`. The session row's
 * `activeOrganizationId` is the source of truth — once set, every
 * subsequent server request observes the new workspace through
 * `lib/auth/require-workspace.ts`.
 *
 * After a successful switch we reload the page rather than juggling
 * client cache invalidation: it's the surest way to make every server
 * component re-evaluate against the new workspace.
 */

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';

import { authClient } from '@/lib/auth-client';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface WorkspaceMembership {
  organizationId: string;
  name: string;
  slug: string;
  /** The member's role string as stored — `lib/auth/permissions.ts` maps it
   *  to permissions, failing closed to read-only for unknown values. */
  role: string;
  /** The workspace's own logo URL (`organization.logo`), '' if unset. */
  logo: string;
}

/** A workspace's logo as a small icon. Renders nothing when unset, and hides
 *  itself if the URL fails to load so a dead logo never leaves a broken-image
 *  icon in the header. */
function WsLogo({ url }: { url: string }) {
  if (!url) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      className="h-4 w-4 shrink-0 rounded-sm object-contain"
      onError={(e) => {
        e.currentTarget.style.display = 'none';
      }}
    />
  );
}

export function WorkspaceSwitcher({
  memberships,
  activeOrganizationId,
}: {
  memberships: WorkspaceMembership[];
  activeOrganizationId: string | null;
}) {
  const [busy, setBusy] = useState(false);

  if (memberships.length === 0) return null;

  const active =
    memberships.find((m) => m.organizationId === activeOrganizationId) ?? null;

  async function switchTo(organizationId: string) {
    if (organizationId === activeOrganizationId) return;
    setBusy(true);
    try {
      await authClient.organization.setActive({ organizationId });
      // Hard reload so every server component re-evaluates against the
      // new workspace. Soft routing would leave server-rendered shells
      // pointing at the previous workspace's data.
      window.location.assign('/');
    } catch (err) {
      console.error('switch workspace failed:', err);
      setBusy(false);
    }
  }

  // Single-membership users still get the dropdown rather than a flat
  // label: the chevron is the visual cue that the workspace name is an
  // affordance (and where to go to add a second one once self-service
  // org creation lands in Phase 10).

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={busy}
        className={cn(
          'inline-flex items-center gap-1 text-sm text-muted-foreground',
          'hover:text-foreground focus:outline-none focus-visible:underline',
          busy && 'opacity-50',
        )}
        data-testid="workspace-switcher"
      >
        {active && <WsLogo url={active.logo} />}
        <span>{active ? active.name : 'Select workspace…'}</span>
        <ChevronDown className="h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[14rem]">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {memberships.map((m) => (
          <DropdownMenuItem
            key={m.organizationId}
            onSelect={() => switchTo(m.organizationId)}
            data-testid={`workspace-switcher-item-${m.slug}`}
            className="flex items-center gap-2"
          >
            <WsLogo url={m.logo} />
            <span className="flex flex-col items-start gap-0.5">
              <span
                className={cn(
                  'text-sm',
                  m.organizationId === activeOrganizationId && 'font-semibold',
                )}
              >
                {m.name}
              </span>
              <span className="text-xs text-muted-foreground">{m.role}</span>
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {/* The workspace-level pages (Competitors, Rankings, …) have first-
            class tabs on the workspace home; only Settings keeps a menu entry
            so it stays one click away from anywhere, series pages included. */}
        <DropdownMenuItem asChild>
          <Link href="/workspace">Workspace settings</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
