'use client';

/**
 * The app's one transient message surface: a fixed banner at the top of the
 * viewport, shown for something the scorer needs told about an interaction
 * that has already happened.
 *
 * Two things drive it, both from the mutation cache in `app/providers.tsx`:
 *
 *  - a save that lost a version race (409, ADR-008 Phase 4), and
 *  - a write that failed with nothing else to catch it (#568) — the case
 *    that has no dialog to report into, because the button wrote directly.
 *
 * Where a dialog is open it usually has its own error slot, and that is the
 * better place: Radix marks everything outside a modal dialog `aria-hidden`
 * and non-interactive, so a banner behind one is neither announced nor
 * dismissable. `dismissError` exists for that — a caller that decides to
 * render the failure itself takes the banner back down.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { ConflictDetail } from '@/lib/api-client';

/** How long a conflict notice stays up. It re-states what the refreshed page
 *  already shows, so it doesn't need dismissing. */
export const CONFLICT_NOTICE_MS = 4000;

/** How long a failed write stays up. Longer than a conflict: nothing else on
 *  the page says the change didn't land. */
export const WRITE_FAILURE_NOTICE_MS = 8000;

export type NoticeTone = 'warning' | 'error';

export interface Notice {
  tone: NoticeTone;
  message: string;
  dismissAfterMs: number;
  /**
   * The error being reported, when there is one. Identity is what
   * `dismissError` matches on, so a caller that took over the reporting of
   * *its* failure can't take down a banner about someone else's.
   */
  error?: unknown;
}

interface NoticeApi {
  show: (notice: Notice) => void;
  dismiss: () => void;
  dismissError: (error: unknown) => void;
}

const NoticeContext = createContext<NoticeApi | null>(null);

export function useNotice(): NoticeApi {
  const api = useContext(NoticeContext);
  if (!api) {
    throw new Error('useNotice must be used inside <NoticeProvider>');
  }
  return api;
}

/**
 * What to tell the scorer about a save that lost a version race.
 *
 * Pure, so the wording is testable without a renderer. An unattributed
 * conflict — no `updated_by` on the row, a write from a script or an import
 * — falls through to the same message as the scorer's own, which is the
 * safe direction: it claims nothing about anyone.
 *
 * The copy names the other writer only when the server has said who it was
 * and that it wasn't the scorer themselves. The series row's version is the
 * compare-and-swap token for every one of its children, so a settings save
 * can lose the race to the scorer's own competitor or finish write with
 * nobody else involved; a banner asserting a collaborator there is simply
 * false. What is true in every case is that the write did not land.
 */
export function conflictNoticeMessage(detail?: ConflictDetail): string {
  const other = detail?.byCurrentUser
    ? null
    : detail?.actor?.displayName || detail?.actor?.email || null;
  return other
    ? `Couldn't save — ${other} edited this page. Refreshed.`
    : "Couldn't save — the page changed while saving. Refreshed.";
}

const TONE_CLASSES: Record<NoticeTone, string> = {
  warning:
    'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200',
  error:
    'border-red-300 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200',
};

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const show = useCallback((next: Notice) => {
    setNotice(next);
    clearTimer();
    timerRef.current = setTimeout(() => setNotice(null), next.dismissAfterMs);
  }, [clearTimer]);

  const dismiss = useCallback(() => {
    clearTimer();
    setNotice(null);
  }, [clearTimer]);

  const dismissError = useCallback((error: unknown) => {
    setNotice((prev) => {
      if (!prev || prev.error !== error) return prev;
      clearTimer();
      return null;
    });
  }, [clearTimer]);

  const api = useMemo(
    () => ({ show, dismiss, dismissError }),
    [show, dismiss, dismissError],
  );

  useEffect(() => clearTimer, [clearTimer]);

  return (
    <NoticeContext.Provider value={api}>
      {children}
      {notice && (
        // Above the z-50 dialogs: a dialog portals in after this, so at an
        // equal z-index it would paint over the banner — and a write that
        // failed from inside a dialog is exactly when that matters.
        <div
          role={notice.tone === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          data-testid="notice"
          data-tone={notice.tone}
          className={`fixed top-4 left-1/2 z-[60] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-start gap-3 rounded-md border px-4 py-2 text-sm shadow-md ${TONE_CLASSES[notice.tone]}`}
        >
          <span>{notice.message}</span>
          {notice.tone === 'error' && (
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss"
              className="-mr-1 shrink-0 rounded px-1 leading-5 opacity-70 hover:opacity-100"
            >
              ×
            </button>
          )}
        </div>
      )}
    </NoticeContext.Provider>
  );
}
