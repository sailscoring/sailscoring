'use client';

/**
 * The help panel: the same chapters the /help routes render, beside the
 * working screen rather than instead of it.
 *
 * Minimising moves the panel off-canvas without unmounting it, so the
 * reader's chapter, section and scroll position are all still there when
 * they bring it back — that flick between the problem and the answer is
 * the whole point of the thing.
 */
import { ArrowUpRight, ChevronLeft, ChevronsRight, CircleQuestionMark } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, type MouseEvent } from 'react';

import { HELP_CONTENT } from '@/app/help/content';
import {
  HELP_INTRODUCTION,
  helpHrefForSection,
  helpSectionForPath,
  visibleGroups,
  visibleSections,
  type HelpGroupDef,
} from '@/app/help/sections';
import { HelpVocabularyProvider, useHelpVocabulary } from '@/app/help/vocabulary';
import { useFeatures } from '@/components/features-provider';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { HELP_PANEL_MAX_WIDTH, HELP_PANEL_MIN_WIDTH, useHelpPanel } from './provider';

/** The shareable form of what the panel is showing. The split-fleet section
 *  carries the vocabulary it is being read in, so the page opens in the same
 *  words — unless that is the default, which needs no saying. */
function OpenAsPage({ slug, section }: { slug: string; section: string | null }) {
  const { key, source } = useHelpVocabulary();
  const vocab = section === 'split-fleets' && source !== 'default' ? key : null;
  return (
    <a
      href={helpHrefForSection(slug, section, { vocab })}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
    >
      Open as a page
      <ArrowUpRight className="size-3" />
    </a>
  );
}

/** Scrolling to a section has to wait for the chapter's chunk to arrive, so
 *  look for the anchor over a bounded run of frames rather than once. */
function useScrollToSection(
  containerRef: React.RefObject<HTMLDivElement | null>,
  section: string | null,
  seq: number,
) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!section) {
      container.scrollTop = 0;
      return;
    }
    let frames = 0;
    let raf = 0;
    const look = () => {
      // Scoped to the panel: the working screen underneath may well have an
      // element of its own with this id.
      const target = container.querySelector(`#${CSS.escape(section)}`);
      if (target) {
        container.scrollTop = (target as HTMLElement).offsetTop - container.offsetTop - 8;
        return;
      }
      if (frames++ > 120) return;
      raf = requestAnimationFrame(look);
    };
    look();
    return () => cancelAnimationFrame(raf);
  }, [containerRef, section, seq]);
}

/** Drags the docked edge. Below lg the panel is full-width, so it's hidden
 *  there — there is nothing to resize. */
function ResizeHandle() {
  const { width, setWidth } = useHelpPanel();
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize help"
      aria-valuenow={width}
      aria-valuemin={HELP_PANEL_MIN_WIDTH}
      aria-valuemax={HELP_PANEL_MAX_WIDTH}
      tabIndex={0}
      data-testid="help-resize"
      className="absolute inset-y-0 -left-1 hidden w-2 cursor-col-resize hover:bg-border focus-visible:bg-border lg:block"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        // Suppresses the page's padding transition and text selection for
        // the duration of the drag, so the content edge tracks the pointer.
        document.documentElement.dataset.helpResizing = 'true';
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        setWidth(window.innerWidth - e.clientX);
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        delete document.documentElement.dataset.helpResizing;
      }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        setWidth(width + (e.key === 'ArrowLeft' ? 32 : -32));
      }}
    />
  );
}

function ChapterList({
  group,
  onOpen,
}: {
  group: HelpGroupDef;
  onOpen: (slug: string, section?: string | null) => void;
}) {
  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => onOpen(group.slug)}
        className="text-left font-medium hover:underline"
      >
        {group.label}
      </button>
      {group.sections.map((s) => (
        <div key={s.id}>
          <button
            type="button"
            onClick={() => onOpen(group.slug, s.id)}
            className="text-left text-muted-foreground hover:text-foreground hover:underline"
          >
            {s.title}
          </button>
        </div>
      ))}
    </div>
  );
}

export function HelpPanel() {
  const { available, everOpened, open, chapter, section, seq, openHelp, showIndex, showChapter, minimise } =
    useHelpPanel();
  const { features } = useFeatures();
  const pathname = usePathname();
  const asideRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useScrollToSection(scrollRef, section, seq);

  // Opening deliberately (a click or `h`) moves focus into the panel, so Esc
  // and the tab order follow the reader in.
  useEffect(() => {
    if (open) asideRef.current?.focus();
  }, [open, seq]);

  /** Links between help sections stay inside the panel — following one out
   *  to /help would be the very navigation the panel exists to avoid. */
  const onContentClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const anchor = (e.target as HTMLElement).closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href') ?? '';
      if (!href.startsWith('/help')) return;
      if (anchor.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const [path, hash] = href.split('#');
      const slug = path.replace(/^\/help\/?/, '') || HELP_INTRODUCTION.slug;
      if (!(slug in HELP_CONTENT)) return;
      e.preventDefault();
      showChapter(slug, hash ?? null);
    },
    [showChapter],
  );

  if (!available || !everOpened) return null;

  const groups = [HELP_INTRODUCTION, ...visibleGroups(features)];
  // The section covering the screen the panel is sitting next to, pinned to
  // the top of the index so the answer to "what am I looking at" is one
  // click rather than a hunt through the chapters.
  const here = helpSectionForPath(pathname ?? '/', features);
  const current = chapter ? groups.find((g) => g.slug === chapter) : null;
  const Content = current ? HELP_CONTENT[current.slug] : null;

  return (
    <>
      {/* Below lg the panel is an overlay, so it gets a backdrop. */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={minimise}
          aria-hidden="true"
        />
      )}

      {/* Minimised, but used: how the reader gets it back without going to
          the header. */}
      {!open && (
        <Button
          variant="outline"
          size="sm"
          className="fixed bottom-4 right-4 z-30 shadow-md"
          onClick={() => openHelp()}
          data-testid="help-restore"
        >
          <CircleQuestionMark />
          Help
        </Button>
      )}

      {/* The vocabulary the chapter speaks is shared with the header's page
          link, so the two agree; it follows the series beside the panel. */}
      <HelpVocabularyProvider>
      <aside
        ref={asideRef}
        id="help-panel"
        tabIndex={-1}
        role="complementary"
        aria-label="Help"
        aria-hidden={!open}
        inert={!open}
        data-testid="help-panel"
        data-state={open ? 'open' : 'minimised'}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            minimise();
          }
        }}
        className={cn(
          'help-panel fixed inset-y-0 right-0 z-40 flex flex-col border-l bg-background shadow-xl outline-none transition-transform duration-200',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <ResizeHandle />
        <div className="flex items-center gap-2 border-b px-4 py-3">
          {current ? (
            <button
              type="button"
              onClick={showIndex}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="size-4" />
              Help
            </button>
          ) : (
            <span className="text-sm font-medium">Help</span>
          )}
          <span className="ml-auto flex items-center gap-1">
            <OpenAsPage slug={current?.slug ?? HELP_INTRODUCTION.slug} section={section} />
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={minimise}
              aria-label="Minimise help"
              title="Minimise help (Esc)"
            >
              <ChevronsRight />
            </Button>
          </span>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4" onClick={onContentClick}>
          {current && Content ? (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold">{current.label}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{current.blurb}</p>
              </div>
              <nav className="space-y-1 text-sm">
                {visibleSections(current, features).map((s) => (
                  <div key={s.id}>
                    <button
                      type="button"
                      onClick={() => showChapter(current.slug, s.id)}
                      className="text-left text-muted-foreground hover:text-foreground hover:underline"
                    >
                      {s.title}
                    </button>
                  </div>
                ))}
              </nav>
              <div className="space-y-6 text-sm">
                <Content />
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <p className="text-sm text-muted-foreground">
                A guide to scoring a series with Sail Scoring, in short chapters. Pick a section
                and it opens here, beside what you are working on.
              </p>
              {here && (
                <div className="rounded-md border bg-muted/50 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    For this page
                  </p>
                  <button
                    type="button"
                    onClick={() => showChapter(here.slug, here.section.id)}
                    className="mt-1 text-left text-sm font-medium hover:underline"
                  >
                    {here.section.title}
                  </button>
                </div>
              )}
              <nav className="space-y-5 text-sm">
                {groups.map((group) => (
                  <ChapterList key={group.slug} group={group} onOpen={showChapter} />
                ))}
              </nav>
            </div>
          )}
        </div>
      </aside>
      </HelpVocabularyProvider>
    </>
  );
}
