// Run each recogniser over the sessions and score what calls.mjs makes of
// its words against what was really called.
//
//   node run.mjs <modelsDir> <sessionsDir> [engine ...]
//
// FILTER=<regex> keeps the sessions whose file name matches; SHOW=<n> prints
// the first n calls each engine got wrong or missed.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { callsFrom, prepare } from '../calls.mjs';

const require = createRequire(import.meta.url);
const sherpa = require('sherpa-onnx-node');
const [modelsDir, sessionsDir, ...only] = process.argv.slice(2);
const SR = 16000;
const m = (...p) => path.join(modelsDir, ...p);

function readWav(file) {
  const b = fs.readFileSync(file);
  const n = (b.length - 44) / 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = b.readInt16LE(44 + i * 2) / 32768;
  return out;
}

/** BPE tokens with times -> words with times (a word starts at "▁"). */
function wordsOf(tokens, times, offset = 0) {
  const words = [];
  tokens.forEach((tok, i) => {
    if (tok.startsWith('▁') || tok.startsWith(' ') || words.length === 0) {
      words.push({ w: tok.replace(/^[▁ ]/, ''), t: offset + times[i] });
    } else words[words.length - 1].w += tok;
  });
  return words.filter((x) => x.w);
}

// ---- A: a streaming transducer writing ordinary words ----------------------
function streaming({ encoder, decoder, joiner, tokens }) {
  const rec = new sherpa.OnlineRecognizer({
    featConfig: { sampleRate: SR, featureDim: 80 },
    modelConfig: { transducer: { encoder, decoder, joiner }, tokens, numThreads: 2, provider: 'cpu', debug: 0 },
    decodingMethod: 'greedy_search',
    enableEndpoint: 1,
    rule1MinTrailingSilence: 2.0,
    rule2MinTrailingSilence: 0.9,
    rule3MinUtteranceLength: 30,
  });
  return (samples) => {
    const stream = rec.createStream();
    const words = [];
    const chunk = SR / 10;
    let segStart = 0;
    const t0 = performance.now();
    for (let at = 0; at < samples.length; at += chunk) {
      stream.acceptWaveform({ samples: samples.subarray(at, at + chunk), sampleRate: SR });
      while (rec.isReady(stream)) rec.decode(stream);
      if (rec.isEndpoint(stream)) {
        const r = rec.getResult(stream);
        if (r.tokens.length) words.push(...wordsOf(r.tokens, r.timestamps, segStart));
        rec.reset(stream);
        segStart = (at + chunk) / SR;
      }
    }
    const r = rec.getResult(stream);
    if (r.tokens.length) words.push(...wordsOf(r.tokens, r.timestamps, segStart));
    return { words, cpu: (performance.now() - t0) / 1000 };
  };
}

// ---- B: cut at silences, then a whole-utterance model -----------------
function segmented(modelConfig) {
  const dir = m('sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27');
  const rec = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: SR, featureDim: 80 },
    modelConfig: modelConfig ?? {
      moonshine: { encoder: path.join(dir, 'encoder_model.ort'), mergedDecoder: path.join(dir, 'decoder_model_merged.ort') },
      tokens: path.join(dir, 'tokens.txt'), numThreads: 2, provider: 'cpu', debug: 0,
    },
  });
  return (samples) => {
    const vad = new sherpa.Vad({
      sileroVad: { model: m('silero_vad.onnx'), threshold: 0.5, minSpeechDuration: 0.15, minSilenceDuration: 0.35, windowSize: 512 },
      sampleRate: SR, numThreads: 1, provider: 'cpu', debug: 0,
    }, 60);
    const words = [];
    const t0 = performance.now();
    const drain = () => {
      while (!vad.isEmpty()) {
        const seg = vad.front(false);
        vad.pop();
        const s = rec.createStream();
        s.acceptWaveform({ samples: seg.samples, sampleRate: SR });
        rec.decode(s);
        const text = rec.getResult(s).text.trim();
        const start = seg.start / SR;
        const dur = seg.samples.length / SR;
        const ws = text.split(/\s+/).filter(Boolean);
        // No word times from this model: spread the words across the segment.
        ws.forEach((w, i) => words.push({ w, t: start + (dur * (i + 0.5)) / ws.length, seg: text }));
      }
    };
    for (let at = 0; at < samples.length; at += 512) {
      const win = samples.subarray(at, at + 512);
      if (win.length < 512) break;
      vad.acceptWaveform(win);
      drain();
    }
    vad.flush();
    drain();
    return { words, cpu: (performance.now() - t0) / 1000 };
  };
}

// ---- scoring -----------------------------------------------------------------
/**
 * rows: [{ id | null, t, markAt }] in time order. A call is right when a row
 * near it names its boat. Only then are the leftover rows looked at: one
 * close to a call still unanswered is that call got wrong, or left open.
 */
function score(truth, rows, kind) {
  const used = new Set();
  const answered = new Map();
  let right = 0, wrong = 0, unresolved = 0, missed = 0, suggested = 0, wrongSuggested = 0;
  const markErr = [];
  const misses = [];
  for (const h of truth) {
    const lo = h.tStart - 1.0;
    const hi = (h.tNow ?? h.tEnd) + 2.5;
    const i = rows.findIndex((r, i) => !used.has(i) && r.id === h.id && r.t >= lo && r.t <= hi);
    if (i < 0) continue;
    used.add(i); answered.set(h, rows[i]); right++; if (rows[i].sure === false) suggested++;
    if (kind === 'timed' && rows[i].markAt != null) markErr.push(rows[i].markAt - h.tNow);
  }
  for (const h of truth) {
    if (answered.has(h)) continue;
    const i = rows.findIndex((r, i) => !used.has(i) && r.t >= h.tStart - 0.5 && r.t <= h.tEnd + 1.0);
    if (i < 0) { missed++; misses.push(`${h.text} -> (nothing)`); continue; }
    used.add(i);
    if (rows[i].id == null) { unresolved++; misses.push(`${h.text} -> ? ${rows[i].note ?? ''}`); }
    else { wrong++; if (rows[i].sure === false) wrongSuggested++; misses.push(`${h.text} -> WRONG ${rows[i].note ?? rows[i].id}`); }
  }
  const extra = rows.filter((r, i) => !used.has(i));
  return { n: truth.length, right, suggested, wrongSuggested, wrong, unresolved, missed, extra: extra.length, markErr, misses, nows: truth.filter((h) => h.tNow != null).length };
}

function fromWords(words, session) {
  const list = prepare(session.entries, { minEnding: 3 });
  return callsFrom(words, list).map((c) => ({
    id: c.entry ? c.entry.id : null,
    sure: c.how === 'whole' || c.how === 'ending',
    t: c.t, markAt: c.markAt,
    note: `${c.words.join(' ')} [${c.how} ${c.digits ?? ''}${c.entry ? ' -> ' + c.entry.sailNumber : ''}]`,
  }));
}

const sessions = fs.readdirSync(sessionsDir)
  .filter((f) => f.endsWith('.json') && !f.startsWith('results') && new RegExp(process.env.FILTER ?? '.').test(f))
  .map((f) => JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf8')));

// The directory names are the ones the sherpa-onnx release archives unpack to.
const zipformer = (dir, suffix, int8Decoder = false) => streaming({
  encoder: m(dir, `encoder${suffix}.int8.onnx`),
  decoder: m(dir, `decoder${suffix}${int8Decoder ? '.int8' : ''}.onnx`),
  joiner: m(dir, `joiner${suffix}.int8.onnx`),
  tokens: m(dir, 'tokens.txt'),
});
const engines = {
  'zipformer-en-20M': () => zipformer('sherpa-onnx-streaming-zipformer-en-20M-2023-02-17', '-epoch-99-avg-1'),
  'zipformer-en-70M': () => zipformer('sherpa-onnx-streaming-zipformer-en-2023-06-26', '-epoch-99-avg-1-chunk-16-left-128'),
  'kroko-en': () => {
    const dir = 'sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06';
    return streaming({ encoder: m(dir, 'encoder.onnx'), decoder: m(dir, 'decoder.onnx'), joiner: m(dir, 'joiner.onnx'), tokens: m(dir, 'tokens.txt') });
  },
  'vad+moonshine-tiny': () => segmented(),
  'vad+parakeet-110M': () => {
    const dir = 'sherpa-onnx-nemo-parakeet_tdt_ctc_110m-en-36000-int8';
    return segmented({ nemoCtc: { model: m(dir, 'model.int8.onnx') }, tokens: m(dir, 'tokens.txt'), numThreads: 2, provider: 'cpu', debug: 0 });
  },
};

const SUMS = ['n', 'nows', 'right', 'suggested', 'wrongSuggested', 'wrong', 'unresolved', 'missed', 'extra'];
const results = [];
for (const [name, make] of Object.entries(engines)) {
  if (only.length && !only.includes(name)) continue;
  const run = make();
  const sets = new Map();
  for (const s of sessions) {
    const heard = run(readWav(path.join(sessionsDir, `${s.name}.wav`)));
    const sc = score(s.truth, fromWords(heard.words, s), s.kind);
    const key = `${s.kind} ${s.snrDb ?? 'clean'}`;
    const a = sets.get(key) ?? { ...Object.fromEntries(SUMS.map((k) => [k, 0])), markErr: [], cpu: 0, secs: 0, misses: [] };
    for (const k of SUMS) a[k] += sc[k];
    a.markErr.push(...sc.markErr);
    a.cpu += heard.cpu;
    a.secs += s.seconds;
    a.misses.push(...sc.misses.map((x) => `${s.name}: ${x}`));
    sets.set(key, a);
    if (process.env.DUMP === s.name) console.log(heard.words.map((w) => `${w.w}@${w.t.toFixed(1)}`).join(' '));
  }
  for (const [set, a] of [...sets].sort()) {
    const late = a.markErr.map(Math.abs).sort((p, q) => p - q);
    const row = {
      engine: name, set, calls: a.n,
      // Taken down as the right boat, and how many of those only as a suggestion.
      right: `${((100 * a.right) / a.n).toFixed(1)}%`, rightAsSuggestion: a.suggested,
      // Taken down as the wrong boat, and how many of those were only suggested.
      wrong: a.wrong, wrongAsSuggestion: a.wrongSuggested,
      leftOpen: a.unresolved, notHeard: a.missed, fromTalk: a.extra,
      // "now": how many were caught, and how far after the word the time landed.
      nows: `${a.markErr.length}/${a.nows}`,
      nowLate: (a.markErr.reduce((p, q) => p + q, 0) / Math.max(1, a.markErr.length)).toFixed(2),
      nowLateP95: (late[Math.floor(late.length * 0.95)] ?? NaN).toFixed(2),
      secondsPerSecond: (a.cpu / a.secs).toFixed(3),
    };
    results.push(row);
    console.log(JSON.stringify(row));
    if (process.env.SHOW) for (const x of a.misses.slice(0, +process.env.SHOW)) console.log('   ', x);
  }
}
fs.writeFileSync(path.join(sessionsDir, `results-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.json`), JSON.stringify(results, null, 1));
