'use client';

/**
 * ADR-008 Phase 4: a transient banner shown when a save fails because
 * the row was edited from another tab/device. Driven by a global
 * subscriber on the TanStack `MutationCache` in `app/providers.tsx` —
 * any mutation that throws `ConflictApiError` (HTTP 409) shows the
 * notice and invalidates every query so the page reflects the latest
 * server state.
 *
 * Phase 8 will replace this with the per-field conflict dialog
 * (formatted before/after, "keep mine" / "use the current value")
 * described in the scorer-collaboration requirements. Until then this
 * is the entirety of the surfacing — generic, non-blocking, and short.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

const NOTICE_DURATION_MS = 4000;

type Notify = () => void;

const ConflictNoticeContext = createContext<Notify | null>(null);

export function useNotifyConflict(): Notify {
  const fn = useContext(ConflictNoticeContext);
  if (!fn) {
    throw new Error('useNotifyConflict must be used inside <ConflictNoticeProvider>');
  }
  return fn;
}

export function ConflictNoticeProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback(() => {
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), NOTICE_DURATION_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <ConflictNoticeContext.Provider value={notify}>
      {children}
      {visible && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 shadow-md dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
        >
          This page was edited elsewhere — refreshed.
        </div>
      )}
    </ConflictNoticeContext.Provider>
  );
}
