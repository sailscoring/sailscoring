'use client';

/**
 * ADR-008 Phase 3 client providers.
 *
 * - QueryClientProvider — TanStack Query is the reactivity primitive that
 *   replaces Dexie's `useLiveQuery`. Mutations explicitly invalidate
 *   keys; per-mutation optimistic updates are added where the UX warrants.
 * - persistQueryClient — caches queries in localStorage. Gives a natural
 *   read-only offline posture: cached series stay visible while offline,
 *   writes fail with a clear error. ADR-008 calls this out as the
 *   "if it's natural" offline support.
 * - RepoProvider — runtime-selects between Dexie and the api-repository
 *   from the server-passed USE_SERVER_DATA flag. See lib/repos.ts.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { useState, type ReactNode } from 'react';

import { RepoProvider } from '@/lib/repos';

const ONE_DAY_MS = 1000 * 60 * 60 * 24;
const PERSIST_BUSTER = 'sailscoring-v1';

function createPersistedQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        // gcTime governs how long cached data is retained after the last
        // observer unmounts. The persister snapshots whatever the
        // QueryClient still has, so gcTime needs to outlive a typical
        // session for the persistence to be useful.
        gcTime: ONE_DAY_MS,
        staleTime: 1000 * 30,
        refetchOnWindowFocus: false,
      },
    },
  });
  if (typeof window !== 'undefined') {
    persistQueryClient({
      queryClient: client,
      persister: createSyncStoragePersister({ storage: window.localStorage }),
      maxAge: ONE_DAY_MS,
      buster: PERSIST_BUSTER,
    });
  }
  return client;
}

export function Providers({
  useServerData,
  children,
}: {
  useServerData: boolean;
  children: ReactNode;
}) {
  // Lazy-init keeps the same QueryClient across re-renders without
  // sharing one across users in a Server Component context.
  const [queryClient] = useState(createPersistedQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <RepoProvider useServerData={useServerData}>{children}</RepoProvider>
    </QueryClientProvider>
  );
}
