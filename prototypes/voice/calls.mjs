// Spoken sail numbers: words with times -> calls -> boats on the entry list.
// Engine-agnostic and pure: whatever recogniser produced the words, this is
// the part that decides what was called and when.
//
// The recogniser is not trusted to spell. A caller's "oh" comes back as "or",
// "ninety" as "nineteen", "now" as "no". So a call is read two ways: exactly,
// where the words are number words that make a number on the entry list; and
// failing that, by which boat's number, said aloud, it sounds most like. The
// second is only ever a suggestion.

const UNIT = {
  zero: '0', oh: '0', o: '0', nought: '0', naught: '0',
  one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', niner: '9',
};
// Words a recogniser writes for a digit it heard. Counted only beside a real
// number word, never on their own: "to" and "for" are most of what people say.
const SOUNDS_LIKE = { to: '2', too: '2', for: '4', fore: '4', ate: '8', won: '1', or: '0', owe: '0' };
const TEEN = {
  ten: '10', eleven: '11', twelve: '12', thirteen: '13', fourteen: '14',
  fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19',
};
const TENS = {
  twenty: '2', thirty: '3', forty: '4', fourty: '4', fifty: '5',
  sixty: '6', seventy: '7', eighty: '8', ninety: '9',
};
const REPEAT = { double: 2, triple: 3, treble: 3 };
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const TEENS = Object.keys(TEEN);
const TENS_WORDS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

const clean = (w) => w.toLowerCase().replace(/[^a-z0-9]/g, '');
const isNumberWord = (w) => /^\d+$/.test(w) || w in UNIT || w in TEEN || w in TENS || w in REPEAT || w === 'hundred' || w === 'thousand';

/**
 * Every digit string a run of number words could mean. "Twenty one" is 21 or
 * 201; "sixteen thirteen" is only 1613. A word that merely sounds like a
 * digit at either end of the run may or may not belong to it.
 */
export function digitCandidates(words, { limit = 48 } = {}) {
  const ws = words.map(clean).filter(Boolean);
  const edges = [[0, ws.length]];
  if (ws.length > 1 && ws[0] in SOUNDS_LIKE) edges.push([1, ws.length]);
  if (ws.length > 1 && ws[ws.length - 1] in SOUNDS_LIKE) edges.push([0, ws.length - 1]);
  const out = new Set();
  for (const [a, b] of edges) {
    for (const s of expand(ws.slice(a, b), limit)) out.add(s);
  }
  return [...out].filter((s) => s.length > 0);
}

function expand(ws, limit) {
  let acc = [''];
  const push = (alts) => {
    const next = [];
    for (const p of acc) for (const a of alts) next.push(p + a);
    acc = next.slice(0, limit);
  };
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    const next = ws[i + 1];
    if (/^\d+$/.test(w)) push([w]);
    else if (w in UNIT) push([UNIT[w]]);
    else if (w in SOUNDS_LIKE) push([SOUNDS_LIKE[w]]);
    else if (w in TEEN) push([TEEN[w]]);
    else if (w in TENS) {
      const unit = next && next in UNIT && UNIT[next] !== '0' ? UNIT[next] : null;
      if (unit) { push([TENS[w] + unit, TENS[w] + '0' + unit]); i++; }
      else push([TENS[w] + '0']);
    } else if (w in REPEAT) {
      const d = next && (UNIT[next] ?? SOUNDS_LIKE[next]);
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

function tailValue(ws, j) {
  const w = ws[j];
  if (!w) return null;
  if (w in TENS) {
    const n = ws[j + 1];
    if (n && n in UNIT && UNIT[n] !== '0') return { digits: TENS[w] + UNIT[n], end: j + 2 };
    return { digits: TENS[w] + '0', end: j + 1 };
  }
  if (w in TEEN) return { digits: TEEN[w], end: j + 1 };
  if (w in UNIT) return { digits: UNIT[w], end: j + 1 };
  return null;
}

/** The digits of a sail number: what a caller reads off the sail. */
export const digitsOf = (sailNumber) => sailNumber.replace(/\D/g, '');

/** The ways a caller might say a run of digits, each a list of words. */
export function waysToSay(d) {
  const out = new Map();
  const add = (ws) => out.set(ws.join(' '), ws);
  const single = (zero) => [...d].map((c) => (c === '0' ? zero : ONES[+c]));
  add(single('zero'));
  add(single('oh'));
  const pairs = [];
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
  const doubled = [];
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
function soundKey(w) {
  return clean(w)
    .replace(/^kn/, 'n').replace(/^wr/, 'r').replace(/^wh/, 'w')
    .replace(/ough/g, 'o').replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k')
    .replace(/ee|ea|ie|ey/g, 'i').replace(/y$/, 'i').replace(/oo|ou|ow|oh|oe/g, 'o').replace(/z/g, 's')
    .replace(/(.)\1+/g, '$1');
}
const SOUND_OF = { 0: 'o', 1: 'won', 2: 'to', 3: 'thri', 4: 'for', 5: 'fiv', 6: 'siks', 7: 'seven', 8: 'eit', 9: 'nin' };
function soundOfWord(w) {
  const c = clean(w);
  if (/^\d+$/.test(c)) return [...c].map((d) => SOUND_OF[d]).join('');
  if (c in UNIT) return SOUND_OF[UNIT[c]];
  if (c in SOUNDS_LIKE) return SOUND_OF[SOUNDS_LIKE[c]];
  return soundKey(c);
}
function editDistance(a, b, cost) {
  const prev = new Array(b.length + 1);
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
const letters = (a, b) => (a === b ? 0 : 1);
function wordDistance(a, b) {
  const [x, y] = [soundOfWord(a), soundOfWord(b)];
  if (x === y) return 0;
  return editDistance(x, y, letters) / Math.max(x.length, y.length);
}
/** How far what was heard is from one way of saying a number: 0 is the same. */
function phraseDistance(heard, said) {
  return editDistance(heard, said, wordDistance) / Math.max(said.length, 1);
}

/**
 * The entry list, got ready for matching: each boat's digits and the ways
 * its number (and, for a long number, its last few digits) might be said.
 */
export function prepare(entries, { minEnding = 3 } = {}) {
  const boats = entries.map((e) => {
    const digits = digitsOf(e.sailNumber);
    const said = [];
    if (digits) {
      said.push(...waysToSay(digits));
      for (let n = Math.max(minEnding, 3); n < digits.length; n++) said.push(...waysToSay(digits.slice(-n)));
    }
    return { entry: e, digits, said };
  }).filter((b) => b.digits);
  return { boats, minEnding };
}

/**
 * Who a call names. `how` says how sure:
 *   'whole'     the number called is a boat's whole number
 *   'ending'    it is the last digits of exactly one boat's number
 *   'sounds'    not a number on the list, but it sounds like just one boat's
 *   'ambiguous' it fits more than one boat: `entries` lists them
 *   'unknown'   a number, but no boat's: `digits` is what was called
 *   'none'      not a call at all
 * `finished` lets a boat already across the line give way to one that isn't.
 */
export function whoIs(words, list, { finished = new Set() } = {}) {
  const ws = words.map(clean).filter(Boolean);
  const prefer = (hits) => {
    const open = hits.filter((b) => !finished.has(b.entry.id));
    return open.length ? open : hits;
  };
  const numeric = ws.filter((w) => isNumberWord(w) || w in SOUNDS_LIKE);
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
  const open = ranked.filter((r) => !finished.has(r.b.entry.id));
  const pool = open.length ? open : ranked;
  const [best, next] = pool;
  if (best && best.d <= 0.34 && (!next || next.d - best.d >= 0.12)) {
    return { how: 'sounds', entry: best.b.entry, digits, distance: best.d };
  }
  if (best && best.d <= 0.34) {
    return { how: 'ambiguous', entries: pool.filter((r) => r.d - best.d < 0.12).map((r) => r.b.entry), digits };
  }
  // A number, but nobody's. "Ninety nine" could be 99 or 909: show the plainer.
  if (numeric.length === ws.length && digits.length >= 2) {
    const plain = digitCandidates(ws).sort((a, b) => a.length - b.length)[0];
    return { how: 'unknown', digits: plain };
  }
  return { how: 'none' };
}

/** Words that came out together: a new one starts after a pause. */
export function utterances(words, { maxGap = 1.0 } = {}) {
  const out = [];
  for (const x of words) {
    if (!clean(x.w)) continue;
    const last = out[out.length - 1];
    if (last && x.t - last.tEnd <= maxGap) { last.words.push(x); last.tEnd = x.t; }
    else out.push({ words: [x], t: x.t, tEnd: x.t });
  }
  return out;
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
 * take(utterance) answers { call } for a new call, { marked: call } when the
 * utterance fixed the last call's time, or null for talk. A call is
 * { how, entry?, entries?, digits, words, t, tEnd, markAt, again }.
 */
export function reader(list, { markWithin = 6 } = {}) {
  const finished = new Set();
  let last = null;
  return {
    take(u) {
      let ws = u.words.map((x) => clean(x.w));
      let markAt = null;
      let tEnd = u.tEnd;
      // "sixteen thirteen now", said in one breath: the last word is the mark.
      const tail = ws[ws.length - 1];
      if (ws.length > 1 && !isNumberWord(tail) && !(tail in SOUNDS_LIKE) && ws.slice(0, -1).some(isNumberWord)) {
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
      const again = m.entry ? finished.has(m.entry.id) : false;
      if (m.entry) finished.add(m.entry.id);
      last = { ...m, words: ws, t: u.t, tEnd, markAt, again };
      return { call: last };
    },
    /** Take a call back: its boat can be called again. */
    undo(call) {
      if (call.entry && !call.again) finished.delete(call.entry.id);
      if (last === call) last = null;
    },
  };
}

/** Words with times in, calls out: the whole of a recording at once. */
export function callsFrom(words, list, { maxGap = 1.0, markWithin = 6 } = {}) {
  const r = reader(list, { markWithin });
  const calls = [];
  for (const u of utterances(words, { maxGap })) {
    const x = r.take(u);
    if (x?.call) calls.push(x.call);
  }
  return calls;
}
