'use client';

/**
 * ADR-008 Phase 7 — context that carries the signed-in user's memberships
 * down from the (server) layout to the rest of the (client) app.
 *
 * Keeps the data we already fetched once per render available to client
 * components like the "Copy to workspace…" dialog without making them
 * round-trip to Better Auth's `listOrganizations` endpoint.
 */
import { createContext, useContext, type ReactNode } from 'react';

import type { WorkspaceMembership } from './workspace-switcher';

interface WorkspaceMembershipsContextValue {
  memberships: WorkspaceMembership[];
  activeOrganizationId: string | null;
}

const WorkspaceMembershipsContext =
  createContext<WorkspaceMembershipsContextValue | null>(null);

export function WorkspaceMembershipsProvider({
  memberships,
  activeOrganizationId,
  children,
}: WorkspaceMembershipsContextValue & { children: ReactNode }) {
  return (
    <WorkspaceMembershipsContext.Provider
      value={{ memberships, activeOrganizationId }}
    >
      {children}
    </WorkspaceMembershipsContext.Provider>
  );
}

/**
 * Returns memberships + active workspace id. In local-first mode (no
 * signed-in user) the array is empty and `activeOrganizationId` is null,
 * which lets callers gate UI on "more than one workspace" without an
 * additional mode check.
 */
export function useWorkspaceMemberships(): WorkspaceMembershipsContextValue {
  const ctx = useContext(WorkspaceMembershipsContext);
  return ctx ?? { memberships: [], activeOrganizationId: null };
}
