'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { disconnectConnectedApp, getConnectedApps } from '@/lib/api-repository';

import { queryKeys } from './query-keys';

/** The signed-in user's connected apps (ADR-016). */
export function useConnectedApps() {
  return useQuery({
    queryKey: queryKeys.connectedApps.mine(),
    queryFn: () => getConnectedApps(),
  });
}

export function useDisconnectApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { clientId: string; workspaceId: string | null }) => disconnectConnectedApp(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.connectedApps.mine() }),
  });
}
