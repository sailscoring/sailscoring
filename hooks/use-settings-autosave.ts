'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Save-as-you-go for the series-settings cards.
 *
 * Several of those cards used to hold a draft and persist it only on an
 * explicit **Save**, with **Done** beside it collapsing the card and throwing
 * the draft away. Done reads like "finish", not "abandon", and nothing warned
 * about leaving, so a scorer could type a ten-person race management team,
 * collapse the card, and lose the lot. The rest of the app — competitors,
 * finishes, fleets — saves as you go, so the Save cards were the odd ones out
 * and nobody expected them.
 *
 * Edits are written as they are made, coalesced over a short pause so a typed
 * field is one write rather than one per keystroke, and flushed when the card
 * collapses, when it unmounts (navigating to another tab or series), and when
 * the page is hidden (a closed tab, a browser sent to the background). A
 * caller that can tell a half-typed value from a finished one holds the write
 * back itself; everything else is written on the spot.
 */
export type SettingsAutosaveStatus = 'idle' | 'pending' | 'saved';

export interface SettingsAutosave<T> {
  /**
   * Persist this patch. `defer` coalesces it into the pending write instead of
   * sending it now — what a typed field wants, where every keystroke would
   * otherwise be a round trip. A radio or a checkbox is a finished decision
   * the moment it is made, so it goes immediately.
   */
  commit: (patch: Partial<T>, opts?: { defer?: boolean }) => void;
  /** Send anything still pending. */
  flush: () => void;
  status: SettingsAutosaveStatus;
}

export function useSettingsAutosave<T>({
  save,
  delayMs = 600,
}: {
  /** Returns whatever it likes — a mutation's promise is common — and the
   *  result is not read. */
  save: (patch: Partial<T>) => unknown;
  delayMs?: number;
}): SettingsAutosave<T> {
  const pending = useRef<Partial<T> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const saveRef = useRef<(patch: Partial<T>) => unknown>(save);
  const [status, setStatus] = useState<SettingsAutosaveStatus>('idle');

  useEffect(() => {
    saveRef.current = save;
  });

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const patch = pending.current;
    pending.current = null;
    if (!patch) return;
    // Not awaited: the field must not block on the network, and a rejected
    // save — a 409 from another tab, say — is surfaced globally by
    // <ConflictNoticeProvider> rather than swallowed into this card.
    Promise.resolve(saveRef.current(patch)).catch(() => {});
    if (mounted.current) setStatus('saved');
  }, []);

  const commit = useCallback(
    (patch: Partial<T>, opts?: { defer?: boolean }) => {
      pending.current = { ...(pending.current ?? {}), ...patch };
      if (!opts?.defer) {
        flush();
        return;
      }
      setStatus('pending');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, delayMs);
    },
    [flush, delayMs],
  );

  useEffect(() => {
    mounted.current = true;
    // `pagehide` rather than `beforeunload`: it fires for a closed tab and for
    // one going into the back/forward cache, and it does not ask the browser
    // to interrupt the person with a dialog. There is nothing to confirm here
    // — the edit is being kept, not queried.
    const onHide = () => flush();
    window.addEventListener('pagehide', onHide);
    return () => {
      mounted.current = false;
      window.removeEventListener('pagehide', onHide);
      // Leaving the card is not abandoning the edit.
      flush();
    };
  }, [flush]);

  return { commit, flush, status };
}
