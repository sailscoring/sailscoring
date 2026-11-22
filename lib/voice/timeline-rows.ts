/**
 * The timeline as a list to show: snippets of speech with their sail
 * numbers, NOWs with what became of them, finishes with no NOW of their
 * own, stretches nothing was recorded, and quiet stretches folded up. Pure,
 * so the app's screens and voice-engine's check page show a recording the
 * same way. Also what the finish editor offers: the competitors a typed
 * sail number could be, and the sail numbers and NOWs near a time.
 */

import { digitsOf } from './calls';
import { nowOf, SAME_CALL, type Snippet, type Suggested, type Suggestion, type Timeline, type TimelineCall, type TimelineNow } from './timeline';
import type { VoiceDismissal, VoiceFinish, VoiceGap, VoiceTimeFrom, VoiceWord } from './types';

/** A quiet stretch this long, in milliseconds, is folded to one line. */
export const QUIET_FOLD = 8000;

/** What the editor saves: a finish, new or changed, or a suggestion
 *  accepted (as it stands or changed). */
export interface FinishEdit {
  /** The finish changed; null for a new one. */
  finishId: string | null;
  /** The suggestion it was accepted from, if it was. */
  suggestionKey: string | null;
  competitorId: string | null;
  /** The sail number, for a competitor not on the entry list. */
  sailNumber: string | null;
  at: number;
  timeFrom: VoiceTimeFrom;
  pressId: string | null;
  calledAt: number | null;
}

/** "Not a finish": a finish taken back, or evidence that isn't one. */
export type DismissTarget = { finishId: string; dismissal?: undefined } | { finishId?: undefined; dismissal: VoiceDismissal };

/** Where the timeline opens, or what a row of the sheet points at. */
export type TimelineTarget =
  | { kind: 'finish'; finishId: string }
  | { kind: 'suggestion'; key: string }
  | { kind: 'now'; key: string }
  | { kind: 'call'; key: string }
  | { kind: 'time'; at: number };

/** What became of a NOW. */
export type NowState =
  | { kind: 'finish'; finish: VoiceFinish }
  | { kind: 'suggestion'; suggestion: Suggestion }
  /** The sail numbers around it disagree about it. */
  | { kind: 'offers'; calls: TimelineCall[] }
  | { kind: 'not-a-finish' };

export type TimelineRow =
  | { kind: 'snippet'; key: string; at: number; snippet: Snippet }
  | { kind: 'now'; key: string; at: number; now: TimelineNow; state: NowState }
  /** A finish, or a suggestion, whose time came from no NOW. */
  | { kind: 'pin'; key: string; at: number; finish: VoiceFinish | null; suggestion: Suggestion | null }
  | { kind: 'gap'; key: string; at: number; gap: VoiceGap }
  | { kind: 'quiet'; key: string; at: number; seconds: number; middle: number }
  /** Words the recogniser is still working on, while recording. */
  | { kind: 'open'; key: string; at: number; words: string[] };

const SAME_SPOKEN = 300;

function nowState(
  now: TimelineNow,
  finishes: readonly VoiceFinish[],
  suggested: Suggested,
  calls: readonly TimelineCall[],
): NowState {
  const live = finishes.filter((f) => !f.removed);
  const finish = live.find((f) => nowOf(f, [now]) === now);
  if (finish) return { kind: 'finish', finish };
  const suggestion = suggested.suggestions.find((s) => s.nowKey === now.key);
  if (suggestion) return { kind: 'suggestion', suggestion };
  const offered = suggested.offers[now.key];
  if (offered) return { kind: 'offers', calls: offered.map((k) => calls.find((c) => c.key === k)).filter((c): c is TimelineCall => c !== undefined) };
  return { kind: 'not-a-finish' };
}

/** The rows of a timeline, in time order. */
export function timelineRows(input: {
  timeline: Timeline;
  suggested: Suggested;
  finishes: readonly VoiceFinish[];
  dismissals: readonly VoiceDismissal[];
  /** Words still being heard, on the phone's clock as the recogniser placed them. */
  open?: readonly VoiceWord[];
  lagSeconds?: number;
}): TimelineRow[] {
  const { timeline: tl, suggested, finishes } = input;
  const rows: TimelineRow[] = [];
  for (const s of tl.snippets) if (!s.isNow) rows.push({ kind: 'snippet', key: s.key, at: s.at, snippet: s });
  for (const n of tl.nows) rows.push({ kind: 'now', key: n.key, at: n.at, now: n, state: nowState(n, finishes, suggested, tl.calls) });
  for (const f of finishes) {
    if (f.removed || nowOf(f, tl.nows)) continue;
    rows.push({ kind: 'pin', key: `f${f.id}`, at: f.at, finish: f, suggestion: null });
  }
  for (const s of suggested.suggestions) {
    if (s.nowKey) continue;
    rows.push({ kind: 'pin', key: `g${s.key}`, at: s.at, finish: null, suggestion: s });
  }
  for (const g of tl.gaps) rows.push({ kind: 'gap', key: `x${g.from}`, at: g.from, gap: g });
  const open = input.open ?? [];
  if (open.length > 0) {
    const lag = (input.lagSeconds ?? 0) * 1000;
    rows.push({ kind: 'open', key: 'open', at: open[0].at - lag, words: open.map((w) => w.w) });
  }
  // A pin sits after what it was made from; a NOW straight after its words.
  const weight = (r: TimelineRow) => (r.kind === 'pin' ? 2 : r.kind === 'now' ? 1 : 0);
  rows.sort((a, b) => a.at - b.at || weight(a) - weight(b));

  const out: TimelineRow[] = [];
  let end: number | null = null;
  for (const r of rows) {
    if (end !== null && r.at - end >= QUIET_FOLD) {
      out.push({ kind: 'quiet', key: `q${r.key}`, at: end, seconds: Math.round((r.at - end) / 1000), middle: Math.round((end + r.at) / 2) });
    }
    out.push(r);
    const until = r.kind === 'snippet' ? r.snippet.until : r.kind === 'gap' ? r.gap.to : r.at;
    end = end === null ? until : Math.max(end, until);
  }
  return out;
}

/** The row a target lands on, by key. */
export function rowKeyOf(target: TimelineTarget, rows: readonly TimelineRow[]): string | null {
  for (const r of rows) {
    switch (target.kind) {
      case 'finish':
        if ((r.kind === 'now' && r.state.kind === 'finish' && r.state.finish.id === target.finishId) || (r.kind === 'pin' && r.finish?.id === target.finishId)) return r.key;
        break;
      case 'suggestion':
        if ((r.kind === 'now' && r.state.kind === 'suggestion' && r.state.suggestion.key === target.key) || (r.kind === 'pin' && r.suggestion?.key === target.key)) return r.key;
        break;
      case 'now':
        if (r.kind === 'now' && r.now.key === target.key) return r.key;
        break;
      case 'call':
        if (r.kind === 'snippet' && r.snippet.calls.some((c) => c.key === target.key)) return r.key;
        break;
      case 'time':
        break;
    }
  }
  if (target.kind === 'time') {
    let best: TimelineRow | null = null;
    for (const r of rows) if (r.kind !== 'quiet' && (!best || Math.abs(r.at - target.at) < Math.abs(best.at - target.at))) best = r;
    return best?.key ?? null;
  }
  return null;
}

/** Someone the editor can name. */
export interface Nameable {
  id: string;
  sailNumber: string;
  /** How the competitor is known: a boat name, a helm. */
  name: string;
}

/**
 * The competitors a typed sail number or name could be, best first: the
 * whole number, then numbers ending in it, then numbers containing it; or
 * names beginning with what was typed.
 */
export function competitorMatches<C extends Nameable>(query: string, competitors: readonly C[], limit = 5): { competitor: C; why: string }[] {
  const q = query.trim();
  if (!q) return [];
  const digits = q.replace(/\D/g, '');
  const letters = q.replace(/[^a-z]/gi, '').toLowerCase();
  const out: { competitor: C; why: string; rank: number }[] = [];
  for (const c of competitors) {
    const n = digitsOf(c.sailNumber);
    if (digits && n === digits) out.push({ competitor: c, why: '', rank: 0 });
    else if (digits.length >= 2 && n.endsWith(digits)) out.push({ competitor: c, why: `ends in ${digits}`, rank: 1 });
    else if (digits.length >= 2 && n.includes(digits)) out.push({ competitor: c, why: `contains ${digits}`, rank: 2 });
    else if (!digits && letters.length >= 2 && c.name.toLowerCase().replace(/[^a-z]/g, '').startsWith(letters)) out.push({ competitor: c, why: '', rank: 1 });
  }
  return out
    .sort((a, b) => a.rank - b.rank || digitsOf(a.competitor.sailNumber).localeCompare(digitsOf(b.competitor.sailNumber)))
    .slice(0, limit)
    .map(({ competitor, why }) => ({ competitor, why }));
}

/** The sail numbers called out within `within` ms of `at`, nearest first,
 *  one for each competitor. */
export function callsNear(tl: Timeline, at: number, within = 40_000, limit = 4): TimelineCall[] {
  const seen = new Set<string>();
  return tl.calls
    .filter((c) => Math.abs(c.at - at) <= within)
    .sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))
    .filter((c) => {
      const id = c.competitorId ?? `?${c.digits}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, limit);
}

/** The NOWs nearest `at`, within `within` ms, in time order. */
export function nowsNear(tl: Timeline, at: number, within = 30_000, limit = 3): TimelineNow[] {
  return tl.nows
    .filter((n) => Math.abs(n.at - at) <= within)
    .sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))
    .slice(0, limit)
    .sort((a, b) => a.at - b.at);
}

/** How long ago or after, in words: "5 s before", "12 s after". */
export function relative(at: number, from: number): string {
  const d = Math.round((at - from) / 1000);
  return d === 0 ? 'at the same time' : d < 0 ? `${-d} s before` : `${d} s after`;
}

/** The finish a NOW or a call is in now, accepted, if any. */
export function finishUsing(finishes: readonly VoiceFinish[], target: { now?: TimelineNow; call?: TimelineCall }): VoiceFinish | undefined {
  const live = finishes.filter((f) => !f.removed);
  if (target.now) return live.find((f) => (f.pressId ? f.pressId === target.now!.pressId : f.timeFrom === 'spoken' && Math.abs(f.at - target.now!.at) <= SAME_SPOKEN));
  if (target.call) return live.find((f) => f.calledAt !== null && Math.abs(f.calledAt - target.call!.at) <= SAME_CALL);
  return undefined;
}
