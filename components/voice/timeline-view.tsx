'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Flag, Pause, Play, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { digitsOf } from '@/lib/voice/calls';
import type { Playing, ReadPiece } from '@/lib/voice/client/playback';
import { clockTenths, clockTime } from '@/lib/voice/sheet';
import {
  checkText,
  timeFromText,
  type Suggested,
  type Suggestion,
  type Timeline,
  type TimelineCall,
  type TimelineNow,
} from '@/lib/voice/timeline';
import {
  callsNear,
  competitorMatches,
  finishUsing,
  nowsNear,
  relative,
  rowKeyOf,
  timelineRows,
  type DismissTarget,
  type FinishEdit,
  type Nameable,
  type TimelineRow,
  type TimelineTarget,
} from '@/lib/voice/timeline-rows';
import { SAMPLE_RATE, SEGMENT_SAMPLES, type VoiceDismissal, type VoiceFinish, type VoiceGap, type VoiceTake, type VoiceTimeFrom } from '@/lib/voice/types';

/** A recording to show: the timeline read from it, and its sound. */
export interface TimelineSource {
  takes: readonly VoiceTake[];
  timeline: Timeline;
  suggested: Suggested;
  finishes: readonly VoiceFinish[];
  dismissals: readonly VoiceDismissal[];
  lagSeconds: number;
  read: ReadPiece;
  play: (from: number, to: number) => Promise<Playing | null>;
}

/** What someone who may change the finishes can do. */
export interface TimelineEditing {
  accept(s: Suggestion): void;
  acceptAll(): void;
  save(edit: FinishEdit): void;
  dismiss(target: DismissTarget): void;
  /** Why a competitor can't take this finish (they have a place on the
   *  sheet already), or null. */
  conflict(competitorId: string, finishId: string | null): string | null;
}

export type NameOf = (competitorId: string) => Nameable | undefined;

const label = (name: NameOf, competitorId: string) => {
  const c = name(competitorId);
  return c ? `${c.sailNumber} ${c.name}`.trim() : '?';
};

/** What the editor opens on. */
export type EditorTarget =
  | { kind: 'finish'; finish: VoiceFinish }
  | { kind: 'suggestion'; suggestion: Suggestion }
  | { kind: 'now'; now: TimelineNow }
  | { kind: 'call'; call: TimelineCall }
  | { kind: 'time'; at: number };

/** What tapping a row opens, if anything. */
export function editorTargetOf(row: TimelineRow, source: TimelineSource, call?: TimelineCall): EditorTarget | null {
  if (row.kind === 'now') {
    if (row.state.kind === 'finish') return { kind: 'finish', finish: row.state.finish };
    if (row.state.kind === 'suggestion') return { kind: 'suggestion', suggestion: row.state.suggestion };
    return { kind: 'now', now: row.now };
  }
  if (row.kind === 'pin') return row.finish ? { kind: 'finish', finish: row.finish } : { kind: 'suggestion', suggestion: row.suggestion! };
  if (row.kind === 'snippet') {
    const c = call ?? row.snippet.calls[0];
    if (!c) return null;
    const f = finishUsing(source.finishes, { call: c });
    if (f) return { kind: 'finish', finish: f };
    const s = source.suggested.suggestions.find((x) => x.callKey === c.key);
    if (s) return { kind: 'suggestion', suggestion: s };
    return { kind: 'call', call: c };
  }
  return null;
}

/** The editor's target for a target named from outside (a row of the sheet). */
export function resolveTarget(target: TimelineTarget, source: TimelineSource): EditorTarget | null {
  switch (target.kind) {
    case 'finish': {
      const f = source.finishes.find((x) => x.id === target.finishId);
      return f ? { kind: 'finish', finish: f } : null;
    }
    case 'suggestion': {
      const s = source.suggested.suggestions.find((x) => x.key === target.key);
      return s ? { kind: 'suggestion', suggestion: s } : null;
    }
    case 'now': {
      const n = source.timeline.nows.find((x) => x.key === target.key);
      return n ? { kind: 'now', now: n } : null;
    }
    case 'call': {
      const c = source.timeline.calls.find((x) => x.key === target.key);
      return c ? { kind: 'call', call: c } : null;
    }
    case 'time':
      return { kind: 'time', at: target.at };
  }
}

const atOfTarget = (t: EditorTarget): number =>
  t.kind === 'finish' ? t.finish.at : t.kind === 'suggestion' ? t.suggestion.at : t.kind === 'now' ? t.now.at : t.kind === 'call' ? t.call.at : t.at;

// ---- the list --------------------------------------------------------------

function Chip({ call, name }: { call: TimelineCall; name: NameOf }) {
  const who = call.competitorId ? name(call.competitorId) : undefined;
  const style =
    call.how === 'whole' || call.how === 'ending'
      ? 'border-border bg-muted'
      : call.how === 'sounds'
        ? 'border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
        : 'border-dashed border-amber-500 text-amber-800 dark:text-amber-300';
  return (
    <span className={cn('inline-flex items-baseline gap-1 whitespace-nowrap rounded-md border px-1.5 text-xs leading-5', style)} data-testid="voice-chip">
      <span className="font-mono font-bold">{who ? digitsOf(who.sailNumber) || who.sailNumber : call.digits || '?'}</span>
      {who && <span>{who.name}</span>}
      {call.how === 'sounds' && <span className="text-[11px]">close match</span>}
      {call.how === 'unknown' && <span className="text-[11px]">not on the entry list</span>}
      {call.how === 'ambiguous' && <span className="text-[11px]">could be {call.couldBe.length}</span>}
    </span>
  );
}

function Words({ row }: { row: Extract<TimelineRow, { kind: 'snippet' }> }) {
  const { snippet } = row;
  const inCall = (i: number) => snippet.calls.some((c) => i >= c.from && i < c.to);
  return (
    <span>
      {snippet.words.map((w, i) => (
        <span key={i}>
          {i > 0 && ' '}
          <span
            className={cn(
              inCall(i) && 'font-semibold underline decoration-border decoration-2 underline-offset-[3px]',
              i === snippet.nowWord && 'font-semibold text-blue-700 dark:text-blue-400',
            )}
          >
            {w}
          </span>
        </span>
      ))}
    </span>
  );
}

function FinishPill({ finish, suggestion, name, removed }: { finish?: VoiceFinish | null; suggestion?: Suggestion | null; name: NameOf; removed?: boolean }) {
  const base = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 text-xs font-semibold leading-5';
  if (removed) return <span className={cn(base, 'font-medium text-muted-foreground line-through')}>not a finish</span>;
  const who = (competitorId: string | null, sailNumber: string | null) =>
    competitorId ? label(name, competitorId) : sailNumber ? `${sailNumber} ?` : 'no sail number';
  if (finish) {
    return (
      <span className={cn(base, 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400')} data-testid="voice-pill-finish">
        <Check className="h-3 w-3" />
        {who(finish.competitorId, finish.sailNumber)}
      </span>
    );
  }
  if (suggestion?.check) {
    return (
      <span className={cn(base, 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300')} data-testid="voice-pill-check">
        {who(suggestion.competitorId, suggestion.sailNumber)}
      </span>
    );
  }
  if (suggestion) {
    return (
      <span className={cn(base, 'border border-dashed border-muted-foreground bg-background')} data-testid="voice-pill-suggested">
        <span className="text-[10px] font-medium text-muted-foreground">suggested</span>
        {who(suggestion.competitorId, suggestion.sailNumber)}
      </span>
    );
  }
  return null;
}

function nowSource(now: TimelineNow): string {
  if (now.pressId && now.word) return `pressed · heard “${now.word}”`;
  if (now.pressId) return 'pressed';
  return `heard “${now.word ?? ''}”`;
}

function RowView({
  row,
  name,
  selected,
  newest,
  onPick,
}: {
  row: TimelineRow;
  name: NameOf;
  selected: boolean;
  newest?: boolean;
  onPick?: (row: TimelineRow, call?: TimelineCall) => void;
}) {
  const pick = onPick ? () => onPick(row) : undefined;
  const common = cn(
    'relative grid grid-cols-[5.4rem_minmax(0,1fr)] items-baseline gap-x-2 px-3 py-1.5',
    pick && 'cursor-pointer hover:bg-muted/60',
    selected && 'bg-blue-50 shadow-[inset_3px_0_0_var(--color-blue-600)] dark:bg-blue-950',
    newest && 'py-2.5 text-lg',
  );
  const keys = pick
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: pick,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            pick();
          }
        },
      }
    : {};
  const time = (at: number, tenths = false) => (
    <span className={cn('font-mono text-xs tabular-nums text-muted-foreground', newest && 'text-sm')}>{tenths ? clockTenths(at) : clockTime(at)}</span>
  );

  switch (row.kind) {
    case 'snippet': {
      const talk = row.snippet.calls.length === 0;
      return (
        <div className={common} {...keys} data-row={row.key} data-testid="voice-row-snippet">
          {time(row.at)}
          <span className={cn('flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1', talk && 'text-muted-foreground')}>
            <Words row={row} />
            {row.snippet.calls.map((c) => (
              <span
                key={c.key}
                onClick={onPick ? (e) => { e.stopPropagation(); onPick(row, c); } : undefined}
                className={newest ? 'text-base' : undefined}
              >
                <Chip call={c} name={name} />
              </span>
            ))}
            {row.snippet.calls.some((c) => c.again) && <span className="text-[11px] text-muted-foreground">called again</span>}
          </span>
        </div>
      );
    }
    case 'now': {
      const { state } = row;
      const why =
        state.kind === 'suggestion' && state.suggestion.check
          ? checkText(state.suggestion, (id) => label(name, id))
          : state.kind === 'offers'
            ? `One NOW for ${state.calls.length} sail numbers: ${state.calls.map((c) => (c.competitorId ? label(name, c.competitorId) : c.digits)).join(' and ')}`
            : null;
      return (
        <div className={common} {...keys} data-row={row.key} data-testid="voice-row-now">
          <span
            aria-hidden
            className={cn('pointer-events-none absolute left-[calc(0.75rem+5.4rem)] right-3 top-[0.95rem] border-t-2 border-blue-600 dark:border-blue-400', !row.now.pressId && 'border-dashed')}
          />
          <span className="relative font-mono text-xs font-semibold tabular-nums text-blue-700 dark:text-blue-400">{clockTenths(row.at)}</span>
          <span className="relative flex min-w-0 items-center gap-1.5">
            <span className="rounded bg-blue-600 px-1.5 font-mono text-[11px] font-bold leading-5 text-white dark:bg-blue-400 dark:text-blue-950">NOW</span>
            <span className="min-w-0 truncate bg-background px-1 text-[11px] text-muted-foreground">{nowSource(row.now)}</span>
            <span className="flex-1" />
            <span className="bg-background pl-1">
              {state.kind === 'finish' && <FinishPill finish={state.finish} name={name} />}
              {state.kind === 'suggestion' && <FinishPill suggestion={state.suggestion} name={name} />}
              {state.kind === 'offers' && (
                <span className="rounded-full bg-amber-50 px-2 text-xs font-semibold leading-5 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  {state.calls.length} sail numbers
                </span>
              )}
              {state.kind === 'not-a-finish' && <FinishPill removed name={name} />}
            </span>
          </span>
          {why && <span className="col-start-2 text-xs text-amber-700 dark:text-amber-400">{why}</span>}
        </div>
      );
    }
    case 'pin': {
      const why = row.suggestion?.check ? checkText(row.suggestion, (id) => label(name, id)) : null;
      const from = row.finish ? timeFromText(row.finish.timeFrom) : row.suggestion ? timeFromText(row.suggestion.timeFrom) : '';
      return (
        <div className={common} {...keys} data-row={row.key} data-testid="voice-row-pin">
          {time(row.at, true)}
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Flag className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden />
            <FinishPill finish={row.finish} suggestion={row.suggestion} name={name} />
            <span className="text-[11px] text-muted-foreground">{from.toLowerCase()}</span>
          </span>
          {why && <span className="col-start-2 text-xs text-amber-700 dark:text-amber-400">{why}</span>}
        </div>
      );
    }
    case 'gap':
      return (
        <div
          className="grid grid-cols-[5.4rem_minmax(0,1fr)] gap-x-2 bg-[repeating-linear-gradient(135deg,var(--color-amber-100)_0_6px,transparent_6px_12px)] px-3 py-2 text-sm font-medium text-amber-800 dark:bg-[repeating-linear-gradient(135deg,var(--color-amber-950)_0_6px,transparent_6px_12px)] dark:text-amber-300"
          data-row={row.key}
          data-testid="voice-row-gap"
        >
          {time(row.at)}
          <span>
            Not recording from {clockTime(row.gap.from)} to {clockTime(row.gap.to)}. Anything called out then was not recorded.
          </span>
        </div>
      );
    case 'quiet':
      return (
        <div
          className={cn('px-3 py-0.5 text-center text-[11px] text-muted-foreground', pick && 'cursor-pointer hover:bg-muted/60')}
          {...keys}
          data-row={row.key}
        >
          · {row.seconds} s quiet ·
        </div>
      );
    case 'open':
      return (
        <div className={cn(common, 'cursor-default hover:bg-transparent')} data-row={row.key}>
          {time(row.at)}
          <span className="italic text-muted-foreground">{row.words.join(' ')}…</span>
        </div>
      );
  }
}

/**
 * The timeline as a list: talk dimmed, sail numbers as chips, each NOW a
 * line across with what became of it, a finish with no NOW of its own a
 * flag, quiet stretches folded. While recording it follows the newest row
 * until someone scrolls back.
 */
export function TimelineList({
  rows,
  name,
  selected,
  live,
  onPick,
  className,
}: {
  rows: readonly TimelineRow[];
  name: NameOf;
  selected: string | null;
  live?: boolean;
  onPick?: (row: TimelineRow, call?: TimelineCall) => void;
  className?: string;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const [following, setFollowing] = useState(true);

  // While recording, keep the newest row in view until someone scrolls up.
  useEffect(() => {
    const el = box.current;
    if (live && following && el) el.scrollTop = el.scrollHeight;
  }, [rows, live, following]);

  // Bring the selected row into view, within the list only.
  useEffect(() => {
    const el = box.current;
    if (!el || !selected) return;
    const row = el.querySelector<HTMLElement>(`[data-row="${CSS.escape(selected)}"]`);
    if (!row) return;
    const top = row.offsetTop;
    if (top < el.scrollTop + 8 || top + row.offsetHeight > el.scrollTop + el.clientHeight - 8) {
      el.scrollTop = Math.max(0, top - el.clientHeight / 3);
    }
  }, [selected]);

  const last = rows.length > 0 ? rows[rows.length - 1] : null;
  return (
    <div className={cn('relative min-h-0', className)}>
      <div
        ref={box}
        className="h-full overflow-y-auto overscroll-contain py-1 text-sm"
        data-testid="voice-timeline-list"
        onScroll={(e) => {
          if (!live) return;
          const el = e.currentTarget;
          setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
        }}
      >
        {rows.length === 0 && (
          <p className="px-4 py-6 text-muted-foreground">
            {live ? 'Call out the first sail number, then “now” as they finish, or press NOW.' : 'Nothing was recorded.'}
          </p>
        )}
        {rows.map((r) => (
          <RowView key={r.key} row={r} name={name} selected={r.key === selected} newest={live && r === last} onPick={onPick} />
        ))}
      </div>
      {live && !following && (
        <Button
          size="sm"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow"
          onClick={() => {
            setFollowing(true);
            const el = box.current;
            if (el) el.scrollTop = el.scrollHeight;
          }}
        >
          Back to live
        </Button>
      )}
    </div>
  );
}

// ---- the strip ---------------------------------------------------------------

const PIECE_LEVELS = SEGMENT_SAMPLES / (SAMPLE_RATE / 10);

/** How loud each tenth of a second of a piece of sound is, 0 to 1. */
function envelope(pcm: Int16Array): Float32Array {
  const step = SAMPLE_RATE / 10;
  const out = new Float32Array(PIECE_LEVELS);
  for (let i = 0; i < PIECE_LEVELS; i++) {
    let sum = 0;
    const from = i * step;
    const to = Math.min(pcm.length, from + step);
    for (let j = from; j < to; j++) sum += (pcm[j] / 32768) ** 2;
    out[i] = to > from ? Math.min(1, Math.sqrt(sum / (to - from)) * 5) : 0;
  }
  return out;
}

/** The loudness of the recording around `[from, to]`, fetched a piece at a
 *  time as the window moves. */
function useEnvelope(takes: readonly VoiceTake[], read: ReadPiece, from: number, to: number) {
  const [levels, setLevels] = useState<Record<string, Float32Array>>({});
  const requested = useRef(new Set<string>());
  const wanted = useMemo(() => {
    const keys: string[] = [];
    for (const t of takes) {
      const end = t.startedAt + (t.samples / SAMPLE_RATE) * 1000;
      if (end < from || t.startedAt > to) continue;
      const first = Math.max(0, Math.floor(((from - t.startedAt) / 1000) * SAMPLE_RATE / SEGMENT_SAMPLES));
      const last = Math.floor(((Math.min(to, end) - t.startedAt) / 1000) * SAMPLE_RATE / SEGMENT_SAMPLES);
      for (let i = first; i <= last; i++) keys.push(`${t.index}:${i}`);
    }
    return keys.join(',');
  }, [takes, from, to]);
  useEffect(() => {
    // A piece asked for stays asked for as the window moves on: when it
    // arrives it is kept for when the window comes back.
    for (const key of wanted ? wanted.split(',') : []) {
      if (requested.current.has(key)) continue;
      requested.current.add(key);
      const [take, index] = key.split(':').map(Number);
      void read(take, index).then(
        (pcm) => setLevels((l) => ({ ...l, [key]: pcm ? envelope(pcm) : new Float32Array(PIECE_LEVELS) })),
        () => requested.current.delete(key),
      );
    }
  }, [wanted, read]);
  return useCallback(
    (t: number): number | null => {
      const take = takes.find((x) => t >= x.startedAt && t <= x.startedAt + (x.samples / SAMPLE_RATE) * 1000);
      if (!take) return null;
      const sample = ((t - take.startedAt) / 1000) * SAMPLE_RATE;
      const index = Math.floor(sample / SEGMENT_SAMPLES);
      const piece = levels[`${take.index}:${index}`];
      if (!piece) return 0;
      return piece[Math.floor((sample - index * SEGMENT_SAMPLES) / (SAMPLE_RATE / 10))] ?? 0;
    },
    [takes, levels],
  );
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(340);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, Math.round(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * The recording to scale around the playhead, which stays in the middle:
 * its sound, each NOW a line, sail numbers where they were called out, and
 * finishes as flags. Drag it, or use the arrow keys, to move the playhead.
 */
export function TimelineStrip({
  source,
  playhead,
  onPlayhead,
}: {
  source: TimelineSource;
  playhead: number;
  onPlayhead: (at: number) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const span = (width >= 600 ? 40 : 24) * 1000;
  const ends = source.takes.map((t) => t.startedAt + (t.samples / SAMPLE_RATE) * 1000);
  const from = playhead - span / 2;
  const to = from + span;
  const levelAt = useEnvelope(source.takes, source.read, from, to);
  const H = 86;
  const pps = width / span;
  const x = (t: number) => ((t - from) * pps).toFixed(1);
  const drag = useRef<{ x: number; at: number } | null>(null);

  const bars: React.ReactNode[] = [];
  const bw = Math.max(0.8, pps * 100 * 0.6);
  for (let t = Math.ceil(from / 100) * 100; t < to; t += 100) {
    const level = levelAt(t);
    if (level === null) continue;
    const h = Math.max(1.2, level * 48);
    bars.push(<rect key={t} x={x(t)} y={(44 - h / 2).toFixed(1)} width={bw.toFixed(2)} height={h.toFixed(1)} className="fill-foreground/60" />);
  }
  const finishes = source.finishes.filter((f) => !f.removed);
  const flags = [
    ...finishes.map((f) => ({ key: `f${f.id}`, at: f.at, kind: 'ok' as const })),
    ...source.suggested.suggestions.map((s) => ({ key: `s${s.key}`, at: s.at, kind: s.check ? ('look' as const) : ('sug' as const) })),
  ].filter((f) => f.at >= from && f.at <= to);

  return (
    <div
      ref={ref}
      className="cursor-ew-resize touch-pan-y select-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
      tabIndex={0}
      role="slider"
      aria-label="Playhead. Drag, or use the arrow keys."
      aria-valuemin={Math.round(Math.min(...source.takes.map((t) => t.startedAt), playhead))}
      aria-valuemax={Math.round(Math.max(...ends, playhead))}
      aria-valuenow={Math.round(playhead)}
      aria-valuetext={clockTenths(playhead)}
      data-testid="voice-strip"
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, at: playhead };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        onPlayhead(Math.round((drag.current.at - (e.clientX - drag.current.x) / pps) / 100) * 100);
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        onPlayhead(playhead + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1000 : 100));
      }}
    >
      <svg viewBox={`0 0 ${width} ${H}`} width={width} height={H} className="block" aria-hidden>
        <defs>
          <pattern id="voice-gap-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="3" height="6" className="fill-amber-400/50" />
          </pattern>
        </defs>
        {source.timeline.gaps
          .filter((g: VoiceGap) => g.to > from && g.from < to)
          .map((g) => (
            <rect key={g.from} x={x(Math.max(g.from, from))} y={18} width={((Math.min(g.to, to) - Math.max(g.from, from)) * pps).toFixed(1)} height={52} fill="url(#voice-gap-hatch)" />
          ))}
        {bars}
        {source.timeline.nows
          .filter((n) => n.at >= from && n.at <= to)
          .map((n) => (
            <line key={n.key} x1={x(n.at)} x2={x(n.at)} y1={15} y2={73} className="stroke-blue-600 dark:stroke-blue-400" strokeWidth={2} strokeDasharray={n.pressId ? undefined : '3 3'} />
          ))}
        {source.timeline.calls
          .filter((c) => c.at >= from - 2000 && c.at <= to)
          .map((c) => (
            <text key={c.key} x={x(c.at)} y={11} className={cn('font-mono text-[9.5px] font-bold', c.how === 'whole' || c.how === 'ending' ? 'fill-foreground' : 'fill-amber-600')}>
              {c.competitorId ? digitsOf(c.digits) || c.digits : c.digits}
            </text>
          ))}
        {flags.map((f) => (
          <g key={f.key}>
            <line x1={x(f.at)} x2={x(f.at)} y1={73} y2={85} strokeWidth={1.5} className={f.kind === 'ok' ? 'stroke-emerald-600' : f.kind === 'look' ? 'stroke-amber-600' : 'stroke-foreground'} />
            <path d={`M${x(f.at)} 73.5l7 3.2-7 3.2z`} className={f.kind === 'ok' ? 'fill-emerald-600' : f.kind === 'look' ? 'fill-amber-600' : 'fill-background stroke-foreground'} />
          </g>
        ))}
        <line x1={width / 2} x2={width / 2} y1={4} y2={H} className="stroke-red-600" strokeWidth={2} />
        <circle cx={width / 2} cy={4} r={3.2} className="fill-red-600" />
      </svg>
    </div>
  );
}

// ---- the editor ----------------------------------------------------------------

interface EditorState {
  competitorId: string | null;
  query: string;
  at: number | null;
  timeFrom: VoiceTimeFrom;
  pressId: string | null;
  calledAt: number | null;
}

function initialState(target: EditorTarget, name: NameOf): EditorState {
  const text = (competitorId: string | null, sailNumber: string | null) =>
    competitorId ? label(name, competitorId) : (sailNumber ?? '');
  switch (target.kind) {
    case 'finish': {
      const f = target.finish;
      return { competitorId: f.competitorId, query: text(f.competitorId, f.sailNumber), at: f.at, timeFrom: f.timeFrom, pressId: f.pressId, calledAt: f.calledAt };
    }
    case 'suggestion': {
      const s = target.suggestion;
      return { competitorId: s.competitorId, query: text(s.competitorId, s.sailNumber), at: s.at, timeFrom: s.timeFrom, pressId: s.pressId, calledAt: s.calledAt };
    }
    case 'now':
      return { competitorId: null, query: '', at: target.now.at, timeFrom: target.now.pressId ? 'press' : 'spoken', pressId: target.now.pressId, calledAt: null };
    case 'call': {
      const c = target.call;
      const named = c.how === 'whole' || c.how === 'ending' || c.how === 'sounds' ? c.competitorId : null;
      return { competitorId: named, query: text(named, c.digits), at: c.at, timeFrom: 'called', pressId: null, calledAt: c.at };
    }
    case 'time':
      return { competitorId: null, query: '', at: target.at, timeFrom: 'hand', pressId: null, calledAt: null };
  }
}

function originOf(target: EditorTarget): string {
  switch (target.kind) {
    case 'finish':
      return `Finish at ${clockTenths(target.finish.at)}`;
    case 'suggestion':
      return target.suggestion.callKey && target.suggestion.heard
        ? `Suggested from “${target.suggestion.heard}”`
        : `Suggested from the NOW at ${clockTenths(target.suggestion.at)}`;
    case 'now':
      return `From the NOW at ${clockTenths(target.now.at)}`;
    case 'call':
      return `From “${target.call.heard}” at ${clockTenths(target.call.at)}`;
    case 'time':
      return `At the playhead, ${clockTenths(target.at)}`;
  }
}

/**
 * Making a finish: two fields set separately. Whatever the editor opened
 * on fills one; the timeline around it offers the other. Changing the
 * competitor never moves the time, and moving the time never changes the
 * competitor.
 */
export function FinishEditor({
  target,
  source,
  competitors,
  name,
  editing,
  playhead,
  onPlay,
  onClose,
}: {
  target: EditorTarget;
  source: TimelineSource;
  competitors: readonly Nameable[];
  name: NameOf;
  editing: TimelineEditing | null;
  playhead: number | null;
  /** Play around a time; absent while recording. */
  onPlay?: (at: number) => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<EditorState>(() => initialState(target, name));
  const tl = source.timeline;
  const ref = state.at ?? atOfTarget(target);
  const finishId = target.kind === 'finish' ? target.finish.id : null;
  const suggestion = target.kind === 'suggestion' ? target.suggestion : null;
  const matches = state.competitorId ? [] : competitorMatches(state.query, competitors);
  const near = callsNear(tl, ref);
  const nows = nowsNear(tl, ref);
  const conflict = state.competitorId && editing ? editing.conflict(state.competitorId, finishId) : null;
  const canSave = editing !== null && state.at !== null && (state.competitorId !== null || state.query.trim() !== '') && !conflict;
  const why =
    target.kind === 'suggestion' && target.suggestion.check
      ? checkText(target.suggestion, (id) => label(name, id))
      : target.kind === 'now'
        ? source.suggested.offers[target.now.key]
          ? `One NOW for ${source.suggested.offers[target.now.key].length} sail numbers. Play it, then choose.`
          : 'Time recorded, but no sail number'
        : null;
  const usedBy = (now: TimelineNow) => {
    const f = finishUsing(source.finishes, { now });
    return f && f.id !== finishId ? (f.competitorId ? name(f.competitorId)?.sailNumber : f.sailNumber) : null;
  };
  const hasFinish = (competitorId: string) => source.finishes.some((f) => !f.removed && f.competitorId === competitorId && f.id !== finishId);

  function pick(competitorId: string) {
    setState((s) => ({ ...s, competitorId, query: label(name, competitorId) }));
  }

  function save() {
    if (!editing || state.at === null) return;
    const q = state.query.trim();
    editing.save({
      finishId,
      suggestionKey: suggestion?.key ?? null,
      competitorId: state.competitorId,
      sailNumber: state.competitorId ? null : q.replace(/\s+/g, ' ').toUpperCase(),
      at: state.at,
      timeFrom: state.timeFrom,
      pressId: state.pressId,
      calledAt: state.calledAt,
    });
    onClose();
  }

  function notAFinish() {
    if (!editing) return;
    if (finishId) editing.dismiss({ finishId });
    else {
      const t = target;
      const dismissal: VoiceDismissal =
        t.kind === 'suggestion'
          ? { pressId: t.suggestion.pressId, spokenAt: t.suggestion.timeFrom === 'spoken' ? t.suggestion.at : null, calledAt: t.suggestion.calledAt }
          : t.kind === 'now'
            ? { pressId: t.now.pressId, spokenAt: t.now.pressId ? null : t.now.at, calledAt: null }
            : t.kind === 'call'
              ? { pressId: null, spokenAt: null, calledAt: t.call.at }
              : { pressId: null, spokenAt: null, calledAt: null };
      editing.dismiss({ dismissal });
    }
    onClose();
  }

  const nudge = (ms: number) => setState((s) => (s.at === null ? s : { ...s, at: s.at + ms, timeFrom: 'hand', pressId: null }));
  const option = 'rounded-md border px-2 py-1 text-left text-xs hover:bg-muted aria-pressed:border-blue-600 aria-pressed:bg-blue-50 dark:aria-pressed:bg-blue-950';

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-20 grid max-h-[78%] gap-3 overflow-y-auto overscroll-contain rounded-t-2xl border-t bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-16px_30px_-18px_rgba(0,0,0,0.35)]"
      role="dialog"
      aria-label="Finish"
      data-testid="voice-editor"
    >
      <div className="flex items-center gap-2">
        <strong className="text-base">Finish</strong>
        {suggestion && !suggestion.check && <span className="rounded-full border border-dashed px-2 text-[11px] text-muted-foreground">suggested</span>}
        {target.kind === 'finish' && <span className="rounded-full bg-emerald-50 px-2 text-[11px] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">accepted</span>}
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{originOf(target)}</span>
        <button type="button" className="h-8 w-8 rounded-md text-muted-foreground hover:bg-muted" onClick={onClose} aria-label="Close">
          <X className="mx-auto h-4 w-4" />
        </button>
      </div>
      {why && <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">{why}</p>}

      <div className="grid gap-1.5">
        <label htmlFor="voice-editor-competitor" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Competitor</label>
        <input
          id="voice-editor-competitor"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-base"
          placeholder="Sail number or name"
          autoComplete="off"
          spellCheck={false}
          value={state.query}
          onChange={(e) => setState((s) => ({ ...s, query: e.target.value, competitorId: null }))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches.length > 0) {
              e.preventDefault();
              pick(matches[0].competitor.id);
            }
          }}
        />
        {matches.length > 0 && (
          <div className="grid overflow-hidden rounded-md border" data-testid="voice-editor-matches">
            {matches.map(({ competitor, why: note }) => (
              <button
                key={competitor.id}
                type="button"
                className="flex items-baseline gap-2 border-t px-3 py-2 text-left text-sm first:border-t-0 hover:bg-muted"
                onClick={() => pick(competitor.id)}
              >
                <span className="font-mono font-semibold">{competitor.sailNumber}</span>
                <span>{competitor.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {[note, hasFinish(competitor.id) ? 'has a finish' : ''].filter(Boolean).join(' · ')}
                </span>
              </button>
            ))}
          </div>
        )}
        {state.query.trim() !== '' && !state.competitorId && matches.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No competitor on the entry list matches “{state.query.trim()}”. Saving keeps it as a competitor not on the entry list.
          </p>
        )}
        {conflict && <p className="text-xs text-destructive">{conflict}</p>}
        {near.length > 0 && (
          <>
            <span className="text-xs text-muted-foreground">Called out nearby</span>
            <div className="flex flex-wrap gap-1.5">
              {near.map((c) =>
                c.competitorId ? (
                  <button key={c.key} type="button" className={option} aria-pressed={state.competitorId === c.competitorId} onClick={() => pick(c.competitorId!)}>
                    <span className="font-mono font-semibold">{name(c.competitorId)?.sailNumber}</span> {name(c.competitorId)?.name}
                    <span className="text-muted-foreground"> · {relative(c.at, ref)}{hasFinish(c.competitorId) ? ' · has a finish' : ''}</span>
                  </button>
                ) : (
                  <button key={c.key} type="button" className={option} aria-pressed={false} onClick={() => setState((s) => ({ ...s, competitorId: null, query: c.digits }))}>
                    <span className="font-mono font-semibold">{c.digits}</span>
                    <span className="text-muted-foreground"> · heard “{c.heard}” · {relative(c.at, ref)}</span>
                  </button>
                ),
              )}
            </div>
          </>
        )}
      </div>

      <div className="grid gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Time</span>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-xl font-semibold tabular-nums" data-testid="voice-editor-time">{state.at !== null ? clockTenths(state.at) : 'Not chosen'}</span>
          {state.at !== null && <span className="text-xs text-muted-foreground">{timeFromText(state.timeFrom, nows.find((n) => n.pressId === null && n.at === state.at)?.word)}</span>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {nows.map((n) => (
            <button
              key={n.key}
              type="button"
              className={option}
              aria-pressed={state.pressId ? state.pressId === n.pressId : state.timeFrom === 'spoken' && state.at === n.at}
              onClick={() => setState((s) => ({ ...s, at: n.at, timeFrom: n.pressId ? 'press' : 'spoken', pressId: n.pressId }))}
            >
              NOW {clockTenths(n.at)}
              <span className="text-muted-foreground">
                {n.pressId ? '' : ` · heard “${n.word}”`}
                {usedBy(n) ? ` · used by ${usedBy(n)}` : ''}
              </span>
            </button>
          ))}
          {state.calledAt !== null && (
            <button
              type="button"
              className={option}
              aria-pressed={state.timeFrom === 'called' && state.at === state.calledAt}
              onClick={() => setState((s) => ({ ...s, at: s.calledAt, timeFrom: 'called', pressId: null }))}
            >
              When called out {clockTenths(state.calledAt)}
            </button>
          )}
          {playhead !== null && (
            <button type="button" className={option} aria-pressed={false} onClick={() => setState((s) => ({ ...s, at: playhead, timeFrom: 'hand', pressId: null }))}>
              Playhead {clockTenths(playhead)}
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[-1000, -100, 100, 1000].map((ms) => (
            <Button key={ms} size="sm" variant="outline" className="font-mono text-xs" disabled={state.at === null} onClick={() => nudge(ms)}>
              {ms < 0 ? '−' : '+'}{Math.abs(ms) >= 1000 ? '1 s' : '0.1 s'}
            </Button>
          ))}
          {onPlay && (
            <Button size="sm" variant="outline" onClick={() => onPlay(state.at ?? ref)}>
              <Play className="h-3.5 w-3.5" /> Play
            </Button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="flex justify-between gap-2 pt-1">
          {target.kind !== 'time' ? (
            <Button variant="ghost" onClick={notAFinish} data-testid="voice-editor-dismiss">Not a finish</Button>
          ) : (
            <span />
          )}
          <Button onClick={save} disabled={!canSave} data-testid="voice-editor-save">Save finish</Button>
        </div>
      ) : (
        <div className="flex justify-end pt-1">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      )}
    </div>
  );
}

// ---- the whole view ----------------------------------------------------------

/**
 * A recording's timeline, afterwards: the strip to scale around the
 * playhead, the list below it, and the editor for whatever is tapped. The
 * pane above the strip shows the playhead's time; it is where a frame of
 * video would go.
 */
export function TimelineView({
  source,
  editing,
  competitors,
  name,
  title,
  subtitle,
  target,
  onClose,
}: {
  source: TimelineSource;
  editing: TimelineEditing | null;
  competitors: readonly Nameable[];
  name: NameOf;
  title: string;
  subtitle?: string;
  target: TimelineTarget | null;
  onClose: () => void;
}) {
  const rows = useMemo(
    () =>
      timelineRows({
        timeline: source.timeline,
        suggested: source.suggested,
        finishes: source.finishes,
        dismissals: source.dismissals,
        lagSeconds: source.lagSeconds,
      }),
    [source.timeline, source.suggested, source.finishes, source.dismissals, source.lagSeconds],
  );
  const firstAt = source.takes.length > 0 ? Math.min(...source.takes.map((t) => t.startedAt)) : 0;
  const lastAt = source.takes.length > 0 ? Math.max(...source.takes.map((t) => t.startedAt + (t.samples / SAMPLE_RATE) * 1000)) : firstAt;
  const [opened] = useState(() => (target ? resolveTarget(target, source) : null));
  const [editor, setEditor] = useState<{ target: EditorTarget; n: number } | null>(() => (opened ? { target: opened, n: 0 } : null));
  const [selected, setSelected] = useState<string | null>(() => (target ? rowKeyOf(target, rows) : null));
  const [playhead, setPlayheadState] = useState<number>(() => (opened ? atOfTarget(opened) : firstAt));
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [now, setNow] = useState(0);
  const setPlayhead = (at: number) => setPlayheadState(Math.min(lastAt, Math.max(firstAt, at)));

  // While playing, the playhead follows the sound.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const step = () => {
      setNow(playing.elapsed());
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    void playing.ended.then(() => setPlaying((p) => (p === playing ? null : p)));
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  const shownPlayhead = playing ? playing.from + now * 1000 : playhead;

  async function play(from: number, seconds = 5) {
    playing?.stop();
    const p = await source.play(from, from + seconds * 1000);
    if (p) {
      setNow(0);
      setPlaying(p);
    }
  }
  function stopPlaying() {
    if (!playing) return;
    setPlayhead(playing.from + playing.elapsed() * 1000);
    playing.stop();
    setPlaying(null);
  }

  function onPick(row: TimelineRow, call?: TimelineCall) {
    stopPlaying();
    setSelected(row.key);
    const at = row.kind === 'quiet' ? row.middle : call?.at ?? row.at;
    setPlayhead(at);
    const t = editorTargetOf(row, source, call);
    setEditor(t ? { target: t, n: (editor?.n ?? 0) + 1 } : null);
    void play(at - 2000);
  }

  const toCheck = source.suggested.suggestions.filter((s) => s.check);
  const clear = source.suggested.suggestions.filter((s) => !s.check && s.competitorId);
  const accepted = source.finishes.filter((f) => !f.removed).length;

  function next() {
    if (toCheck.length === 0) return;
    const from = editor ? atOfTarget(editor.target) : selected ? (rows.find((r) => r.key === selected)?.at ?? -Infinity) : -Infinity;
    const s = toCheck.find((x) => x.at > from + 1) ?? toCheck[0];
    setSelected(rowKeyOf({ kind: 'suggestion', key: s.key }, rows));
    setPlayhead(s.at);
    setEditor({ target: { kind: 'suggestion', suggestion: s }, n: (editor?.n ?? 0) + 1 });
  }

  // The editor works on what was there when it opened; once that has been
  // settled elsewhere (accepted all, say) it goes.
  const stale =
    editor !== null &&
    ((editor.target.kind === 'suggestion' && !source.suggested.suggestions.some((s) => s.key === (editor.target as { suggestion: Suggestion }).suggestion.key)) ||
      (editor.target.kind === 'finish' && !source.finishes.some((f) => f.id === (editor.target as { finish: VoiceFinish }).finish.id && !f.removed)));

  return createPortal(
    <div className="fixed inset-0 z-50 flex h-dvh flex-col bg-background text-foreground" role="dialog" aria-label={title} data-testid="voice-timeline">
      <div className="mx-auto flex h-full w-full max-w-3xl min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{title}</p>
            {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <Button variant="outline" size="sm" onClick={() => { playing?.stop(); onClose(); }} data-testid="voice-timeline-close">Close</Button>
        </div>

        <div className="flex items-center gap-3 px-3 pt-2">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Playhead</div>
            <div className="font-mono text-2xl font-semibold tabular-nums" data-testid="voice-playhead">{clockTenths(shownPlayhead)}</div>
          </div>
          {editing && (
            <Button
              className="ml-auto"
              onClick={() => {
                stopPlaying();
                setSelected(null);
                setEditor({ target: { kind: 'time', at: Math.round(shownPlayhead / 100) * 100 }, n: (editor?.n ?? 0) + 1 });
              }}
              data-testid="voice-finish-here"
            >
              <Flag className="h-4 w-4" /> Finish here
            </Button>
          )}
        </div>
        <TimelineStrip source={source} playhead={shownPlayhead} onPlayhead={(at) => { stopPlaying(); setPlayhead(at); }} />
        <div className="flex justify-center gap-1.5 border-b px-3 pb-2.5">
          {[-1000, -100].map((ms) => (
            <Button key={ms} size="sm" variant="outline" className="min-w-11 font-mono text-xs" onClick={() => { stopPlaying(); setPlayhead(shownPlayhead + ms); }}>
              −{ms === -1000 ? '1 s' : '0.1'}
            </Button>
          ))}
          <Button size="sm" variant="outline" className="min-w-14" aria-label={playing ? 'Pause' : 'Play'} onClick={() => (playing ? stopPlaying() : void play(shownPlayhead, 8))}>
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          {[100, 1000].map((ms) => (
            <Button key={ms} size="sm" variant="outline" className="min-w-11 font-mono text-xs" onClick={() => { stopPlaying(); setPlayhead(shownPlayhead + ms); }}>
              +{ms === 1000 ? '1 s' : '0.1'}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2 text-sm" data-testid="voice-timeline-summary">
          <span>
            <b>{accepted}</b> accepted · <b>{clear.length}</b> suggested ·{' '}
            <span className={cn(toCheck.length > 0 && 'font-semibold text-amber-700 dark:text-amber-400')}>{toCheck.length} to check</span>
          </span>
          <span className="flex-1" />
          {editing && clear.length > 0 && (
            <Button size="sm" onClick={() => editing.acceptAll()} data-testid="voice-accept-all">
              Accept {clear.length} suggested finish{clear.length === 1 ? '' : 'es'}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={next} disabled={toCheck.length === 0} data-testid="voice-next">Next to check ›</Button>
        </div>

        <div className="relative min-h-0 flex-1">
          <TimelineList rows={rows} name={name} selected={selected} onPick={onPick} className="h-full" />
          {editor && !stale && (
            <FinishEditor
              key={editor.n}
              target={editor.target}
              source={source}
              competitors={competitors}
              name={name}
              editing={editing}
              playhead={Math.round(shownPlayhead / 100) * 100}
              onPlay={(at) => void play(at - 2000, 4)}
              onClose={() => setEditor(null)}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
