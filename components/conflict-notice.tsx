'use client';

/**
 * ADR-008 Phase 4: a transient banner shown when a save loses a version
 * race. Driven by a global subscriber on the TanStack `MutationCache` in
 * `app/providers.tsx` — any mutation that throws `ConflictApiError` (HTTP
 * 409) shows the notice and invalidates every query so the page reflects
 * the latest server state.
 *
 * The copy names the other writer only when the server has said who it
 * was and that it wasn't the scorer themselves. The series row's version
 * is the compare-and-swap token for every one of its children, so a
 * settings save can lose the race to the scorer's own competitor or finish
 * write with nobody else involved; a banner asserting a collaborator there
 * is simply false. What is true in every case, and what the copy led with
 * before, is that the write did not land.
 *
 * Phase 8 will replace this with the per-field conflict dialog
 * (formatted before/after, "keep mine" / "use the current value")
 * described in the scorer-collaboration requirements. Until then this
 * is the entirety of the surfacing — generic, non-blocking, and short.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import type { ConflictDetail } from '@/lib/api-client';

const NOTICE_DURATION_MS = 4000;

/**
 * What to tell the scorer about a save that lost a version race.
 *
 * Pure, so the wording is testable without a renderer. An unattributed
 * conflict — no `updated_by` on the row, a write from a script or an import
 * — falls through to the same message as the scorer's own, which is the
 * safe direction: it claims nothing about anyone.
 */
export function conflictNoticeMessage(detail?: ConflictDetail): string {
  const other = detail?.byCurrentUser
    ? null
    : detail?.actor?.displayName || detail?.actor?.email || null;
  return other
    ? `Couldn't save — ${other} edited this page. Refreshed.`
    : "Couldn't save — the page changed while saving. Refreshed.";
}

type Notify = (detail?: ConflictDetail) => void;

const ConflictNoticeContext = createContext<Notify | null>(null);

export function useNotifyConflict(): Notify {
  const fn = useContext(ConflictNoticeContext);
  if (!fn) {
    throw new Error('useNotifyConflict must be used inside <ConflictNoticeProvider>');
  }
  return fn;
}

export function ConflictNoticeProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((detail?: ConflictDetail) => {
    setMessage(conflictNoticeMessage(detail));
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setMessage(null), NOTICE_DURATION_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <ConflictNoticeContext.Provider value={notify}>
      {children}
      {message && (
        <div
          role="status"
          aria-live="polite"
          data-testid="conflict-notice"
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 shadow-md dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
        >
          {message}
        </div>
      )}
    </ConflictNoticeContext.Provider>
  );
}
