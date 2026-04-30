'use client';

/**
 * ADR-008 Phase 3 client providers.
 *
 * - QueryClientProvider — TanStack Query is the reactivity primitive that
 *   replaces Dexie's `useLiveQuery`. Mutations explicitly invalidate
 *   keys; per-mutation optimistic updates are added where the UX warrants.
 * - RepoProvider — runtime-selects between Dexie and the api-repository
 *   from the server-passed USE_SERVER_DATA flag. See lib/repos.ts.
 *
 * Read-only offline (persistQueryClient) is deferred. The default
 * persister throttles writes by 1s, which produced stale-cache races
 * across hard navigations in e2e. Re-introducing persistence needs the
 * `PersistQueryClientProvider` Suspense boundary plus a near-zero
 * throttle, both of which are larger than this commit warrants.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { RepoProvider } from '@/lib/repos';

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 30,
        refetchOnWindowFocus: false,
      },
    },
  });
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
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <RepoProvider useServerData={useServerData}>{children}</RepoProvider>
    </QueryClientProvider>
  );
}
