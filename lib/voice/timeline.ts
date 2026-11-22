/**
 * A recording's timeline: what was said and pressed, read against the entry
 * list, and the finishes it suggests. Pure, with no dependency on the
 * recogniser or the browser, so the phone, the scorer's review, voice-engine's
 * check page and the tests all read a recording the same way.
 *
 * The reading is done with hindsight, over the whole recording: nothing here
 * is decided as the words arrive. A sail number is usually called out as a
 * competitor approaches, often well before they finish, so its NOW may come
 * long after it, and what came after is what tells two close finishers
 * apart. Every time is the phone's clock in milliseconds.
 */

import {
  cleanWord,
  digitCandidates,
  isNumberWord,
  prepare,
  soundsLikeDigit,
  utterances,
  whoIs,
  type CallEntry,
  type CallMatch,
  type HeardWord,
  type PreparedList,
} from './calls';
import {
  DEFAULT_LAG_SECONDS,
  type VoiceDismissal,
  type VoiceFinish,
  type VoiceGap,
  type VoicePress,
  type VoiceTimeFrom,
  type VoiceWord,
} from './types';

/** A pause this long, in seconds, ends a snippet of speech. */
export const SNIPPET_GAP_SECONDS = 1.0;
/** Any single word called out this soon after a sail number is its NOW. */
export const ANY_WORD_WITHIN = 6000;
/** A press of NOW and a word called out this close together are one NOW. */
const SAME_NOW = 1500;
/** A NOW with no sail number before it takes one called out this soon after. */
const NOW_THEN_NUMBER = 5000;
/** The same competitor called out again within this is the same call. */
const MENTIONS_WITHIN = 60_000;
/** A decision's time and a call's agree to within this: two calls can be
 *  as little as a second and a half apart. */
export const SAME_CALL = 400;
/** A decision's time and a spoken NOW's agree to within this. */
const SAME_SPOKEN = 300;
/** Words that are taken as a NOW however long after the sail number they
 *  come: "now" as recognisers hear it, and what callers say instead. */
const NOW_WORDS = new Set(['now', 'no', 'know', 'mow', 'nau', 'gone', 'mark', 'new', 'nah', 'noun']);

export const isNumberish = (w: string) => isNumberWord(w) || soundsLikeDigit(w);
/** A word taken as a NOW however long after the sail number it comes. */
export const isNowWord = (w: string) => NOW_WORDS.has(w);

/** How sure a call is of its competitor (see `CallMatch` in calls.ts). */
export type CallHow = 'whole' | 'ending' | 'sounds' | 'ambiguous' | 'unknown';

/** A sail number called out, within a snippet. */
export interface TimelineCall {
  key: string;
  /** When its first and last words were said. */
  at: number;
  until: number;
  /** The words of the sail number, as the recogniser wrote them. */
  heard: string;
  how: CallHow;
  /** The competitor, for a whole number, a unique ending, or a close match. */
  competitorId: string | null;
  /** The competitors it could be, for a number that fits more than one. */
  couldBe: string[];
  /** The digits heard, where the words made a number. */
  digits: string;
  /** Their competitor was called out earlier in the recording. */
  again: boolean;
  /** Its snippet, and its words' place in it: [from, to). */
  snippet: string;
  from: number;
  to: number;
}

/** A stretch of speech: words with no pause of a second between them. */
export interface Snippet {
  key: string;
  at: number;
  until: number;
  words: string[];
  calls: TimelineCall[];
  /** A word said straight after a sail number, in the same breath, taken as
   *  its NOW: its place in `words`. */
  nowWord: number | null;
  /** The whole snippet is a single word taken as a NOW. */
  isNow: boolean;
}

/** A NOW: a press of the button, a word called out, or both at once. */
export interface TimelineNow {
  key: string;
  at: number;
  pressId: string | null;
  /** The word heard, where one was called out. */
  word: string | null;
}

export interface Timeline {
  snippets: Snippet[];
  /** Every sail number called out, in time order. */
  calls: TimelineCall[];
  nows: TimelineNow[];
  gaps: VoiceGap[];
}

/** The runs of number words in a snippet: where a sail number may be. */
function numberRuns(ws: readonly string[]): [number, number][] {
  const runs: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= ws.length; i++) {
    const w = ws[i];
    const inRun =
      i < ws.length &&
      (isNumberish(w) || (w === 'and' && start >= 0 && (ws[i - 1] === 'hundred' || ws[i - 1] === 'thousand')));
    if (inRun && start < 0) start = i;
    if (!inRun && start >= 0) {
      let end = i;
      while (end > start && ws[end - 1] === 'and') end--;
      runs.push([start, end]);
      start = -1;
    }
  }
  return runs.filter(([a, b]) => ws.slice(a, b).some(isNumberWord));
}

export type Found = { from: number; to: number; match: Exclude<CallMatch, { how: 'none' }> };

/**
 * The sail numbers in a snippet. The runs of number words in it first, so a
 * call inside talk ("first is four oh seven eight") is found; failing a
 * sure match there, the snippet as a whole, as calls.ts has always read a
 * call said on its own, close matches included.
 */
export function callsIn(ws: readonly string[], list: PreparedList, finished: (id: string) => boolean): Found[] {
  if (!ws.some(isNumberWord)) return [];
  const runs: Found[] = [];
  for (const [from, to] of numberRuns(ws)) {
    const match = whoIs(ws.slice(from, to), list, { finished });
    if (match.how !== 'none') runs.push({ from, to, match });
  }
  if (runs.some((r) => r.match.how === 'whole' || r.match.how === 'ending')) return runs;
  if (ws.length <= 9) {
    // The whole of it, and without a last word that isn't a number, and
    // whichever sounds closer: "thirty nine thirty nein" is all one call,
    // "thirty nine thirty nein now" a call and its NOW.
    const tries = ws.length > 1 && !isNumberish(ws[ws.length - 1]) ? [ws.length, ws.length - 1] : [ws.length];
    let best: Found | null = null;
    let bestScore = Infinity;
    for (const to of tries) {
      const match = whoIs(ws.slice(0, to), list, { finished });
      if (match.how === 'none' || match.how === 'unknown') continue;
      const score = match.how === 'sounds' ? match.distance : match.how === 'ambiguous' ? 0.34 : -1;
      if (score < bestScore) {
        best = { from: 0, to, match };
        bestScore = score;
      }
    }
    if (best) return [best];
  }
  return runs;
}

/**
 * Read a recording into its timeline. `lagSeconds` is how long after a
 * word is said the recogniser placed it; it is taken off every word.
 */
export function readTimeline(
  input: { words: readonly VoiceWord[]; presses: readonly VoicePress[]; gaps: readonly VoiceGap[] },
  entries: readonly CallEntry[],
  { lagSeconds = DEFAULT_LAG_SECONDS }: { lagSeconds?: number } = {},
): Timeline {
  const lag = lagSeconds * 1000;
  const list = prepare(entries);
  const heard: HeardWord[] = input.words
    .filter((w) => cleanWord(w.w))
    .map((w) => ({ w: w.w, t: (w.at - lag) / 1000 }))
    .sort((a, b) => a.t - b.t);
  const called = new Set<string>();
  const snippets: Snippet[] = [];
  const calls: TimelineCall[] = [];
  const spoken: { at: number; word: string }[] = [];
  let lastCall: TimelineCall | null = null;
  let markedSince = false;
  const ms = (t: number) => Math.round(t * 1000);

  for (const u of utterances(heard, { maxGap: SNIPPET_GAP_SECONDS })) {
    // Recognisers write in capitals as often as not; it reads better without.
    const words = u.words.map((x) => x.w.toLowerCase());
    const ws = words.map(cleanWord);
    const snippet: Snippet = { key: `s${ms(u.t)}`, at: ms(u.t), until: ms(u.tEnd), words, calls: [], nowWord: null, isNow: false };
    for (const f of callsIn(ws, list, (id) => called.has(id))) {
      const m = f.match;
      const competitorId = 'entry' in m ? m.entry.id : null;
      const at = ms(u.words[f.from].t);
      const call: TimelineCall = {
        key: `c${at}`,
        at,
        until: ms(u.words[f.to - 1].t),
        heard: words.slice(f.from, f.to).join(' '),
        how: m.how,
        competitorId,
        couldBe: m.how === 'ambiguous' ? m.entries.map((e) => e.id) : [],
        // What fits several competitors is shown as plainly as it can be read.
        digits: m.how === 'ambiguous' ? (digitCandidates(ws.slice(f.from, f.to)).sort((a, b) => a.length - b.length)[0] ?? m.digits) : m.digits,
        again: competitorId !== null && called.has(competitorId),
        snippet: snippet.key,
        from: f.from,
        to: f.to,
      };
      snippet.calls.push(call);
      calls.push(call);
      if (competitorId) called.add(competitorId);
      lastCall = call;
      markedSince = false;
    }
    const last = snippet.calls[snippet.calls.length - 1];
    const tail = ws[ws.length - 1];
    if (last && last.to === ws.length - 1 && !isNumberish(tail) && (last.from === 0 || NOW_WORDS.has(tail))) {
      // "sixteen thirteen now", in one breath; but not "we had forty boats".
      snippet.nowWord = ws.length - 1;
      spoken.push({ at: ms(u.words[ws.length - 1].t), word: tail });
      markedSince = true;
    } else if (snippet.calls.length === 0 && ws.length === 1 && lastCall && !isNumberish(tail)) {
      // A word on its own after a sail number: what the caller says as the
      // competitor finishes, whatever the recogniser took it for.
      if ((!markedSince && snippet.at - lastCall.until <= ANY_WORD_WITHIN) || NOW_WORDS.has(tail)) {
        snippet.isNow = true;
        spoken.push({ at: snippet.at, word: tail });
        markedSince = true;
      }
    }
    snippets.push(snippet);
  }

  const nows: TimelineNow[] = input.presses.map((p) => ({ key: `p${p.id}`, at: p.at, pressId: p.id, word: null }));
  for (const s of spoken) {
    const press = nows.find((n) => n.pressId !== null && n.word === null && Math.abs(n.at - s.at) <= SAME_NOW);
    if (press) press.word = s.word;
    else nows.push({ key: `w${s.at}`, at: s.at, pressId: null, word: s.word });
  }
  nows.sort((a, b) => a.at - b.at);
  return { snippets, calls, nows, gaps: [...input.gaps].sort((a, b) => a.from - b.from) };
}

/** Why a suggested finish needs a person to check it. */
export type CheckWhy =
  | { why: 'close-match' }
  | { why: 'not-on-list' }
  | { why: 'could-be' }
  | { why: 'no-sail-number' }
  /** The sail numbers and the NOWs around them don't agree in number. */
  | { why: 'counts'; numbers: number; nows: number }
  | { why: 'called-time' };

/** A finish the timeline suggests. Nothing is a finish until a person
 *  accepts it. */
export interface Suggestion {
  /** Stable while the evidence it came from stands. */
  key: string;
  competitorId: string | null;
  /** The digits heard, for a sail number on no entry. */
  sailNumber: string | null;
  couldBe: string[];
  /** The words of the sail number, where there was one. */
  heard: string | null;
  at: number;
  timeFrom: VoiceTimeFrom;
  pressId: string | null;
  calledAt: number | null;
  callKey: string | null;
  nowKey: string | null;
  /** Null for a clear suggestion: a recognised competitor and one NOW, or
   *  no time needed. */
  check: CheckWhy | null;
}

export interface Suggested {
  suggestions: Suggestion[];
  /** NOWs the sail numbers around them disagree about, by key, with the
   *  calls each could be. */
  offers: Record<string, string[]>;
}

export interface SuggestOptions {
  /** What people have decided so far: their finishes take their evidence,
   *  and nothing dismissed is suggested again. */
  finishes?: readonly VoiceFinish[];
  dismissals?: readonly VoiceDismissal[];
  /** Whether a competitor's finish needs a time (null: one not on the
   *  entry list). A fleet scored on finishing order needs no NOW. */
  takesTime?: (competitorId: string | null) => boolean;
}

interface Group {
  id: string;
  key: string;
  /** The first mention: where the group stands in the order. */
  first: TimelineCall;
  /** The latest mention: what a time taken from the call is taken from. */
  last: TimelineCall;
  mentions: TimelineCall[];
}

/**
 * The finishes a timeline suggests, given what people have decided.
 *
 *   1. A sail number called out again before its NOW is the same call.
 *   2. A word called out after a sail number, before the next one, is its
 *      NOW. (A press at the same moment is the same NOW, and the press
 *      gives the time.)
 *   3. Of what is left, sail numbers and NOWs pair in order, run by run,
 *      when their counts agree, however far apart they are. A run is some
 *      sail numbers followed by some NOWs.
 *   4. A NOW with no sail number before it takes one called out a few
 *      seconds after it ("now ... that was 1613").
 *   5. When the counts don't agree, nothing is paired: the sail numbers are
 *      suggested at the time they were called out, to check, and each NOW
 *      offers them.
 *   6. A sail number with no NOW is a finish in the order called: clear for
 *      a fleet that needs no time, to check for one that does.
 */
export function suggestFinishes(tl: Timeline, options: SuggestOptions = {}): Suggested {
  const { finishes = [], dismissals = [], takesTime = () => true } = options;

  // The evidence decisions have taken.
  const pressUsed = new Set<string>();
  const spokenUsed: number[] = [];
  const callUsed: number[] = [];
  const competitorUsed = new Set<string>();
  for (const f of finishes) {
    if (f.pressId) pressUsed.add(f.pressId);
    if (f.timeFrom === 'spoken') spokenUsed.push(f.at);
    if (f.calledAt != null) callUsed.push(f.calledAt);
    if (!f.removed && f.competitorId) competitorUsed.add(f.competitorId);
  }
  for (const d of dismissals) {
    if (d.pressId) pressUsed.add(d.pressId);
    if (d.spokenAt != null) spokenUsed.push(d.spokenAt);
    if (d.calledAt != null) callUsed.push(d.calledAt);
  }
  const nowFree = (n: TimelineNow) =>
    n.pressId ? !pressUsed.has(n.pressId) : !spokenUsed.some((t) => Math.abs(t - n.at) <= SAME_SPOKEN);
  const callFree = (c: TimelineCall) =>
    !callUsed.some((t) => Math.abs(t - c.at) <= SAME_CALL) && !(c.competitorId && competitorUsed.has(c.competitorId));

  // Rule 1: mentions of the same competitor close together are one call.
  const groups: Group[] = [];
  for (const c of tl.calls) {
    const id = c.competitorId ?? (c.how === 'ambiguous' ? `~${c.digits}` : `?${c.digits}`);
    let g: Group | undefined;
    for (let i = groups.length - 1; i >= 0; i--) {
      if (groups[i].id === id && c.at - groups[i].last.until <= MENTIONS_WITHIN) { g = groups[i]; break; }
    }
    if (g) { g.mentions.push(c); g.last = c; }
    else groups.push({ id, key: c.key, first: c, last: c, mentions: [c] });
  }
  const free = groups.filter((g) => g.mentions.every(callFree));
  const nows = tl.nows.filter(nowFree);

  // Rule 2: a word called out after a sail number, before the next one,
  // belongs to it: the caller's "now" for the competitor just called.
  const pairs = new Map<Group, TimelineNow | null>();
  const counts = new Map<Group, { numbers: number; nows: number }>();
  const taken = new Set<string>();
  const groupOf = new Map<TimelineCall, Group>();
  for (const g of groups) for (const m of g.mentions) groupOf.set(m, g);
  for (const n of nows) {
    if (n.word === null) continue;
    let before: TimelineCall | undefined;
    for (const c of tl.calls) if (c.until <= n.at) before = c;
    const g = before && groupOf.get(before);
    if (!g || !free.includes(g) || pairs.has(g) || n.at - before!.until > ANY_WORD_WITHIN) continue;
    pairs.set(g, n);
    taken.add(n.key);
  }

  // Rule 3: runs of sail numbers followed by NOWs.
  type Run = { calls: Group[]; nows: TimelineNow[] };
  const events = [
    ...free.filter((g) => !pairs.has(g)).map((g) => ({ at: g.first.at, g, n: null as TimelineNow | null })),
    ...nows.filter((n) => !taken.has(n.key)).map((n) => ({ at: n.at, g: null as Group | null, n })),
  ].sort((a, b) => a.at - b.at || (a.g ? -1 : 1));
  const runs: Run[] = [];
  let run: Run | null = null;
  for (const e of events) {
    if (e.g) {
      if (!run || run.nows.length > 0) runs.push((run = { calls: [], nows: [] }));
      run.calls.push(e.g);
    } else {
      if (!run) runs.push((run = { calls: [], nows: [] }));
      run.nows.push(e.n!);
    }
  }

  // Rule 4: NOWs with no sail number before them, and the run after them
  // short of exactly that many, its first sail number a few seconds on.
  for (let i = 0; i + 1 < runs.length; i++) {
    const a = runs[i], b = runs[i + 1];
    if (a.calls.length > 0 || a.nows.length === 0) continue;
    if (b.calls.length - b.nows.length !== a.nows.length) continue;
    if (b.calls[0].first.at - a.nows[a.nows.length - 1].at > NOW_THEN_NUMBER) continue;
    a.nows.forEach((n, j) => pairs.set(b.calls[j], n));
    b.calls = b.calls.slice(a.nows.length);
    a.nows = [];
  }

  const offers: Record<string, string[]> = {};
  const lone: TimelineNow[] = [];
  const timedOf = (g: Group) => takesTime(g.first.competitorId);
  for (const r of runs) {
    if (r.calls.length === r.nows.length) {
      r.calls.forEach((g, j) => pairs.set(g, r.nows[j]));
      continue;
    }
    const timed = r.calls.filter(timedOf);
    if (timed.length > 0 && timed.length === r.nows.length && timed.length < r.calls.length) {
      // The fleets that need no time needed no NOW: the others pair.
      timed.forEach((g, j) => pairs.set(g, r.nows[j]));
      r.calls.filter((g) => !timedOf(g)).forEach((g) => pairs.set(g, null));
      continue;
    }
    if (r.calls.length === 0) {
      lone.push(...r.nows);
      continue;
    }
    for (const g of r.calls) {
      pairs.set(g, null);
      if (r.nows.length > 0) counts.set(g, { numbers: r.calls.length, nows: r.nows.length });
    }
    for (const n of r.nows) offers[n.key] = r.calls.map((g) => g.first.key);
  }

  const out: Suggestion[] = [];
  for (const [g, n] of pairs) {
    const c = g.first;
    const timed = timedOf(g);
    const sure = c.how === 'whole' || c.how === 'ending';
    const named = c.competitorId !== null;
    // A sail number on no entry, or fitting several, with no NOW to go on,
    // is as likely talk as a finish where finishes are timed.
    if (!n && !named && timed && !counts.has(g)) continue;
    let check: CheckWhy | null = null;
    if (c.how === 'sounds') check = { why: 'close-match' };
    else if (c.how === 'ambiguous') check = { why: 'could-be' };
    else if (c.how === 'unknown') check = { why: 'not-on-list' };
    if (!n && timed) {
      const disagree = counts.get(g);
      if (disagree) check = { why: 'counts', ...disagree };
      else if (!check || sure) check = { why: 'called-time' };
    }
    out.push({
      key: g.key,
      competitorId: c.competitorId,
      sailNumber: named ? null : c.digits || null,
      couldBe: c.couldBe,
      heard: c.heard,
      at: n ? n.at : g.last.at,
      timeFrom: n ? (n.pressId ? 'press' : 'spoken') : 'called',
      pressId: n?.pressId ?? null,
      calledAt: c.at,
      callKey: c.key,
      nowKey: n?.key ?? null,
      check,
    });
  }
  for (const n of lone) {
    out.push({
      key: n.key,
      competitorId: null,
      sailNumber: null,
      couldBe: [],
      heard: null,
      at: n.at,
      timeFrom: n.pressId ? 'press' : 'spoken',
      pressId: n.pressId,
      calledAt: null,
      callKey: null,
      nowKey: n.key,
      check: { why: 'no-sail-number' },
    });
  }

  // One suggestion for a competitor: the one with a NOW, or else the latest.
  const best = new Map<string, Suggestion>();
  for (const s of out) {
    if (!s.competitorId) continue;
    const had = best.get(s.competitorId);
    const better = !had || (had.timeFrom === 'called' && s.timeFrom !== 'called') || (had.timeFrom === s.timeFrom && s.at > had.at);
    if (better) best.set(s.competitorId, s);
  }
  const suggestions = out
    .filter((s) => !s.competitorId || best.get(s.competitorId) === s)
    .sort((a, b) => a.at - b.at);
  return { suggestions, offers };
}

const COUNT = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const counted = (n: number, one: string, many: string) => `${COUNT[n] ?? n} ${n === 1 ? one : many}`;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Why a suggestion is to check, in words, naming competitors by `name`. */
export function checkText(s: Pick<Suggestion, 'check' | 'heard' | 'couldBe'>, name: (competitorId: string) => string): string {
  const c = s.check;
  if (!c) return '';
  switch (c.why) {
    case 'close-match':
      return `Close match: heard “${s.heard ?? ''}”`;
    case 'not-on-list':
      return `Heard “${s.heard ?? ''}”: not on the entry list`;
    case 'could-be':
      return `Could be ${s.couldBe.map(name).join(' or ')}`;
    case 'no-sail-number':
      return 'Time recorded, but no sail number';
    case 'counts':
      return capital(`${counted(c.nows, 'NOW', 'NOWs')} for ${counted(c.numbers, 'sail number', 'sail numbers')}`);
    case 'called-time':
      return 'Time taken from when the sail number was called out';
  }
}

/** Where a finish's time came from, in words. */
export function timeFromText(timeFrom: VoiceTimeFrom, word?: string | null): string {
  switch (timeFrom) {
    case 'press':
      return 'NOW button';
    case 'spoken':
      return word ? `Heard “${word}”` : 'A word called out';
    case 'called':
      return 'When called out';
    case 'hand':
      return 'Set by hand';
  }
}

/** The NOW a finish took its time from, if it is one on the timeline. */
export function nowOf(finish: Pick<VoiceFinish, 'pressId' | 'timeFrom' | 'at'>, nows: readonly TimelineNow[]): TimelineNow | undefined {
  if (finish.pressId) return nows.find((n) => n.pressId === finish.pressId);
  if (finish.timeFrom === 'spoken') return nows.find((n) => n.pressId === null && Math.abs(n.at - finish.at) <= SAME_SPOKEN);
  return undefined;
}

/** The call a finish was made from, if it is one on the timeline. */
export function callOf(finish: Pick<VoiceFinish, 'calledAt'>, calls: readonly TimelineCall[]): TimelineCall | undefined {
  if (finish.calledAt == null) return undefined;
  return calls.find((c) => Math.abs(c.at - finish.calledAt!) <= SAME_CALL);
}
