// Finishes by voice, as a prototype: one page, nothing saved, nothing sent.
// The recogniser runs in listener-worker.js; reading its words as calls is
// calls.mjs. This file is the microphone, the screen and the sounds.

import { digitsOf, prepare, reader, utterances } from './calls.mjs';

const SR = 16000;
const MAX_GAP = 1.0; // a pause this long ends an utterance
const SETTLE = 0.35; // and this much longer before it's read, in case a word is still coming
const LAG = 0.5; // the recogniser writes a word about this long after it was said
const MARK_WITHIN = 6; // "now" counts for this long after a number
const TAP_BEFORE = 3; // a press of Now counts for a call that started up to this long after it

const $ = (id) => document.getElementById(id);
const SAMPLE = `IRL 1613 Kestrel
IRL 1631 Fulmar
IRL 2016 Saoirse
IRL 2060 Petrel
IRL 8338 Gannet
IRL 4078 Dunlin
IRL 4087 Curlew
IRL 1141 Tern
IRL 3939 Shearwater
IRL 7111 Skua
IRL 5522 Whimbrel
IRL 1333 Guillemot
IRL 9970 Razorbill
IRL 3061 Turnstone
IRL 811 Puffin
IRL 2129 Kittiwake
IRL 6001 Sanderling
IRL 1975 Redshank`;

// ---- the entry list ---------------------------------------------------------
function parseEntries(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^((?:[A-Za-z]{1,3}\s*)?\d[\dA-Za-z]*)\s*(.*)$/);
    if (m) out.push({ id: `e${out.length}`, sailNumber: m[1].replace(/\s+/g, ' ').toUpperCase(), name: m[2].trim() });
  }
  return out;
}

// ---- the recogniser ---------------------------------------------------------
let worker = null;
let models = [];
let engineUp = false;
let ready = false;
let waitingForWords = null;

function startWorker() {
  if (worker) worker.terminate();
  engineUp = false;
  ready = false;
  setReady();
  worker = new Worker('listener-worker.js');
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'engine') { engineUp = true; loadModel(); }
    else if (m.type === 'progress') $('loadnote').textContent = `Getting the listening model: ${(m.bytes / 1048576).toFixed(0)} MB…`;
    else if (m.type === 'ready') { ready = true; setReady(); $('loadnote').textContent = 'Ready. Nothing you say leaves this device.'; }
    else if (m.type === 'error') $('loadnote').textContent = `The listening model couldn’t be loaded (${m.message}). Reload the page to try again.`;
    else if (m.type === 'words') {
      if (S) onWords(m);
      if (waitingForWords) { const f = waitingForWords; waitingForWords = null; f(); }
    }
  };
  worker.onerror = (e) => { $('loadnote').textContent = `The listening engine failed to start (${e.message}).`; };
}
function loadModel() {
  const model = models.find((x) => x.id === $('model').value);
  if (!model || !engineUp) return;
  $('modelnote').textContent = model.note ?? '';
  worker.postMessage({ type: 'load', model });
}
function setReady() {
  $('listen').disabled = !ready;
  $('pick').disabled = !ready;
}

// ---- a session: from Listen (or a recording) to Stop -------------------------
let S = null;
let rowIds = 0;

function begin(mode) {
  const entries = parseEntries($('entries').value);
  S = {
    mode, entries, timed: $('timed').checked, model: $('model').value,
    startedAt: null, // wall clock, ms, of the recording's first sample
    pcm: [], captured: 0, heard: 0,
    closed: [], open: [], consumedUntil: -1, allWords: [],
    // How long after a word is said the recogniser hands it over. It differs
    // by model, so it is measured as the words come.
    delay: 0.3, seenUntil: -1,
    rows: [], gaps: [], rd: reader(prepare(entries), { markWithin: MARK_WITHIN }),
    cpu: 0, span: 0,
  };
  worker.postMessage({ type: 'begin' });
  window.__voice = { done: false, rows: () => sheet().map(describe), session: () => S };
}

const now = () => S.captured / SR;
const clockOf = (t) => {
  if (S.mode === 'file') { const s = Math.max(0, t); return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; }
  const d = new Date(S.startedAt + t * 1000);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
};
/** When a line's boat crossed, and how that is known. */
function timeOf(row) {
  if (row.at != null) return { t: row.at, from: row.from };
  return { t: row.call.tEnd - LAG, from: 'called' };
}
const live = () => S.rows.filter((r) => !r.removed);
const sheet = () => live().slice().sort((a, b) => timeOf(a).t - timeOf(b).t);
function describe(row) {
  const c = row.call;
  return {
    time: clockOf(timeOf(row).t), from: timeOf(row).from,
    how: c ? c.how : 'crossed', sailNumber: c?.entry?.sailNumber ?? null, digits: c?.digits ?? null,
    words: c ? c.words.join(' ') : null, couldBe: c?.entries?.map((e) => e.sailNumber) ?? null,
  };
}

function onWords(m) {
  S.cpu += m.cost;
  S.span += m.span;
  S.heard = m.heard;
  for (const w of m.words) {
    if (w.t <= S.seenUntil) continue;
    S.seenUntil = w.t;
    S.delay = Math.min(3, Math.max(S.delay, m.heard - w.t));
  }
  if (m.closed) { S.closed.push(...m.words); S.allWords.push(...m.words); S.open = []; }
  else S.open = m.words;
  read(false);
  const tail = S.closed.concat(S.open).slice(-8).map((w) => w.w).join(' ');
  $('heard').firstElementChild.textContent = tail;
}

/** Read every utterance that has finished; at the end, the unfinished too. */
function read(all) {
  const pending = S.closed.concat(S.open).filter((w) => w.t > S.consumedUntil);
  for (const u of utterances(pending, { maxGap: MAX_GAP })) {
    if (!all && S.heard - u.tEnd < MAX_GAP + SETTLE + S.delay) break;
    take(u);
    S.consumedUntil = u.tEnd;
  }
  S.closed = S.closed.filter((w) => w.t > S.consumedUntil);
}

function take(u) {
  const x = S.rd.take(u);
  if (!x) return;
  if (x.marked) {
    const row = S.rows.find((r) => r.call === x.marked);
    if (row && !row.removed && row.at == null) { row.at = x.marked.markAt - LAG; row.from = 'word'; sound('mark'); render(); }
    return;
  }
  const call = x.call;
  if (call.again) {
    const first = live().find((r) => r.call?.entry?.id === call.entry.id);
    if (first) (first.again ??= []).push(call.tEnd - LAG);
    sound('doubt');
    render();
    return;
  }
  const row = { id: ++rowIds, call, at: null, from: null, removed: false };
  if (call.markAt != null) { row.at = call.markAt - LAG; row.from = 'word'; }
  // A press of Now waiting for a boat: this is her.
  const said = call.t - LAG;
  const tap = live().find((r) => r.tapOnly && r.at >= said - TAP_BEFORE && r.at <= call.tEnd - LAG + MARK_WITHIN);
  if (tap) { tap.removed = true; row.at = tap.at; row.from = 'tap'; }
  S.rows.push(row);
  sound(call.how === 'whole' || call.how === 'ending' ? 'ok' : call.how === 'sounds' ? 'check' : 'doubt');
  render();
}

function pressNow() {
  const t = now();
  // Whose crossing is this? The latest call still waiting for its time. A
  // call that already has its "now" takes the press only if the two agree to
  // within a second or so; otherwise the press is for a boat not yet called.
  const row = live().reverse().find((r) => r.call && r.from !== 'tap' && t - (r.call.tEnd - LAG) <= MARK_WITHIN && t >= r.call.t - LAG - TAP_BEFORE);
  if (row && (row.at == null || Math.abs(t - row.at) <= 1.5)) { row.at = t; row.from = 'tap'; }
  else S.rows.push({ id: ++rowIds, call: null, tapOnly: true, at: t, from: 'tap', removed: false });
  sound('mark');
  render();
}

function undo() {
  const row = live().sort((a, b) => a.id - b.id).pop();
  if (!row) return;
  row.removed = true;
  if (row.call) S.rd.undo(row.call);
  $('state').textContent = `Removed ${label(row).num}`;
  setTimeout(() => { if (S && !S.stopped) $('state').textContent = 'Listening'; }, 2500);
  render();
}

// ---- what a line says --------------------------------------------------------
function label(row) {
  const c = row.call;
  if (!c) return { num: '—', who: 'Crossed, not yet called', tag: 'no boat' };
  if (c.entry) return { num: digitsOf(c.entry.sailNumber), who: c.entry.name || c.entry.sailNumber, tag: c.how === 'sounds' ? 'check' : null };
  if (c.how === 'ambiguous') return { num: `…${c.digits || '?'}`, who: `${c.entries.length} boats`, tag: 'choose' };
  return { num: c.digits, who: 'Not on the entry list', tag: 'unknown' };
}
function whenText(row) {
  if (!S.timed) return '';
  const { t, from } = timeOf(row);
  return from === 'called' ? `called ${clockOf(t)}` : clockOf(t);
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function render() {
  const rows = live().sort((a, b) => b.id - a.id);
  const [last, ...rest] = rows;
  const el = $('last');
  if (last) {
    const l = label(last);
    el.className = l.tag ? 'doubt' : '';
    el.innerHTML = `<div class="num">${esc(l.num)}</div><div class="who">${esc(l.who)}${l.tag ? ` <span class="tag">${l.tag}</span>` : ''}</div><div class="when">${esc(whenText(last))}</div>`;
  } else {
    el.className = '';
    el.innerHTML = '<div class="num">&nbsp;</div><div class="who muted">Call the first boat</div><div class="when"></div>';
  }
  $('lines').innerHTML = rest.map((r) => {
    const l = label(r);
    return `<div class="line"><span class="t">${esc(whenText(r) || '·')}</span><span class="b">${esc(l.num)}<small>${esc(l.who)}</small></span>${l.tag ? `<span class="tag">${l.tag}</span>` : '<span></span>'}</div>`;
  }).join('');
}

// ---- sounds ------------------------------------------------------------------
const TONES = { ok: [[880, 0.09]], check: [[880, 0.09], [520, 0.12]], doubt: [[330, 0.12], [330, 0.12]], mark: [[1320, 0.04]] };
function sound(kind) {
  const ctx = S?.ctx;
  if (!ctx || ctx.state !== 'running') return;
  let t = ctx.currentTime + 0.01;
  for (const [f, d] of TONES[kind]) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + d + 0.02);
    t += d + 0.05;
  }
}

// ---- the microphone ----------------------------------------------------------
const WORKLET = URL.createObjectURL(new Blob([`
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.parts = []; this.n = 0; this.want = Math.round(sampleRate / 10); }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      this.parts.push(ch.slice()); this.n += ch.length;
      if (this.n >= this.want) {
        const out = new Float32Array(this.n); let o = 0;
        for (const p of this.parts) { out.set(p, o); o += p.length; }
        this.port.postMessage(out, [out.buffer]); this.parts = []; this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('tap', Tap);`], { type: 'text/javascript' }));

/** Any rate down to 16 kHz: average over the step, then pick. Speech survives it. */
function resampler(from) {
  if (from === SR) return (x) => x;
  const step = from / SR;
  const width = Math.max(1, Math.round(step));
  let carry = new Float32Array(0);
  let pos = 0;
  return (x) => {
    const buf = new Float32Array(carry.length + x.length);
    buf.set(carry); buf.set(x, carry.length);
    const n = Math.max(0, Math.floor((buf.length - width - pos) / step));
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const at = Math.floor(pos + i * step);
      let sum = 0;
      for (let k = 0; k < width; k++) sum += buf[at + k];
      out[i] = sum / width;
    }
    const used = Math.floor(pos + n * step);
    pos = pos + n * step - used;
    carry = buf.slice(used);
    return out;
  };
}

function store(samples) {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)));
  S.pcm.push(pcm);
  S.captured += samples.length;
}

function onAudio(block, rate) {
  if (!S || S.stopped) return;
  const samples = S.resample(block);
  if (!samples.length) return;
  const wall = Date.now();
  if (S.startedAt == null) S.startedAt = wall - (samples.length / SR) * 1000;
  // The recording's clock is the phone's clock. If the microphone stopped for
  // a while (a call, another app, the screen off), say so and keep the two in
  // step by leaving the gap in the recording.
  const missing = (wall - S.startedAt) / 1000 - (S.captured + samples.length) / SR;
  if (missing > 1.5) {
    const from = now();
    const n = Math.round(missing * SR);
    S.pcm.push(new Int16Array(n));
    S.captured += n;
    worker.postMessage({ type: 'skip', samples: n });
    S.gaps.push({ from, to: now() });
    $('gap').hidden = false;
    $('gap').textContent = `Not listening from ${clockOf(from)} to ${clockOf(now())}. Boats called then were not heard.`;
  }
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  $('level').style.width = `${Math.min(100, Math.sqrt(sum / samples.length) * 500)}%`;
  store(samples);
  worker.postMessage({ type: 'audio', samples }, [samples.buffer]);
}

async function listen() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
  } catch (err) {
    $('loadnote').textContent = `The microphone isn’t available (${err.name}). Allow it for this page, then press Listen again.`;
    return;
  }
  begin('mic');
  let ctx;
  try { ctx = new AudioContext({ sampleRate: SR, latencyHint: 'interactive' }); } catch { ctx = new AudioContext(); }
  await ctx.resume();
  await ctx.audioWorklet.addModule(WORKLET);
  const node = new AudioWorkletNode(ctx, 'tap');
  const quiet = ctx.createGain();
  quiet.gain.value = 0;
  ctx.createMediaStreamSource(stream).connect(node).connect(quiet).connect(ctx.destination);
  Object.assign(S, { ctx, stream, resample: resampler(ctx.sampleRate), mic: stream.getAudioTracks()[0]?.label ?? '' });
  node.port.onmessage = (e) => onAudio(e.data, ctx.sampleRate);
  ctx.onstatechange = () => { $('dot').classList.toggle('off', ctx.state !== 'running'); };
  await keepAwake();
  $('gap').hidden = true;
  $('state').textContent = 'Listening';
  $('listening').hidden = false;
  render();
  S.tick = setInterval(() => { if (S.startedAt != null) $('clock').textContent = clockOf(now()); }, 250);
}

let wakeLock = null;
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !S || S.stopped || S.mode !== 'mic') return;
  keepAwake();
  S.ctx?.resume();
});

function stop() {
  if (!S || S.stopped) return;
  S.stopped = true;
  clearInterval(S.tick);
  S.stream?.getTracks().forEach((t) => t.stop());
  S.ctx?.close();
  wakeLock?.release?.();
  // Give the recogniser a moment to hand over its last words, then read them all.
  setTimeout(() => {
    S.allWords.push(...S.open);
    read(true);
    $('listening').hidden = true;
    $('lock').hidden = true;
    showSheet();
  }, 400);
}

// ---- a recording run through the same ears -----------------------------------
async function runFile(file) {
  $('loadnote').textContent = `Reading ${file.name}…`;
  const ac = new AudioContext();
  const audio = await ac.decodeAudioData(await file.arrayBuffer());
  ac.close();
  const off = new OfflineAudioContext(1, Math.ceil(audio.duration * SR), SR);
  const src = off.createBufferSource();
  src.buffer = audio;
  src.connect(off.destination);
  src.start();
  const x = (await off.startRendering()).getChannelData(0);
  begin('file');
  S.startedAt = 0;
  for (let at = 0; at < x.length; at += 1600) {
    const samples = x.slice(at, at + 1600);
    store(samples);
    const answered = new Promise((res) => { waitingForWords = res; });
    worker.postMessage({ type: 'audio', samples }, [samples.buffer]);
    await answered;
    if (at % 160000 === 0) $('loadnote').textContent = `Listening to ${file.name}: ${Math.round((100 * at) / x.length)}%`;
  }
  S.stopped = true;
  S.allWords.push(...S.open);
  read(true);
  $('loadnote').textContent = `Listened to ${file.name}.`;
  showSheet();
}

// ---- afterwards: the sheet, and hearing a call again --------------------------
let player = null;
function play(t) {
  const from = Math.max(0, Math.floor((t - 2.5) * SR));
  const to = Math.min(S.captured, Math.floor((t + 2.5) * SR));
  if (to <= from) return;
  const out = new Float32Array(to - from);
  let at = 0;
  for (const chunk of S.pcm) {
    const lo = Math.max(from, at);
    const hi = Math.min(to, at + chunk.length);
    for (let i = lo; i < hi; i++) out[i - from] = chunk[i - at] / 32768;
    at += chunk.length;
    if (at >= to) break;
  }
  player?.close();
  player = new AudioContext();
  const buf = player.createBuffer(1, out.length, SR);
  buf.copyToChannel(out, 0);
  const src = player.createBufferSource();
  src.buffer = buf;
  src.connect(player.destination);
  src.start();
}

function showSheet() {
  const rows = sheet();
  const open = rows.filter((r) => !r.call || !r.call.entry || r.call.how === 'sounds' || (S.timed && timeOf(r).from === 'called'));
  const boats = rows.filter((r) => r.call?.entry).length;
  $('summary').textContent = `${boats} boat${boats === 1 ? '' : 's'} taken · ${open.length} line${open.length === 1 ? '' : 's'} to check${S.gaps.length ? ` · ${S.gaps.length} gap${S.gaps.length === 1 ? '' : 's'} in listening` : ''}`;
  $('tosettle').innerHTML = open.map((r) => {
    const l = label(r);
    const c = r.call;
    let why = '';
    let choices = '';
    if (!c) why = 'Now was pressed, and no boat was called';
    else if (c.how === 'sounds') { why = `heard “${esc(c.words.join(' '))}”`; choices = `<button data-yes="${r.id}">Yes, ${esc(digitsOf(c.entry.sailNumber))}</button>`; }
    else if (c.how === 'ambiguous') { why = `heard “${esc(c.words.join(' '))}”`; choices = c.entries.map((e) => `<button data-pick="${r.id}" data-entry="${e.id}">${esc(e.sailNumber)}</button>`).join(''); }
    else if (!c.entry) why = `heard “${esc(c.words.join(' '))}”, a number on no entry`;
    else { why = 'no “now” was heard: the time is when she was called'; choices = `<button data-keep="${r.id}">Keep ${esc(clockOf(timeOf(r).t))}</button>`; }
    return `<div class="settle"><div class="top"><button class="play" data-play="${timeOf(r).t}" aria-label="Play this call">▶</button><div class="what"><strong>${esc(l.num)}</strong> ${esc(l.who)}<div class="small muted">${esc(whenText(r))} · ${why}</div></div></div><div class="choices">${choices}</div></div>`;
  }).join('');
  $('order').innerHTML = rows.map((r, i) => {
    const l = label(r);
    return `<tr><td class="n">${i + 1}</td><td>${esc(whenText(r))}</td><td><strong>${esc(l.num)}</strong> ${esc(l.who)}${l.tag ? ` <span class="tag">${l.tag}</span>` : ''}${r.again ? ' <span class="tag">called again</span>' : ''}</td><td class="p"><button class="play" data-play="${timeOf(r).t}" aria-label="Play this call">▶</button></td></tr>`;
  }).join('');
  $('stats').textContent = S.span
    ? `Recognising took ${(S.cpu / 1000 / S.span).toFixed(2)} seconds for each second of sound. Model: ${S.model}.${S.mic ? ` Microphone: ${S.mic}.` : ''}`
    : '';
  $('sheet').hidden = false;
  window.__voice.done = true;
  $('sheet').scrollIntoView({ behavior: 'smooth' });
}

$('sheet').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.play) return play(Number(b.dataset.play) + LAG);
  const row = S.rows.find((r) => String(r.id) === (b.dataset.yes ?? b.dataset.pick ?? b.dataset.keep));
  if (!row) return;
  if (b.dataset.yes) row.call = { ...row.call, how: 'whole' };
  if (b.dataset.pick) row.call = { ...row.call, how: 'whole', entry: S.entries.find((x) => x.id === b.dataset.entry), entries: undefined };
  if (b.dataset.keep) { row.at = timeOf(row).t; row.from = 'kept'; }
  showSheet();
});

function save(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
const stamp = () => new Date(S.mode === 'file' ? Date.now() : S.startedAt).toISOString().slice(0, 19).replace(/[:T]/g, '-');
$('savewav').onclick = () => {
  const head = new DataView(new ArrayBuffer(44));
  const bytes = S.captured * 2;
  const w = (o, s) => [...s].forEach((c, i) => head.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); head.setUint32(4, 36 + bytes, true); w(8, 'WAVEfmt '); head.setUint32(16, 16, true);
  head.setUint16(20, 1, true); head.setUint16(22, 1, true); head.setUint32(24, SR, true); head.setUint32(28, SR * 2, true);
  head.setUint16(32, 2, true); head.setUint16(34, 16, true); w(36, 'data'); head.setUint32(40, bytes, true);
  save(`finishes-${stamp()}.wav`, new Blob([head, ...S.pcm], { type: 'audio/wav' }));
};
$('savelog').onclick = () => {
  const log = {
    what: 'Sail Scoring voice prototype: a recording’s calls',
    startedAt: S.mode === 'file' ? null : new Date(S.startedAt).toISOString(),
    seconds: S.captured / SR, model: S.model, microphone: S.mic ?? null, timed: S.timed, lagAssumed: LAG,
    userAgent: navigator.userAgent, realTimeFactor: S.span ? S.cpu / 1000 / S.span : null, wordDelay: S.delay,
    entries: S.entries, gaps: S.gaps, words: S.allWords,
    lines: sheet().map((r) => ({ ...describe(r), t: timeOf(r).t, calledAt: r.call ? r.call.t - LAG : null, calledAgainAt: r.again ?? [] })),
    removed: S.rows.filter((r) => r.removed && r.call).map(describe),
  };
  save(`finishes-${stamp()}.json`, new Blob([JSON.stringify(log, null, 1)], { type: 'application/json' }));
};

// ---- controls ----------------------------------------------------------------
$('listen').onclick = listen;
$('pick').onclick = () => $('file').click();
$('file').onchange = (e) => { const f = e.target.files[0]; if (f) runFile(f); e.target.value = ''; };
$('now').onclick = pressNow;
$('undo').onclick = undo;
$('stop').onclick = stop;
$('model').onchange = startWorker;
$('lockbtn').onclick = () => { $('lock').hidden = false; };
let holding = null;
const release = () => { clearTimeout(holding); };
$('lock').addEventListener('pointerdown', () => { holding = setTimeout(() => { $('lock').hidden = true; }, 900); });
$('lock').addEventListener('pointerup', release);
$('lock').addEventListener('pointercancel', release);

$('entries').value = SAMPLE;
fetch('engine/models/index.json').then((r) => r.json()).then((list) => {
  models = list;
  $('model').innerHTML = list.map((x) => `<option value="${esc(x.id)}">${esc(x.label)}</option>`).join('');
  startWorker();
}).catch(() => {
  $('loadnote').textContent = 'The listening engine isn’t here yet. See the README: run fetch-models.sh, and build or copy the engine.';
});
