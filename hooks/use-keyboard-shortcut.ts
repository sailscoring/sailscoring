'use client';

import { useEffect, useId, useRef, useSyncExternalStore } from 'react';

/** Returns true when focus is inside an interactive text element (ignore shortcuts). */
export function isInputFocused(): boolean {
  const tag = document.activeElement?.tagName ?? '';
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag);
}

/**
 * Attaches a global keydown listener. The handler is called for every keydown event.
 * Use this for page-specific shortcuts; manage your own guard logic inside the handler.
 */
export function useGlobalKeyDown(handler: (e: KeyboardEvent) => void) {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

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
  useEffect(() => {
    chordsRef.current = chords;
  });

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

// ─── Registry-driven shortcuts ───────────────────────────────────────────────
//
// `useShortcuts` is the declarative form of a page shortcut: one entry wires
// the key handler AND the row in the `?` help dialog, which renders from this
// registry (see components/keyboard-help.tsx). `useShortcutHelp` registers
// dialog rows without a handler, for keys a page binds itself — element-level
// keys (a focused row's `e`/`d`) or a custom `useGlobalKeyDown` with
// multi-condition logic.

export interface ShortcutHelpEntry {
  /** The key as `KeyboardEvent.key` reports it, e.g. 'p', 'x', '?'. */
  key: string;
  /**
   * What the help dialog shows. Omit to keep the shortcut out of the dialog
   * (e.g. keys already documented in the dialog's static Global section).
   */
  description?: string;
  /** Help-dialog grouping; defaults to 'This page'. */
  section?: string;
  /** Dialog key labels when they differ from `key`, e.g. ['↑', '↓']. */
  displayKeys?: string[];
}

export interface ShortcutSpec extends ShortcutHelpEntry {
  /** Extra gate beyond the focus guard (read-only series, feature state). */
  when?: () => boolean;
  handler: () => void;
}

const registry = new Map<string, ShortcutHelpEntry[]>();
const listeners = new Set<() => void>();
let snapshot: ShortcutHelpEntry[] = [];
const EMPTY: ShortcutHelpEntry[] = [];

function rebuildSnapshot() {
  snapshot = [...registry.values()].flat().filter((e) => e.description);
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The help entries of every shortcut currently registered on the page,
 *  in registration order. Drives the `?` dialog. */
export function useActiveShortcuts(): ShortcutHelpEntry[] {
  return useSyncExternalStore(subscribe, () => snapshot, () => EMPTY);
}

/** Shared registration: publish the (display-relevant) entries under a
 *  stable per-caller id for the dialog, keyed off a display signature so a
 *  re-render with identical rows doesn't churn the store. */
function useRegisterShortcuts(entries: ShortcutHelpEntry[]) {
  const id = useId();
  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  });
  const signature = entries
    .map((e) => `${e.section ?? ''}:${e.key}:${e.description ?? ''}:${(e.displayKeys ?? []).join('+')}`)
    .join('|');
  useEffect(() => {
    registry.set(
      id,
      entriesRef.current.map(({ key, description, section, displayKeys }) => ({
        key, description, section, displayKeys,
      })),
    );
    rebuildSnapshot();
    return () => {
      registry.delete(id);
      rebuildSnapshot();
    };
  }, [id, signature]);
}

/**
 * Declarative page shortcuts: one keydown listener over the given specs.
 * A spec fires on an exact `e.key` match with no ctrl/meta/alt modifier,
 * never while focus is in an input, and only while `when()` (if given)
 * holds; the match is `preventDefault`ed. Entries with a `description`
 * appear in the `?` help dialog while the page is mounted.
 */
export function useShortcuts(specs: ShortcutSpec[]): void {
  const specsRef = useRef(specs);
  useEffect(() => {
    specsRef.current = specs;
  });

  useRegisterShortcuts(specs);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isInputFocused()) return;
      const spec = specsRef.current.find(
        (s) => s.key === e.key && (s.when?.() ?? true),
      );
      if (!spec) return;
      e.preventDefault();
      spec.handler();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/** Help-dialog rows for keys the page binds itself (element-level handlers
 *  or a custom `useGlobalKeyDown`). Registration only — no listener. */
export function useShortcutHelp(entries: ShortcutHelpEntry[]): void {
  useRegisterShortcuts(entries);
}
