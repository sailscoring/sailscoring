'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Roving tabindex over a list of rows, and where focus goes when the list
 * changes under it.
 *
 * A list whose every row and per-row button is its own tab stop costs a long
 * run of Tab presses to reach, and just as many to get past to whatever is
 * below it. Here only the remembered row carries `tabIndex={0}`; every other
 * row and every control inside a row takes `-1`. The list is one stop,
 * arrow keys move within it (the rows' own handlers), and tabbing back in
 * returns you where you were rather than to row 1.
 *
 * The other half is structural change. A confirm dialog restores focus to
 * whatever was focused when it opened, and after a delete that element has
 * unmounted — so focus lands on `<body>` and Tab restarts at the top of the
 * document. `focusIndexAfterChange` says where to put it instead, applied
 * once the new list has rendered.
 */
export function useRovingFocus<T extends HTMLElement = HTMLElement>(ids: string[]) {
  const containerRef = useRef<T | null>(null);
  const [rememberedId, setRememberedId] = useState<string | null>(null);
  const pendingIndex = useRef<number | null>(null);

  // The row that holds the tab stop: the one last focused while it is still
  // in the list, else the first.
  const activeId = rememberedId != null && ids.includes(rememberedId) ? rememberedId : ids[0] ?? null;

  const focusId = useCallback((id: string) => {
    setRememberedId(id);
    containerRef.current
      ?.querySelector<HTMLElement>(`[data-roving-id="${CSS.escape(id)}"]`)
      ?.focus();
  }, []);

  useEffect(() => {
    const index = pendingIndex.current;
    if (index == null) return;
    pendingIndex.current = null;
    if (ids.length === 0) return;
    focusId(ids[Math.min(index, ids.length - 1)]);
  }, [ids, focusId]);

  const rowProps = useCallback(
    (id: string) => ({
      'data-roving-id': id,
      tabIndex: id === activeId ? 0 : -1,
      onFocus: () => setRememberedId(id),
    }),
    [activeId],
  );

  const focusActive = useCallback(() => {
    if (activeId) focusId(activeId);
  }, [activeId, focusId]);

  const focusIndexAfterChange = useCallback((index: number) => {
    pendingIndex.current = index;
  }, []);

  return {
    /** Ref for the element the rows live in. */
    containerRef,
    /** Spread onto each row. */
    rowProps,
    focusId,
    /** Focus the remembered row — the way back into the list from anywhere. */
    focusActive,
    /**
     * Once the list next changes, focus whatever row lands at `index`,
     * clamped to the last. Call it before the delete or insert that changes
     * the list; nothing happens if the list ends up empty.
     */
    focusIndexAfterChange,
  };
}
