/**
 * Spoken sail numbers: words with times in, calls out, read against a race's
 * entry list. Pure, with no dependency on the recogniser or the browser:
 * whatever produced the words, this decides what was called and when.
 *
 * The recogniser is not trusted to spell. A caller's "oh" comes back as "or",
 * "ninety" as "nineteen", "now" as "no". So a call is read two ways: exactly,
 * where the words are number words that make a number on the entry list; and
 * failing that, by which boat's number, said aloud, it sounds most like. The
 * second is only ever a suggestion.
 */

/** A boat a call can name. `id` is whatever the caller of this module uses. */
export interface CallEntry {
  id: string;
  sailNumber: string;
}

/** A word the recogniser heard, and when (seconds on the session's clock). */
export interface HeardWord {
  w: string;
  t: number;
}

/** Words that came out together. */
export interface Utterance {
  words: HeardWord[];
  /** When the first word was said. */
  t: number;
  /** When the last word was said. */
  tEnd: number;
}

/**
 * How sure a call is of its boat:
 *   whole      the number called is a boat's whole number
 *   ending     it is the last digits of exactly one boat's number
 *   sounds     not a number on the list, but it sounds like just one boat's
 *   ambiguous  it fits more than one boat: `entries` lists them
 *   unknown    a number, but no boat's: `digits` is what was called
 *   none       not a call at all
 */
export type CallMatch<E extends CallEntry = CallEntry> =
  | { how: 'whole' | 'ending'; entry: E; digits: string }
  | { how: 'sounds'; entry: E; digits: string; distance: number }
  | { how: 'ambiguous'; entries: E[]; digits: string }
  | { how: 'unknown'; digits: string }
  | { how: 'none' };

export type Call<E extends CallEntry = CallEntry> = Exclude<CallMatch<E>, { how: 'none' }> & {
  /** The words of the number, cleaned. */
  words: string[];
  /** When the number began and ended. */
  t: number;
  tEnd: number;
  /** When the word after the number was said, once one has been. */
  markAt: number | null;
  /** The boat was already across the line when this was called. */
  again: boolean;
};

const UNIT: Record<string, string> = {
  zero: '0', oh: '0', o: '0', nought: '0', naught: '0',
  one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', niner: '9',
};
// Words a recogniser writes for a digit it heard. Counted only beside a real
// number word, never on their own: "to" and "for" are most of what people say.
const SOUNDS_LIKE: Record<string, string> = {
  to: '2', too: '2', for: '4', fore: '4', ate: '8', won: '1', or: '0', owe: '0',
};
const TEEN: Record<string, string> = {
  ten: '10', eleven: '11', twelve: '12', thirteen: '13', fourteen: '14',
  fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19',
};
const TENS: Record<string, string> = {
  twenty: '2', thirty: '3', forty: '4', fourty: '4', fifty: '5',
  sixty: '6', seventy: '7', eighty: '8', ninety: '9',
};
const REPEAT: Record<string, number> = { double: 2, triple: 3, treble: 3 };
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const TEENS = Object.keys(TEEN);
const TENS_WORDS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

const has = (table: object, w: string) => Object.prototype.hasOwnProperty.call(table, w);

export const cleanWord = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, '');
const isNumberWord = (w: string) =>
  /^\d+$/.test(w) || has(UNIT, w) || has(TEEN, w) || has(TENS, w) || has(REPEAT, w) || w === 'hundred' || w === 'thousand';
const soundsLikeDigit = (w: string) => has(SOUNDS_LIKE, w);

/**
 * Every digit string a run of number words could mean. "Twenty one" is 21 or
 * 201; "sixteen thirteen" is only 1613. A word that merely sounds like a
 * digit at either end of the run may or may not belong to it.
 */
export function digitCandidates(words: readonly string[], { limit = 48 } = {}): string[] {
  const ws = words.map(cleanWord).filter(Boolean);
  const edges: [number, number][] = [[0, ws.length]];
  if (ws.length > 1 && soundsLikeDigit(ws[0])) edges.push([1, ws.length]);
  if (ws.length > 1 && soundsLikeDigit(ws[ws.length - 1])) edges.push([0, ws.length - 1]);
  const out = new Set<string>();
  for (const [a, b] of edges) {
    for (const s of expand(ws.slice(a, b), limit)) out.add(s);
  }
  return [...out].filter((s) => s.length > 0);
}

function expand(ws: string[], limit: number): string[] {
  let acc = [''];
  const push = (alts: string[]) => {
    const next: string[] = [];
    for (const p of acc) for (const a of alts) next.push(p + a);
    acc = next.slice(0, limit);
  };
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    const next = ws[i + 1];
    if (/^\d+$/.test(w)) push([w]);
    else if (has(UNIT, w)) push([UNIT[w]]);
    else if (soundsLikeDigit(w)) push([SOUNDS_LIKE[w]]);
    else if (has(TEEN, w)) push([TEEN[w]]);
    else if (has(TENS, w)) {
      const unit = next && has(UNIT, next) && UNIT[next] !== '0' ? UNIT[next] : null;
      if (unit) { push([TENS[w] + unit, TENS[w] + '0' + unit]); i++; }
      else push([TENS[w] + '0']);
    } else if (has(REPEAT, w)) {
      const d = next ? (has(UNIT, next) ? UNIT[next] : has(SOUNDS_LIKE, next) ? SOUNDS_LIKE[next] : null) : null;
      if (d) { push([d.repeat(REPEAT[w])]); i++; }
    } else if (w === 'hundred' || w === 'thousand') {
      const zeros = w === 'hundred' ? 2 : 3;
      // "two hundred and five" fills the zeros; "two hundred, five" doesn't.
      let j = i + 1;
      if (ws[j] === 'and') j++;
      const tail = tailValue(ws, j);
      if (tail && tail.digits.length <= zeros) {
        push(['0'.repeat(zeros - tail.digits.length) + tail.digits]);
        i = tail.end - 1;
      } else push(['0'.repeat(zeros)]);
    }
  }
  return acc;
}

function tailValue(ws: string[], j: number): { digits: string; end: number } | null {
  const w = ws[j];
  if (!w) return null;
  if (has(TENS, w)) {
    const n = ws[j + 1];
    if (n && has(UNIT, n) && UNIT[n] !== '0') return { digits: TENS[w] + UNIT[n], end: j + 2 };
    return { digits: TENS[w] + '0', end: j + 1 };
  }
  if (has(TEEN, w)) return { digits: TEEN[w], end: j + 1 };
  if (has(UNIT, w)) return { digits: UNIT[w], end: j + 1 };
  return null;
}

/** The digits of a sail number: what a caller reads off the sail. */
export const digitsOf = (sailNumber: string) => sailNumber.replace(/\D/g, '');

/** The ways a caller might say a run of digits, each a list of words. */
export function waysToSay(d: string): string[][] {
  const out = new Map<string, string[]>();
  const add = (ws: string[]) => out.set(ws.join(' '), ws);
  const single = (zero: string) => [...d].map((c) => (c === '0' ? zero : ONES[+c]));
  add(single('zero'));
  add(single('oh'));
  const pairs: string[] = [];
  let rest = d;
  if (rest.length % 2) { pairs.push(ONES[+rest[0]]); rest = rest.slice(1); }
  for (let i = 0; i < rest.length; i += 2) {
    const [a, b] = [+rest[i], +rest[i + 1]];
    if (a === 0 && b === 0) pairs.push('double', 'oh');
    else if (a === 0) pairs.push('oh', ONES[b]);
    else if (a === 1) pairs.push(TEENS[b]);
    else if (b === 0) pairs.push(TENS_WORDS[a]);
    else pairs.push(TENS_WORDS[a], ONES[b]);
  }
  add(pairs);
  // "Double" wherever a digit repeats.
  const doubled: string[] = [];
  for (let i = 0; i < d.length; i++) {
    if (d[i] === d[i + 1]) { doubled.push('double', d[i] === '0' ? 'oh' : ONES[+d[i]]); i++; }
    else doubled.push(d[i] === '0' ? 'oh' : ONES[+d[i]]);
  }
  add(doubled);
  return [...out.values()];
}

// How alike two words sound, 0 (the same) to 1, judged from their spelling
// with the commonest sound-alike spellings folded together. Rough, and meant
// to be: it only has to rank a handful of boats.
function soundKey(w: string): string {
  return cleanWord(w)
    .replace(/^kn/, 'n').replace(/^wr/, 'r').replace(/^wh/, 'w')
    .replace(/ough/g, 'o').replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k')
    .replace(/ee|ea|ie|ey/g, 'i').replace(/y$/, 'i').replace(/oo|ou|ow|oh|oe/g, 'o').replace(/z/g, 's')
    .replace(/(.)\1+/g, '$1');
}
const SOUND_OF: Record<string, string> = {
  0: 'o', 1: 'won', 2: 'to', 3: 'thri', 4: 'for', 5: 'fiv', 6: 'siks', 7: 'seven', 8: 'eit', 9: 'nin',
};
function soundOfWord(w: string): string {
  const c = cleanWord(w);
  if (/^\d+$/.test(c)) return [...c].map((d) => SOUND_OF[d]).join('');
  if (has(UNIT, c)) return SOUND_OF[UNIT[c]];
  if (has(SOUNDS_LIKE, c)) return SOUND_OF[SOUNDS_LIKE[c]];
  return soundKey(c);
}
function editDistance<T>(a: ArrayLike<T>, b: ArrayLike<T>, cost: (x: T, y: T) => number): number {
  const prev = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(up + 1, prev[j - 1] + 1, diag + cost(a[i - 1], b[j - 1]));
      diag = up;
    }
  }
  return prev[b.length];
}
const letters = (a: string, b: string) => (a === b ? 0 : 1);
function wordDistance(a: string, b: string): number {
  const [x, y] = [soundOfWord(a), soundOfWord(b)];
  if (x === y) return 0;
  return editDistance(x, y, letters) / Math.max(x.length, y.length);
}
/** How far what was heard is from one way of saying a number: 0 is the same. */
function phraseDistance(heard: string[], said: string[]): number {
  return editDistance(heard, said, wordDistance) / Math.max(said.length, 1);
}

/** The entry list, got ready for matching. */
export interface PreparedList<E extends CallEntry = CallEntry> {
  boats: { entry: E; digits: string; said: string[][] }[];
  minEnding: number;
}

/**
 * The entry list, got ready for matching: each boat's digits and the ways
 * its number (and, for a long number, its last few digits) might be said.
 * A boat whose sail number has no digits can't be called by number, and is
 * left out.
 */
export function prepare<E extends CallEntry>(entries: readonly E[], { minEnding = 3 } = {}): PreparedList<E> {
  const boats = entries
    .map((e) => {
      const digits = digitsOf(e.sailNumber);
      const said: string[][] = [];
      if (digits) {
        said.push(...waysToSay(digits));
        for (let n = Math.max(minEnding, 3); n < digits.length; n++) said.push(...waysToSay(digits.slice(-n)));
      }
      return { entry: e, digits, said };
    })
    .filter((b) => b.digits);
  return { boats, minEnding };
}

/** How close a sound-alike has to be, and how far clear of the next boat. */
const SOUNDS_WITHIN = 0.34;
const SOUNDS_CLEAR_BY = 0.12;

/**
 * Who a run of words names. `finished` lets a boat already across the line
 * give way to one that isn't.
 */
export function whoIs<E extends CallEntry>(
  words: readonly string[],
  list: PreparedList<E>,
  { finished = () => false }: { finished?: (entryId: string) => boolean } = {},
): CallMatch<E> {
  const ws = words.map(cleanWord).filter(Boolean);
  const prefer = <B extends { entry: E }>(hits: B[]): B[] => {
    const open = hits.filter((b) => !finished(b.entry.id));
    return open.length ? open : hits;
  };
  const numeric = ws.filter((w) => isNumberWord(w) || soundsLikeDigit(w));
  const strong = ws.filter(isNumberWord);
  let digits = '';
  if (strong.length && numeric.length === ws.length) {
    const candidates = digitCandidates(ws).sort((a, b) => b.length - a.length);
    digits = candidates[0] ?? '';
    for (const d of candidates) {
      const hits = prefer(list.boats.filter((b) => b.digits === d));
      if (hits.length === 1) return { how: 'whole', entry: hits[0].entry, digits: d };
      if (hits.length > 1) return { how: 'ambiguous', entries: hits.map((b) => b.entry), digits: d };
    }
    for (const d of candidates) {
      if (d.length < list.minEnding) continue;
      const hits = prefer(list.boats.filter((b) => b.digits.length > d.length && b.digits.endsWith(d)));
      if (hits.length === 1) return { how: 'ending', entry: hits[0].entry, digits: d };
      if (hits.length > 1) return { how: 'ambiguous', entries: hits.map((b) => b.entry), digits: d };
    }
  }
  // Not a number on the list as heard. Which boat does it sound like?
  if (strong.length === 0 || ws.length > 9) return { how: 'none' };
  const ranked = list.boats
    .map((b) => ({ b, d: Math.min(...b.said.map((s) => phraseDistance(ws, s))) }))
    .sort((p, q) => p.d - q.d);
  const open = ranked.filter((r) => !finished(r.b.entry.id));
  const pool = open.length ? open : ranked;
  const [best, next] = pool;
  if (best && best.d <= SOUNDS_WITHIN && (!next || next.d - best.d >= SOUNDS_CLEAR_BY)) {
    return { how: 'sounds', entry: best.b.entry, digits, distance: best.d };
  }
  if (best && best.d <= SOUNDS_WITHIN) {
    return {
      how: 'ambiguous',
      entries: pool.filter((r) => r.d - best.d < SOUNDS_CLEAR_BY).map((r) => r.b.entry),
      digits,
    };
  }
  // A number, but nobody's. "Ninety nine" could be 99 or 909: show the plainer.
  if (numeric.length === ws.length && digits.length >= 2) {
    const plain = digitCandidates(ws).sort((a, b) => a.length - b.length)[0];
    return { how: 'unknown', digits: plain };
  }
  return { how: 'none' };
}

/** Words that came out together: a new utterance starts after a pause. */
export function utterances(words: readonly HeardWord[], { maxGap = 1.0 } = {}): Utterance[] {
  const out: Utterance[] = [];
  for (const x of words) {
    if (!cleanWord(x.w)) continue;
    const last = out[out.length - 1];
    if (last && x.t - last.tEnd <= maxGap) { last.words.push(x); last.tEnd = x.t; }
    else out.push({ words: [x], t: x.t, tEnd: x.t });
  }
  return out;
}

export interface CallReader<E extends CallEntry = CallEntry> {
  /**
   * Read one finished utterance: `{ call }` for a new call, `{ marked }`
   * when the utterance fixed the last call's time, or null for talk.
   */
  take(u: Utterance): { call: Call<E> } | { marked: Call<E> } | null;
  /** Forget a call taken back, so the word after it isn't read as its time. */
  forget(call: Call<E>): void;
}

/**
 * Reads utterances one at a time, as they finish. A call is an utterance that
 * names a boat (or a number on no boat). The time of a call is fixed by the
 * short word the caller says as the boat crosses, "now" by custom: any single
 * word said on its own within a few seconds of the number counts, because a
 * recogniser hears "now" as "no", "mow" or "well" as often as not, and what
 * matters is when it was said. The number never moves the time, nor the time
 * the number.
 *
 * `finished` says which boats already have a line, asked at each call: a
 * boat called again is reported as such (`again`), and a number that fits
 * both a finished boat and one still racing goes to the one still racing.
 */
export function reader<E extends CallEntry>(
  list: PreparedList<E>,
  { markWithin = 6, finished = () => false }: { markWithin?: number; finished?: (entryId: string) => boolean } = {},
): CallReader<E> {
  let last: Call<E> | null = null;
  return {
    take(u) {
      let ws = u.words.map((x) => cleanWord(x.w));
      let markAt: number | null = null;
      let tEnd = u.tEnd;
      // "sixteen thirteen now", said in one breath: the last word is the mark.
      const tail = ws[ws.length - 1];
      if (ws.length > 1 && !isNumberWord(tail) && !soundsLikeDigit(tail) && ws.slice(0, -1).some(isNumberWord)) {
        const m = whoIs(ws.slice(0, -1), list, { finished });
        if (m.how !== 'none' && m.how !== 'unknown') {
          markAt = u.words[u.words.length - 1].t;
          tEnd = u.words[u.words.length - 2].t;
          ws = ws.slice(0, -1);
        }
      }
      const m = whoIs(ws, list, { finished });
      if (m.how === 'none') {
        if (ws.length === 1 && last && last.markAt === null && u.t - last.tEnd <= markWithin) {
          last.markAt = u.t;
          return { marked: last };
        }
        return null;
      }
      const again = 'entry' in m ? finished(m.entry.id) : false;
      last = { ...m, words: ws, t: u.t, tEnd, markAt, again };
      return { call: last };
    },
    forget(call) {
      if (last === call) last = null;
    },
  };
}

/** Words with times in, calls out: the whole of a recording at once. */
export function callsFrom<E extends CallEntry>(
  words: readonly HeardWord[],
  list: PreparedList<E>,
  { maxGap = 1.0, markWithin = 6 } = {},
): Call<E>[] {
  const finished = new Set<string>();
  const r = reader(list, { markWithin, finished: (id) => finished.has(id) });
  const calls: Call<E>[] = [];
  for (const u of utterances(words, { maxGap })) {
    const x = r.take(u);
    if (x && 'call' in x) {
      calls.push(x.call);
      if ('entry' in x.call) finished.add(x.call.entry.id);
    }
  }
  return calls;
}
