'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Lock, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Recorder } from '@/lib/voice/client/recorder';
import { clockTime } from '@/lib/voice/sheet';
import { timelineRows, type Nameable, type TimelineRow } from '@/lib/voice/timeline-rows';
import type { TimelineCall } from '@/lib/voice/timeline';

import { editorTargetOf, FinishEditor, TimelineList, type EditorTarget, type NameOf, type TimelineEditing, type TimelineSource } from './timeline-view';

/** How long Lock has to be held to let go. */
const UNLOCK_MS = 900;

function useNow(every: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(tick);
  }, [every]);
  return now;
}

function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const two = (n: number) => String(n).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${two(Math.floor(s / 60))}:${two(s % 60)}`;
}

/**
 * The screen while recording, which stays up until Stop recording. The
 * timeline builds as it goes, newest at the bottom: words grey while the
 * recogniser works on them, sail numbers as chips, each NOW a line across.
 * Nothing is decided here, so nothing needs taking back. The caller isn't
 * expected to look: a tone says a sail number was recognised. Tapping a row
 * opens the same editor as afterwards, for a spare pair of hands.
 *
 * `level` is where the microphone's loudness is written as it arrives, so
 * the meter moves without the screen drawing itself ten times a second.
 */
export function RecordingScreen({
  recorder,
  source,
  editing,
  competitors,
  name,
  level,
  onStop,
}: {
  recorder: Recorder;
  source: TimelineSource;
  editing: TimelineEditing;
  competitors: readonly Nameable[];
  name: NameOf;
  level: React.RefObject<HTMLSpanElement | null>;
  onStop: () => void;
}) {
  const [locked, setLocked] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [editor, setEditor] = useState<{ target: EditorTarget; key: string } | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(hold.current), []);
  const now = useNow(250);

  // Read again on every batch from the recogniser: the words still being
  // heard change with each.
  const rows = timelineRows({
    timeline: source.timeline,
    suggested: source.suggested,
    finishes: source.finishes,
    dismissals: source.dismissals,
    open: recorder.open(),
    lagSeconds: source.lagSeconds,
  });
  const hearing = recorder.hearing();
  const gap = recorder.gap();
  const startedAt = source.takes.length > 0 ? Math.min(...source.takes.map((t) => t.startedAt)) : now;
  const recognised = new Set(source.timeline.calls.filter((c) => c.competitorId).map((c) => c.competitorId)).size;
  const notOnList = source.timeline.calls.filter((c) => !c.competitorId).length;
  const nows = source.timeline.nows.length;

  function pick(row: TimelineRow, call?: TimelineCall) {
    const target = editorTargetOf(row, source, call);
    if (target) setEditor({ target, key: `${row.key}:${call?.key ?? ''}:${Date.now()}` });
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex h-dvh touch-manipulation select-none flex-col overscroll-contain bg-background text-foreground"
      role="dialog"
      aria-label="Recording finishes"
      data-testid="voice-recording-screen"
    >
      <div className="flex items-center gap-3 px-4 pb-1 pt-[max(0.75rem,env(safe-area-inset-top))] text-sm">
        <span className={cn('h-3 w-3 shrink-0 rounded-full', hearing ? 'animate-pulse bg-red-600 motion-reduce:animate-none' : 'bg-muted-foreground')} aria-hidden />
        <span className="font-semibold" data-testid="voice-state" role="status">{hearing ? 'Recording' : 'Not recording'}</span>
        <span className="font-mono tabular-nums text-muted-foreground">{elapsed(now - startedAt)}</span>
        <span className="h-2 min-w-8 flex-1 overflow-hidden rounded bg-muted" aria-hidden>
          <span ref={level} className="block h-full w-0 bg-emerald-600" />
        </span>
        <span className="font-mono tabular-nums" data-testid="voice-clock">{clockTime(now)}</span>
      </div>
      <p className="border-b px-4 pb-2 text-xs text-muted-foreground" data-testid="voice-counts">
        {recorder.recognising()
          ? `${recognised} sail number${recognised === 1 ? '' : 's'} recognised${notOnList > 0 ? ` · ${notOnList} not on the entry list` : ''} · ${nows} NOW`
          : `${nows} NOW · Recording the sound only: the sail numbers can be found afterwards.`}
      </p>

      {gap && (
        <div className="flex items-start gap-2 border-b bg-amber-50 px-4 py-3 text-sm dark:bg-amber-950" role="alert" data-testid="voice-gap">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="flex-1">
            Not recording from {clockTime(gap.from)} to {clockTime(gap.to)}. Anything called out then was not recorded.
          </p>
          <Button size="sm" variant="outline" onClick={() => recorder.dismissGap()}>OK</Button>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <TimelineList rows={rows} name={name} selected={null} live onPick={pick} className="h-full" />
        {editor && (
          <FinishEditor
            key={editor.key}
            target={editor.target}
            source={source}
            competitors={competitors}
            name={name}
            editing={editing}
            playhead={null}
            onClose={() => setEditor(null)}
          />
        )}
      </div>

      {stopping ? (
        <div className="space-y-3 border-t px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4" data-testid="voice-stop-confirm">
          <p className="text-base">Stop recording?</p>
          <div className="flex gap-3">
            <Button variant="outline" className="h-14 flex-1 text-base" onClick={() => setStopping(false)}>Keep recording</Button>
            <Button className="h-14 flex-1 text-base" onClick={onStop} data-testid="voice-stop-confirmed">Stop recording</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2 border-t px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <div className="flex items-stretch gap-3">
            <Button variant="outline" className="h-20 w-24 shrink-0 text-base" onClick={() => setLocked(true)}>
              <Lock className="h-4 w-4" /> Lock
            </Button>
            <Button
              className="h-20 flex-1 bg-blue-600 text-3xl font-bold tracking-widest text-white hover:bg-blue-700"
              onClick={() => recorder.pressNow()}
              data-testid="voice-now"
            >
              NOW
            </Button>
          </div>
          <Button variant="ghost" className="h-11 w-full" onClick={() => setStopping(true)} data-testid="voice-stop">Stop recording</Button>
        </div>
      )}

      {locked && (
        <div
          className="absolute inset-0 z-30 flex select-none flex-col items-center justify-center gap-3 bg-background/95 text-center"
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
          <p className="text-lg font-medium">Locked. Still recording.</p>
          <p className="text-sm text-muted-foreground">Press and hold anywhere to unlock.</p>
        </div>
      )}
    </div>,
    document.body,
  );
}
