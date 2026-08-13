'use client';

/**
 * State for the help panel: help read beside the working screen
 * instead of navigating away from it.
 *
 * The panel is deliberately *not* rendered on the /help routes themselves —
 * there the page already is the help, and a second copy of the same sections
 * would duplicate every section id in the document.
 */
import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { isInputFocused, useGlobalKeyDown } from '@/hooks/use-keyboard-shortcut';

const OPEN_KEY = 'sailscoring:help-panel';
const WIDTH_KEY = 'sailscoring:help-panel-width';

/** Docked width bounds. Narrower than the minimum and the prose stops being
 *  readable; wider than the maximum and there's no working screen left. */
export const HELP_PANEL_MIN_WIDTH = 320;
export const HELP_PANEL_MAX_WIDTH = 720;
const HELP_PANEL_DEFAULT_WIDTH = 420;

interface HelpPanelContextValue {
  /** False where the panel has no business existing — the /help pages. */
  available: boolean;
  /** The panel mounts on first open and stays mounted, so minimising keeps
   *  the reader's scroll position and place in the chapter. */
  everOpened: boolean;
  open: boolean;
  /** The chapter slug being read; null is the index. */
  chapter: string | null;
  /** The section to scroll to once the chapter renders. */
  section: string | null;
  /** Bumped on every navigation so re-picking the current section
   *  scrolls to it again. */
  seq: number;
  openHelp: (chapter?: string | null, section?: string | null) => void;
  showIndex: () => void;
  showChapter: (slug: string, section?: string | null) => void;
  minimise: () => void;
  toggle: () => void;
  /** Docked width in px. Below lg the panel is full-width and ignores it. */
  width: number;
  setWidth: (px: number) => void;
}

function clampWidth(px: number): number {
  return Math.min(HELP_PANEL_MAX_WIDTH, Math.max(HELP_PANEL_MIN_WIDTH, Math.round(px)));
}

const HelpPanelContext = createContext<HelpPanelContextValue | null>(null);

export function useHelpPanel(): HelpPanelContextValue {
  const ctx = useContext(HelpPanelContext);
  if (!ctx) throw new Error('useHelpPanel outside HelpPanelProvider');
  return ctx;
}

export function HelpPanelProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const available = !(pathname ?? '').startsWith('/help');

  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const [chapter, setChapter] = useState<string | null>(null);
  const [section, setSection] = useState<string | null>(null);
  const [seq, setSeq] = useState(0);
  const [width, setWidthState] = useState(HELP_PANEL_DEFAULT_WIDTH);
  // Focus moves into the panel when it opens; minimising hands it back to
  // whatever the scorer was working in.
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Restore after a reload. Client-side navigation between app pages keeps
  // this provider mounted, so the panel simply survives that on its own.
  // Storage is unreadable during SSR, so this can only run post-hydration.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      // Width outlives the session; where the reader had got to does not.
      const stored = Number(localStorage.getItem(WIDTH_KEY));
      if (stored) setWidthState(clampWidth(stored));
      const saved = sessionStorage.getItem(OPEN_KEY);
      if (!saved) return;
      const state = JSON.parse(saved) as { open?: boolean; chapter?: string | null; section?: string | null };
      setChapter(state.chapter ?? null);
      setSection(state.section ?? null);
      if (state.open) {
        setOpen(true);
        setEverOpened(true);
      }
    } catch {
      // A malformed or unavailable store just means no restore.
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!everOpened) return;
    try {
      sessionStorage.setItem(OPEN_KEY, JSON.stringify({ open, chapter, section }));
    } catch {
      // Private-mode storage failures are not worth surfacing.
    }
  }, [everOpened, open, chapter, section]);

  // The docked width feeds both the panel and the padding the page reserves
  // for it, so it lives on the root element as a custom property.
  useEffect(() => {
    document.documentElement.style.setProperty('--help-panel-width', `${width}px`);
  }, [width]);

  const setWidth = useCallback((px: number) => {
    const next = clampWidth(px);
    setWidthState(next);
    try {
      localStorage.setItem(WIDTH_KEY, String(next));
    } catch {
      // Private-mode storage failures are not worth surfacing.
    }
  }, []);

  const openHelp = useCallback((next?: string | null, sectionId?: string | null) => {
    setEverOpened(true);
    setOpen((wasOpen) => {
      if (!wasOpen && document.activeElement instanceof HTMLElement) {
        returnFocusRef.current = document.activeElement;
      }
      return true;
    });
    // Only a move to somewhere new bumps `seq`. Re-opening where you left
    // off must not re-scroll the panel to the top of the section — the place
    // you had got to in it is the thing worth keeping.
    if (next !== undefined) {
      setChapter(next);
      setSection(sectionId ?? null);
      setSeq((n) => n + 1);
    }
  }, []);

  const minimise = useCallback(() => {
    setOpen(false);
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target?.isConnected) target.focus();
  }, []);

  const toggle = useCallback(() => {
    if (open) minimise();
    else openHelp();
  }, [open, minimise, openHelp]);

  const showIndex = useCallback(() => {
    setChapter(null);
    setSection(null);
    setSeq((n) => n + 1);
  }, []);

  const showChapter = useCallback((slug: string, sectionId?: string | null) => {
    setChapter(slug);
    setSection(sectionId ?? null);
    setSeq((n) => n + 1);
  }, []);

  // `h` opens or minimises the panel from anywhere. Free key: the single-key
  // globals in use are `?`, `/`, and per-page letters, and `g h` is History.
  useGlobalKeyDown((e) => {
    if (!available) return;
    if (e.key !== 'h' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isInputFocused()) return;
    // An open dialog owns the screen and the focus; help belongs behind it,
    // not under it.
    if (document.querySelector('[role="dialog"][data-state="open"]')) return;
    e.preventDefault();
    toggle();
  });

  const value = useMemo<HelpPanelContextValue>(
    () => ({
      available,
      everOpened,
      open: open && available,
      chapter,
      section,
      seq,
      openHelp,
      showIndex,
      showChapter,
      minimise,
      toggle,
      width,
      setWidth,
    }),
    [available, everOpened, open, chapter, section, seq, openHelp, showIndex, showChapter, minimise, toggle, width, setWidth],
  );

  return <HelpPanelContext.Provider value={value}>{children}</HelpPanelContext.Provider>;
}
