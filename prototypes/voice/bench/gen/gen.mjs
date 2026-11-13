// Synthetic finish-line sessions: a caller hailing sail numbers (and "now"),
// other people talking, wind. Each session is a wav plus the truth.
//
//   node gen.mjs <modelsDir> <outDir>
//
// Needs sherpa-onnx-node 1.x (this directory's package.json): 2.x no longer
// turns text into phonemes for these voices by itself.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const sherpa = require('sherpa-onnx-node');
const [modelsDir, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });

const SR = 16000;

// A seeded generator, so a session is the same every time it's built.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function digitByDigit(d, r) {
  const out = [];
  for (let i = 0; i < d.length; i++) {
    if (d[i] === d[i + 1] && r() < 0.35) { out.push('double', d[i] === '0' ? 'oh' : ONES[+d[i]]); i++; }
    else out.push(d[i] === '0' ? (r() < 0.5 ? 'oh' : 'zero') : ONES[+d[i]]);
  }
  return out.join(' ');
}
function pair(p) {
  const [a, b] = [+p[0], +p[1]];
  if (a === 0 && b === 0) return 'double oh';
  if (a === 0) return `oh ${ONES[b]}`;
  if (a === 1) return TEENS[b];
  return b === 0 ? TENS[a] : `${TENS[a]} ${ONES[b]}`;
}
function inPairs(d) {
  const parts = [];
  let rest = d;
  if (rest.length % 2) { parts.push(ONES[+rest[0]]); rest = rest.slice(1); }
  for (let i = 0; i < rest.length; i += 2) parts.push(pair(rest.slice(i, i + 2)));
  return parts.join(' ');
}

const CRUISERS = [
  '1613', '1631', '2016', '2060', '8338', '4078', '4087', '1141', '3939', '7111',
  '5522', '1333', '1330', '9970', '3061', '1543', '811', '2129', '6001', '4464',
  '1975', '3007', '2552', '7777', '1367', '36026',
].map((n, i) => ({ id: `c${i}`, sailNumber: `IRL ${n}` }));

function dinghies(r) {
  const seen = new Set();
  const out = [];
  while (out.length < 40) {
    const tail = String(Math.floor(r() * 10000)).padStart(4, '0');
    if (seen.has(tail)) continue;
    seen.add(tail);
    out.push({ id: `d${out.length}`, sailNumber: `2${1 + Math.floor(r() * 2)}${tail}` });
  }
  return out;
}

const CHATTER = [
  "that's the last of class one I think",
  'who is that behind them',
  'can you read the number yet',
  'we have about two minutes now before the next one',
  'are there four boats still to come',
  'now where has the mark boat gone',
  'keep an eye on the pin end',
  "I can't read it yet",
  'right, get ready for this one',
  'is that one of ours',
  'they were over at the start, weren’t they',
  'write that down for me',
];

function resample(samples, from) {
  if (from === SR) return samples;
  // A proper low-pass before decimating: a linear pick folds the top of the
  // band back into the speech.
  const r = new sherpa.LinearResampler(from, SR, 0.99 * Math.min(from, SR) / 2, 6);
  return r.resample(samples, true);
}

const tts = new sherpa.OfflineTts({
  model: {
    vits: {
      model: path.join(modelsDir, 'vits-piper-en_GB-vctk-medium/en_GB-vctk-medium.onnx'),
      tokens: path.join(modelsDir, 'vits-piper-en_GB-vctk-medium/tokens.txt'),
      dataDir: path.join(modelsDir, 'vits-piper-en_GB-vctk-medium/espeak-ng-data'),
    },
    numThreads: 4,
    provider: 'cpu',
  },
  maxNumSentences: 1,
});

function say(text, sid, speed) {
  const a = tts.generate({ text, sid, speed });
  const s = resample(a.samples, a.sampleRate);
  // Trim the silence the voice leaves at either end, so gaps are the ones
  // asked for, but keep enough either side for a soft consonant.
  let lo = 0, hi = s.length - 1;
  while (lo < hi && Math.abs(s[lo]) < 0.004) lo++;
  while (hi > lo && Math.abs(s[hi]) < 0.004) hi--;
  return s.slice(Math.max(0, lo - 1600), Math.min(s.length, hi + 2400));
}

const rms = (x, a = 0, b = x.length) => {
  let t = 0;
  for (let i = a; i < b; i++) t += x[i] * x[i];
  return Math.sqrt(t / Math.max(1, b - a));
};

/** Wind on a microphone: low rumble that comes and goes, over a steady hiss. */
function wind(n, r) {
  const out = new Float32Array(n);
  let brown = 0, gust = 0.5, target = 0.5;
  for (let i = 0; i < n; i++) {
    brown = 0.995 * brown + 0.07 * (r() * 2 - 1);
    if (i % 8000 === 0) target = 0.25 + r() * 0.75;
    gust += (target - gust) * 0.0002;
    out[i] = brown * gust + 0.02 * (r() * 2 - 1);
  }
  return out;
}

function writeWav(file, samples) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
}

/**
 * kind 'timed': each boat called, then "now" as she crosses, a few seconds
 * apart, with talk in between. kind 'burst': numbers called one after another
 * by their last four digits, no times.
 */
function build({ name, kind, seed, caller, snrDb }) {
  const r = rng(seed);
  const entries = kind === 'timed' ? CRUISERS : dinghies(rng(7));
  const order = [...entries].sort(() => r() - 0.5).slice(0, kind === 'timed' ? 22 : 34);
  const speed = 1.0 + r() * 0.25;
  const clips = [];
  let t = 2.0;
  const truth = [];
  const place = (samples, gain = 1) => { clips.push({ at: Math.round(t * SR), samples, gain }); const start = t; t += samples.length / SR; return start; };

  for (const e of order) {
    const d = e.sailNumber.replace(/\D/g, '');
    const called = kind === 'burst' ? d.slice(-4) : d;
    const style = r() < 0.5 ? 'digits' : 'pairs';
    const text = style === 'digits' ? digitByDigit(called, r) : inPairs(called);
    const tStart = place(say(text, caller, speed));
    const tEnd = t;
    let tNow = null;
    if (kind === 'timed') {
      t += 0.25 + r() * 1.6;
      tNow = place(say('now', caller, speed));
    }
    truth.push({ id: e.id, sailNumber: e.sailNumber, called, text, style, tStart, tEnd, tNow });
    t += kind === 'timed' ? 2.5 + r() * 5 : 0.7 + r() * 1.3;
    if (kind === 'timed' && r() < 0.35) {
      const other = r() < 0.6;
      const line = CHATTER[Math.floor(r() * CHATTER.length)];
      place(say(line, other ? (caller + 17 + Math.floor(r() * 40)) % 109 : caller, 1.05), other ? 0.5 : 1);
      t += 1.5 + r() * 2;
    }
  }
  const n = Math.round((t + 2) * SR);
  const speech = new Float32Array(n);
  let active = 0, energy = 0;
  for (const c of clips) {
    for (let i = 0; i < c.samples.length && c.at + i < n; i++) speech[c.at + i] += c.samples[i] * c.gain;
    if (c.gain === 1) { energy += rms(c.samples) ** 2 * c.samples.length; active += c.samples.length; }
  }
  const speechRms = Math.sqrt(energy / active);
  const out = new Float32Array(speech);
  if (snrDb !== null) {
    const w = wind(n, rng(seed + 99));
    const g = speechRms / rms(w) / 10 ** (snrDb / 20);
    for (let i = 0; i < n; i++) out[i] += w[i] * g;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0.98) for (let i = 0; i < n; i++) out[i] *= 0.98 / peak;
  writeWav(path.join(outDir, `${name}.wav`), out);
  fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify({ name, kind, caller, snrDb, seconds: n / SR, entries, truth }, null, 1));
  console.log(`${name}: ${truth.length} hails, ${(n / SR).toFixed(0)}s, caller ${caller}, snr ${snrDb ?? 'clean'}`);
}

const callers = [3, 11, 24, 37, 52, 68, 80, 95];
let seed = 100;
for (const kind of ['timed', 'burst']) {
  for (const snrDb of [null, 10, 0]) {
    for (const caller of callers) {
      build({ name: `${kind}-${snrDb ?? 'clean'}-v${caller}`, kind, seed: seed++, caller, snrDb });
    }
  }
}
