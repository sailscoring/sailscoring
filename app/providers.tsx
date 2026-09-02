'use client';

/**
 * Client providers.
 *
 * - QueryClientProvider — TanStack Query is the reactivity primitive
 *   for server-backed data. Mutations explicitly invalidate keys;
 *   per-mutation optimistic updates are added where the UX warrants.
 * - ConfirmDialogProvider — the single in-app confirmation dialog behind
 *   `useConfirm()`, replacing `window.confirm()`.
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

import { ConfirmDialogProvider } from '@/components/confirm-dialog';
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

/**
 * Signing out and hard-navigating are both irreversible: the cookie is
 * gone, whatever was on screen is discarded, and getting back in costs a
 * fresh magic-link email. One 401 is not enough evidence to spend that, so
 * ask the session endpoint before believing it.
 *
 * Only a definite "no session" is acted on. If the check itself fails —
 * offline, a blip, the endpoint itself erroring — the session is treated as
 * intact, because destroying a good session is far worse than leaving a
 * query in its error state.
 */
async function sessionIsGone(): Promise<boolean> {
  try {
    // Read through to the database rather than any cached session cookie:
    // a cache is precisely what can't contradict the 401 we're testing.
    const { data } = await authClient.getSession({
      query: { disableCookieCache: true },
    });
    return data === null;
  } catch {
    return false;
  }
}

/**
 * A page load fans out into a dozen or so parallel fetches, so a dead
 * session arrives as a dozen simultaneous 401s. One shared check answers
 * all of them; it is cleared afterwards so a later 401 is checked afresh.
 */
let sessionCheck: Promise<void> | null = null;

/**
 * How many live-session 401s in a row will be forgiven before the queries
 * are left in their error state. A 401 that keeps coming back while the
 * session keeps resolving is a server-side fault, and neither refetching
 * forever nor signing the user out is a useful response to it. Any query
 * succeeding resets the count, so this bounds a run of failures rather
 * than a session's lifetime.
 */
const MAX_TRANSIENT_RECOVERIES = 2;
let transientRecoveries = 0;

function handleAuthError(queryClient: QueryClient): void {
  if (redirectingToSignIn || sessionCheck) return;
  sessionCheck = sessionIsGone()
    .then((gone) => {
      if (gone) {
        void redirectToSignIn();
        return;
      }
      // The session is fine, so the 401 was transient. Refetch rather than
      // tear anything down — AuthError is excluded from the retry policy
      // below, so without this the queries would stay failed.
      //
      // Deliberately not awaited: the guard above must be clear again
      // before those refetches land, or a session that dies in the gap
      // would have its 401 swallowed and strand the user on a dead page —
      // the exact failure this whole path exists to prevent.
      if (transientRecoveries < MAX_TRANSIENT_RECOVERIES) {
        transientRecoveries += 1;
        void queryClient.invalidateQueries();
      }
    })
    .finally(() => {
      sessionCheck = null;
    });
}

/** Exported for the mutation-error tests; `Providers` is the only caller. */
export function createQueryClient(): QueryClient {
  // The error handlers need the client they're being installed on, which
  // doesn't exist until the constructor returns.
  const holder: { client?: QueryClient } = {};
  const onApiError = (error: unknown): void => {
    if (error instanceof AuthError && holder.client) {
      handleAuthError(holder.client);
    }
  };
  holder.client = new QueryClient({
    queryCache: new QueryCache({
      onError: onApiError,
      // A query getting through is proof the 401s were a passing fault, so
      // the forgiveness budget starts over.
      onSuccess: () => {
        transientRecoveries = 0;
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => {
        onApiError(error);
        // Two failure kinds have somewhere to go already: an AuthError to the
        // session re-check above, and a 409 to the conflict notice or the
        // finish-entry row dialog (see ConflictMutationSubscriber below).
        if (error instanceof AuthError || error instanceof ConflictApiError) return;
        // A mutation whose caller shows the rejection to the user (a refusal
        // rendered in the form it came from) says so via `meta`, and is not
        // a lost write either.
        if (mutation.meta?.errorShownToUser) return;
        // Everything else goes nowhere. `mutate` swallows rejections, so a
        // caller that passes no onError loses the write in silence: the
        // scorer sees the interaction succeed and the data isn't there. Log
        // it, so it shows up in the console during development and fails the
        // e2e suite, which treats a console error as a test failure.
        console.error(
          `Mutation failed${mutation.options.mutationKey ? ` (${JSON.stringify(mutation.options.mutationKey)})` : ''}:`,
          error,
        );
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 1000 * 30,
        refetchOnWindowFocus: false,
        // A 401 won't heal on retry, so fail fast and let the handler above
        // decide between a re-fetch and a sign-out.
        retry: (failureCount, error) =>
          !(error instanceof AuthError) && failureCount < 3,
      },
    },
  });
  return holder.client;
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
          <ConfirmDialogProvider>{children}</ConfirmDialogProvider>
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
