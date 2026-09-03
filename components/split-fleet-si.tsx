'use client';

/**
 * A split-fleet configuration restated as sailing-instruction prose
 * (`lib/split-fleets-si.ts`), for the two people who need it.
 *
 * The scorer sets this up once every year or two from an SI or NoR someone
 * else wrote, and can only trust the settings by reading them back against
 * that document — so `SiTranslation` marks the sentences the setting they are
 * on writes, and holds the list in view while they work down the form.
 *
 * A reader of the published results wants the same sentences for the opposite
 * reason: not to check the format against a document, but to find out what it
 * is. `SplitFleetFormat` is those sentences with nothing around them.
 */

import { useEffect, useRef, useState } from 'react';

import { describeSplitFleetConfig } from '@/lib/split-fleets-si';
import type { SplitFleetSentenceId } from '@/lib/split-fleets-si';
import type { SplitFleetConfig } from '@/lib/split-fleets';

/**
 * The format as a reader meets it: the sentences, collapsed behind a heading
 * so the standings above them stay the page. No marking and no scrollport —
 * both answer a question only someone editing the settings is asking.
 */
export function SplitFleetFormat({ config }: { config: SplitFleetConfig }) {
  const [open, setOpen] = useState(false);
  const lines = describeSplitFleetConfig(config);
  return (
    <section className="rounded-lg border bg-card p-5" data-testid="sf-format">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left text-sm font-semibold uppercase tracking-wide"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        How this championship is scored
        <span className="text-muted-foreground">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
          {lines.map((line) => (
            <li key={line.id}>{line.text}</li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** The configuration restated as sailing-instruction prose, for checking
 *  against the document the scorer was handed. */
export function SiTranslation({
  config,
  marked,
  alwaysOpen = false,
  sticky = false,
}: {
  config: SplitFleetConfig;
  /** Sentences written by the setting the scorer is on, if any. Marking is
   *  only ever an answer to a question the panel is already open for, so a
   *  collapsed panel is left collapsed rather than opened underneath them. */
  marked?: readonly SplitFleetSentenceId[] | null;
  alwaysOpen?: boolean;
  /** Hold the panel at the top of the window while its column scrolls past,
   *  capped at the window's height with the overflow scrolling inside it.
   *  The full ILCA configuration runs to thirteen sentences, which is taller
   *  than a laptop viewport on its own — so sticking it without a cap would
   *  only move the invisible half of the panel rather than remove it. */
  sticky?: boolean;
}) {
  const [userOpen, setUserOpen] = useState(false);
  const open = alwaysOpen || userOpen;
  const lines = describeSplitFleetConfig(config);
  // The sentences scroll inside the capped panel; its heading and its footing
  // stay put, so what the scorer is reading never loses its label.
  const listRef = useRef<HTMLOListElement>(null);
  // Capping the panel puts the mark back out of sight for the settings at the
  // far end of the list, so a marked sentence is scrolled to. The range is
  // brought in first-then-last, which shows as much of it as fits and ends on
  // the last: a row that marks several sentences writes the opening ones as
  // context and the one it is actually about last.
  //
  // Guarded on the list actually being a scrollport, which is what the
  // stacked layout and any width below the sticky breakpoint are not: there
  // the nearest scrollport is the page, and scrolling that would yank a
  // scorer somewhere they didn't ask to go.
  const markedKey = marked?.join(' ') ?? '';
  useEffect(() => {
    const list = listRef.current;
    if (!open || !markedKey || !list || list.scrollHeight <= list.clientHeight) return;
    const ids = markedKey.split(' ');
    for (const id of [ids[0], ids[ids.length - 1]]) {
      list.querySelector(`[data-sentence="${id}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [markedKey, open]);
  return (
    <div
      className={`rounded-md border bg-muted/30 p-3${
        sticky ? ' lg:sticky lg:top-4 lg:flex lg:max-h-[calc(100vh-2rem)] lg:flex-col lg:self-start' : ''
      }`}
      data-testid="sf-si-translation"
    >
      {alwaysOpen ? (
        <p className="font-medium">How this configuration translates to sailing instructions</p>
      ) : (
        <button
          type="button"
          className="flex w-full items-center justify-between text-left font-medium"
          onClick={() => setUserOpen((o) => !o)}
          aria-expanded={open}
        >
          How this configuration translates to sailing instructions
          <span className="text-muted-foreground">{open ? '▾' : '▸'}</span>
        </button>
      )}
      {open && (
        <>
          <ol
            ref={listRef}
            className={`mt-2 list-decimal space-y-1.5 pl-5 text-muted-foreground${
              // An overflow-y scrollport scrolls in x as well, so both edges
              // have to be paid for here. On the right, the mark's ring sits
              // a hair outside the sentence. On the left, the markers are
              // drawn outside the sentence too: past sentence nine they need
              // a second digit's worth of room, and a marked sentence pulls
              // itself a further hair left — without which the leading digit
              // of 11, 12 and 13 is clipped away, on the very sentences the
              // medal settings mark.
              sticky ? ' lg:min-h-0 lg:overflow-y-auto lg:pl-7 lg:pr-1' : ''
            }`}
          >
            {lines.map((line) => {
              const isMarked = !!marked?.includes(line.id);
              return (
                <li
                  key={line.id}
                  data-sentence={line.id}
                  data-marked={isMarked || undefined}
                  // A ring as well as a wash, so the mark isn't hue alone —
                  // and neither shifts the sentence a pixel, which matters
                  // when the scorer is reading down the list.
                  className={
                    isMarked
                      ? '-mx-1 rounded-sm bg-primary/10 px-1 text-foreground ring-1 ring-primary/40'
                      : undefined
                  }
                >
                  {line.text}
                </li>
              );
            })}
          </ol>
          <p className="mt-2 text-xs text-muted-foreground">
            Read this against the scoring section of your sailing instructions. Where it
            disagrees, change the setting above — not the boats.
          </p>
        </>
      )}
    </div>
  );
}
