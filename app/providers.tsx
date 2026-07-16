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
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { useEffect, useState, type ReactNode } from 'react';

import { ConflictNoticeProvider, useNotifyConflict } from '@/components/conflict-notice';
import { AuthError, ConflictApiError } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { stripAuthErrorParam } from '@/lib/safe-redirect';

/**
 * Self-heal for a present-but-invalid session cookie. The proxy's
 * optimistic cookie check lets such a request through, server-side
 * session resolution finds nothing, and every data fetch 401s — without
 * this, client-fetching pages would sit on "Loading…" forever. Better
 * Auth's sign-out endpoint deletes the session cookie even when the
 * token no longer matches a session row, so the stale cookie is cleared
 * before the hard navigation to sign-in.
 */
let redirectingToSignIn = false;

async function redirectToSignIn(): Promise<void> {
  if (redirectingToSignIn || window.location.pathname === '/sign-in') return;
  redirectingToSignIn = true;
  await authClient.signOut().catch(() => {});
  const callbackURL = stripAuthErrorParam(
    window.location.pathname + window.location.search,
  );
  window.location.assign(
    `/sign-in?callbackURL=${encodeURIComponent(callbackURL)}`,
  );
}

function onApiError(error: unknown): void {
  if (error instanceof AuthError) void redirectToSignIn();
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({ onError: onApiError }),
    mutationCache: new MutationCache({ onError: onApiError }),
    defaultOptions: {
      queries: {
        staleTime: 1000 * 30,
        refetchOnWindowFocus: false,
        // A 401 won't heal on retry; fail fast so the sign-in redirect
        // fires immediately instead of after the default retry cycle.
        retry: (failureCount, error) =>
          !(error instanceof AuthError) && failureCount < 3,
      },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  // Lazy-init keeps the same QueryClient across re-renders without
  // sharing one across users in a Server Component context.
  const [queryClient] = useState(createQueryClient);

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>
        <ConflictNoticeProvider>
          <ConflictMutationSubscriber />
          {children}
        </ConflictNoticeProvider>
      </QueryClientProvider>
    </ThemeProvider>
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
