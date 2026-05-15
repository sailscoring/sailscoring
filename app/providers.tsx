'use client';

/**
 * Client providers.
 *
 * - QueryClientProvider — TanStack Query is the reactivity primitive
 *   for server-backed data. Mutations explicitly invalidate keys;
 *   per-mutation optimistic updates are added where the UX warrants.
 *
 * Read-only offline (persistQueryClient) is deferred. The default
 * persister throttles writes by 1s, which produced stale-cache races
 * across hard navigations in e2e. Re-introducing persistence needs the
 * `PersistQueryClientProvider` Suspense boundary plus a near-zero
 * throttle, both of which are larger than this commit warrants.
 */
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';

import { ConflictNoticeProvider, useNotifyConflict } from '@/components/conflict-notice';
import { ConflictApiError } from '@/lib/api-client';
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

export function Providers({ children }: { children: ReactNode }) {
  // Lazy-init keeps the same QueryClient across re-renders without
  // sharing one across users in a Server Component context.
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ConflictNoticeProvider>
        <ConflictMutationSubscriber />
        <RepoProvider>{children}</RepoProvider>
      </ConflictNoticeProvider>
    </QueryClientProvider>
  );
}

/**
 * Subscribes to the QueryClient's mutation cache and reacts to any
 * mutation that fails with a 409 (`ConflictApiError`). On each match:
 * invalidate every cached query so the UI re-fetches authoritative
 * server state, and surface the generic refresh notice.
 *
 * Mutations scoped to `finishes` are handled by the per-row conflict
 * dialog on the finish-entry page (ADR-008 Phase 6). Skipping them
 * here avoids double-surfacing the same 409.
 */
function ConflictMutationSubscriber() {
  const notify = useNotifyConflict();
  const qc = useQueryClient();
  useEffect(() => {
    const unsub = qc.getMutationCache().subscribe((event) => {
      if (event.type !== 'updated') return;
      const error = event.mutation.state.error;
      if (error instanceof ConflictApiError) {
        if (event.mutation.options.scope?.id === 'finishes') return;
        notify();
        qc.invalidateQueries();
      }
    });
    return () => unsub();
  }, [qc, notify]);
  return null;
}
