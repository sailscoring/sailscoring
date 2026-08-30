'use client';

import { createContext, useContext } from 'react';

/**
 * Whether the series tabs are showing a spectator view (#475, ADR-012) — a
 * published data file read into memory — rather than a series in a workspace.
 *
 * Distinct from read-only (`useSeriesReadOnly`), which says the series can't
 * be *edited*. An archived or finalised series is read-only but still lives
 * in a workspace, so publishing it, previewing it, or saving it to a file are
 * all still real actions. A spectator view has no workspace behind it, so
 * none of them are — which is why `useWorkspacePermissions` denies everything
 * here rather than falling back to its permissive default.
 */
const SpectatorContext = createContext(false);

export function SpectatorProvider({
  spectator,
  children,
}: {
  spectator: boolean;
  children: React.ReactNode;
}) {
  return (
    <SpectatorContext.Provider value={spectator}>
      {children}
    </SpectatorContext.Provider>
  );
}

export function useIsSpectator(): boolean {
  return useContext(SpectatorContext);
}
