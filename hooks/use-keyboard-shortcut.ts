'use client';

import { useEffect, useRef } from 'react';

/** Returns true when focus is inside an interactive text element (ignore shortcuts). */
function isInputFocused(): boolean {
  const tag = document.activeElement?.tagName ?? '';
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag);
}

/**
 * Attaches a global keydown listener. The handler is called for every keydown event.
 * Use this for page-specific shortcuts; manage your own guard logic inside the handler.
 */
export function useGlobalKeyDown(handler: (e: KeyboardEvent) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      handlerRef.current(e);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/**
 * Two-key chord shortcut: press `g` then a second key within 1 second.
 * Chords are ignored when focus is inside an input, textarea, or select.
 *
 * @param chords - map of second-key → handler, e.g. `{ c: goToCompetitors }`
 */
export function useChordShortcut(chords: Record<string, () => void>) {
  const pendingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chordsRef = useRef(chords);
  chordsRef.current = chords;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isInputFocused()) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (pendingRef.current) {
        const handler = chordsRef.current[e.key];
        if (handler) {
          e.preventDefault();
          handler();
        }
        pendingRef.current = false;
        if (timerRef.current) clearTimeout(timerRef.current);
      } else if (e.key === 'g') {
        pendingRef.current = true;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          pendingRef.current = false;
        }, 1000);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
}
