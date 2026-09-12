'use client';

/**
 * A `?` beside a control, linking to the part of the help that explains it.
 *
 * It is a real link to the help page — middle-click, copy link address and
 * open-in-new-tab all behave — upgraded on a plain left click to open the
 * docked panel at the same section instead, so the explanation arrives
 * beside the screen the scorer is working on rather than replacing it.
 *
 * Inside a modal dialog the upgrade is skipped and the link opens the page
 * in a new tab: the dialog owns the screen and the focus, and the panel
 * would open behind it. (The `h` shortcut is suppressed for the same
 * reason — see the provider.)
 */
import { CircleQuestionMark } from 'lucide-react';
import type { MouseEvent } from 'react';

import { helpHrefForSection } from '@/app/help/sections';
import { cn } from '@/lib/utils';

import { useHelpPanel } from './provider';

export function HelpHint({
  chapter,
  section,
  label,
  className,
}: {
  /** Chapter slug, as `HELP_GROUPS` spells it. */
  chapter: string;
  /** Section anchor within that chapter. */
  section: string;
  /** What this explains, as a noun phrase — "the ECHO blend rate". Reads as
   *  the link's accessible name and its tooltip. */
  label: string;
  className?: string;
}) {
  const { available, openHelp } = useHelpPanel();
  const href = helpHrefForSection(chapter, section);
  const title = `What ${label} does`;

  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    // Anything but a plain left click is the reader asking the browser for
    // the page — a new tab, a new window, a copied URL. Leave it alone.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (!available) return;
    if (e.currentTarget.closest('[role="dialog"][data-state="open"]')) return;
    e.preventDefault();
    openHelp(chapter, section);
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={handleClick}
      title={title}
      aria-label={title}
      data-testid={`help-hint-${section}`}
      className={cn(
        'inline-flex shrink-0 text-muted-foreground/70 hover:text-foreground',
        className,
      )}
    >
      <CircleQuestionMark className="size-3.5" aria-hidden />
    </a>
  );
}
