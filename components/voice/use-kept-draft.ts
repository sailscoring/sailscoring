'use client';

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import { ApiError } from '@/lib/api-client';
import { forgetDraft, readDraft, saveDraft } from '@/lib/voice/client/local-store';

/**
 * A draft that survives a reload: `useState`, kept on the phone under `key`.
 * A sheet taken down by voice on a committee boat can't be lost to a page
 * the phone put to sleep. Where `enabled` is false it is plain state.
 *
 * `loaded` is false until the phone's copy has been looked for; until then
 * the draft reads as null, and nothing should be built on that.
 */
export function useKeptDraft<T>(key: string, enabled: boolean): {
  draft: T | null;
  setDraft: Dispatch<SetStateAction<T | null>>;
  loaded: boolean;
} {
  const [draft, setDraft] = useState<T | null>(null);
  const [loaded, setLoaded] = useState(!enabled);

  useEffect(() => {
    if (!enabled) return;
    let gone = false;
    readDraft<T>(key)
      .catch(() => undefined)
      .then((kept) => {
        if (gone) return;
        if (kept !== undefined) setDraft((d) => d ?? kept);
        setLoaded(true);
      });
    return () => {
      gone = true;
    };
  }, [key, enabled]);

  useEffect(() => {
    if (!enabled || !loaded) return;
    void (draft === null ? forgetDraft(key) : saveDraft(key, draft)).catch(() => undefined);
  }, [key, enabled, loaded, draft]);

  return { draft, setDraft, loaded };
}

/** Whether a failed request never reached the server, or reached one that
 *  was down: worth sending again when there is a signal. */
export function worthSendingAgain(err: unknown): boolean {
  return !(err instanceof ApiError) || err.status >= 502;
}

/**
 * Send again when there is a signal: while `waiting`, call `send` when the
 * phone comes back online, and every so often in case it never said it was
 * off. The page has to be open for this; a phone's browser gives a page no
 * way to send from the background.
 */
export function useSendWhenOnline(waiting: boolean, send: () => void): void {
  const latest = useRef(send);
  useEffect(() => {
    latest.current = send;
  });
  useEffect(() => {
    if (!waiting) return;
    const attempt = () => {
      if (navigator.onLine) latest.current();
    };
    window.addEventListener('online', attempt);
    const timer = setInterval(attempt, 20_000);
    return () => {
      window.removeEventListener('online', attempt);
      clearInterval(timer);
    };
  }, [waiting]);
}
