'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Lock, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { Finish } from '@/lib/types';
import { cn } from '@/lib/utils';
import type { Recorder } from '@/lib/voice/client/recorder';
import { clockTime, lineLabel, lineTime, marksOf } from '@/lib/voice/sheet';
import type { VoiceLine } from '@/lib/voice/types';

export type BoatLabel = { sailNumber: string; name: string };

/** How long Lock has to be held to let go. */
const UNLOCK_MS = 900;

const TAG: Record<string, string> = { check: 'check', choose: 'choose', unknown: 'unknown', 'no-boat': 'no boat' };

function Clock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(tick);
  }, []);
  return <span className="font-mono tabular-nums" data-testid="voice-clock">{clockTime(now)}</span>;
}

/**
 * The screen while listening: one screen, read at arm's length, that stays
 * up until Stop. The last boat taken is the largest thing on it; below her,
 * the lines before, newest first. The caller isn't expected to look: what
 * they need to know comes as a tone.
 *
 * `level` is where the microphone's loudness is written as it arrives, so
 * the meter moves without the screen drawing itself ten times a second.
 */
export function ListeningScreen({
  recorder,
  lines,
  finishes,
  boat,
  takesTime,
  level,
  onStop,
  onShowSheet,
}: {
  recorder: Recorder;
  lines: readonly VoiceLine[];
  finishes: readonly Finish[];
  boat: (competitorId: string) => BoatLabel | undefined;
  takesTime: (competitorId: string | null) => boolean;
  level: React.RefObject<HTMLSpanElement | null>;
  onStop: () => void;
  onShowSheet: () => void;
}) {
  const [locked, setLocked] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => {
    clearTimeout(hold.current);
    clearTimeout(noticeTimer.current);
  }, []);

  const rowById = new Map(finishes.map((r) => [r.id, r]));
  const live = lines.filter((l) => !l.removed).reverse();
  const [last, ...rest] = live;
  const describe = (line: VoiceLine) => {
    const row = rowById.get(line.id);
    const label = lineLabel(line, row, boat);
    const mark = marksOf(line, row, takesTime).find((m) => m !== 'time');
    const timed = takesTime(row ? row.competitorId : line.competitorId);
    return { ...label, tag: mark ? TAG[mark] : null, time: timed ? lineTime(line) : '' };
  };
  const taken = live.filter((l) => l.how !== 'tap').length;
  // A sheet that takes no times has no time column to leave room for.
  const showTimes = takesTime(null);
  const gap = recorder.gap();
  const hearing = recorder.hearing();

  function undo() {
    const removed = recorder.undo();
    if (!removed) return;
    setNotice(`Removed ${lineLabel(removed, undefined, boat).number}`);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2500);
  }

  const lastLine = last ? describe(last) : null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex h-dvh touch-manipulation select-none flex-col overscroll-contain bg-background text-foreground"
      role="dialog"
      aria-label="Listening for finishes"
      data-testid="voice-listening"
    >
      <div className="flex items-center gap-3 border-b px-4 py-3 text-sm">
        <span className={cn('h-3 w-3 shrink-0 rounded-full', hearing ? 'bg-red-600' : 'bg-muted-foreground')} aria-hidden />
        <span className="font-medium" data-testid="voice-state" role="status">
          {notice ?? (hearing ? 'Listening' : 'Not listening')}
        </span>
        <span className="h-2 w-16 shrink-0 overflow-hidden rounded bg-muted" aria-hidden>
          <span ref={level} className="block h-full w-0 bg-emerald-600" />
        </span>
        <span className="ml-auto text-muted-foreground"><Clock /></span>
      </div>

      {gap && (
        <div className="flex items-start gap-2 border-b bg-amber-50 px-4 py-3 text-sm dark:bg-amber-950" role="alert" data-testid="voice-gap">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="flex-1">
            Not listening from {clockTime(gap.from)} to {clockTime(gap.to)}. Boats called then were not heard. Check them
            against the paper sheet.
          </p>
          <Button size="sm" variant="outline" onClick={() => recorder.dismissGap()}>OK</Button>
        </div>
      )}

      <div className="px-5 py-4" data-testid="voice-last">
        {lastLine ? (
          <>
            <div className={cn('font-mono text-6xl font-semibold leading-tight', lastLine.tag && 'text-amber-600')}>
              {lastLine.number}
            </div>
            <div className="text-xl">
              {lastLine.who}
              {lastLine.tag && (
                <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-sm font-medium text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                  {lastLine.tag}
                </span>
              )}
            </div>
            <div className="font-mono text-2xl text-muted-foreground">{lastLine.time}</div>
          </>
        ) : (
          <p className="py-6 text-xl text-muted-foreground">Call the first boat: her number, then “now” as she crosses.</p>
        )}
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto border-t px-4" data-testid="voice-lines">
        {rest.map((line) => {
          const d = describe(line);
          return (
            <li key={line.id} className="flex items-baseline gap-3 border-b py-2">
              {showTimes && <span className="w-28 shrink-0 font-mono text-sm text-muted-foreground">{d.time || '·'}</span>}
              <span className="font-mono text-lg font-medium">{d.number}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{d.who}</span>
              {d.tag && (
                <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                  {d.tag}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <p className="truncate border-t px-4 py-1.5 text-xs text-muted-foreground" data-testid="voice-heard">
        {recorder.tail() ? `Heard: ${recorder.tail()}` : ' '}
      </p>

      {stopping ? (
        <div className="space-y-3 border-t px-4 py-4" data-testid="voice-stop-confirm">
          <p className="text-base">
            Stop listening? {taken} boat{taken === 1 ? '' : 's'} taken.
          </p>
          <div className="flex gap-3">
            <Button variant="outline" className="h-14 flex-1 text-base" onClick={() => setStopping(false)}>Keep listening</Button>
            <Button className="h-14 flex-1 text-base" onClick={onStop}>Stop</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2 border-t px-4 pb-4 pt-3">
          <div className="flex items-stretch gap-3">
            <Button variant="outline" className="h-20 w-20 shrink-0 text-base" onClick={undo}>Undo</Button>
            <Button className="h-20 flex-1 text-3xl font-semibold" onClick={() => recorder.pressNow()} data-testid="voice-now">
              Now
            </Button>
            <Button variant="outline" className="h-20 w-20 shrink-0 text-base" onClick={() => setLocked(true)}>Lock</Button>
          </div>
          <div className="flex justify-between">
            <Button variant="ghost" className="h-11" onClick={onShowSheet}>Sheet</Button>
            <Button variant="ghost" className="h-11" onClick={() => setStopping(true)}>Stop</Button>
          </div>
        </div>
      )}

      {locked && (
        <div
          className="absolute inset-0 z-10 flex select-none flex-col items-center justify-center gap-3 bg-background/95 text-center"
          data-testid="voice-lock"
          onPointerDown={() => {
            hold.current = setTimeout(() => setLocked(false), UNLOCK_MS);
          }}
          onPointerUp={() => clearTimeout(hold.current)}
          onPointerCancel={() => clearTimeout(hold.current)}
          onPointerLeave={() => clearTimeout(hold.current)}
          onContextMenu={(e) => e.preventDefault()}
        >
          <Lock className="h-10 w-10" />
          <p className="text-lg font-medium">Locked. Still listening.</p>
          <p className="text-sm text-muted-foreground">Press and hold anywhere to unlock.</p>
          {lastLine && <p className="font-mono text-4xl font-semibold">{lastLine.number}</p>}
        </div>
      )}
    </div>,
    document.body,
  );
}

/**
 * Listening carries on behind the sheet: a bar along the bottom of the page
 * with the last boat, Now, and the way back to the listening screen.
 */
export function ListeningBar({
  recorder,
  lines,
  boat,
  onBack,
}: {
  recorder: Recorder;
  lines: readonly VoiceLine[];
  boat: (competitorId: string) => BoatLabel | undefined;
  onBack: () => void;
}) {
  const last = lines.filter((l) => !l.removed).at(-1);
  return createPortal(
    <div
      className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t bg-background px-4 py-3 shadow-lg"
      data-testid="voice-listening-bar"
    >
      <span className={cn('h-3 w-3 shrink-0 rounded-full', recorder.hearing() ? 'bg-red-600' : 'bg-muted-foreground')} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm">
        {recorder.hearing() ? 'Listening' : 'Not listening'}
        {last && <span className="ml-2 font-mono font-medium">{lineLabel(last, undefined, boat).number}</span>}
      </span>
      <Button className="h-12 px-6 text-base" onClick={() => recorder.pressNow()}>Now</Button>
      <Button variant="outline" className="h-12" onClick={onBack}>Back</Button>
    </div>,
    document.body,
  );
}
