// The recogniser, off the main thread: 16 kHz audio in, words with times out.
// A classic worker, because the engine's glue script expects a global Module.

/* global importScripts, createOnlineRecognizer */

let recognizer = null;
let stream = null;
let fed = 0; // samples given to the recogniser since Listen
let segmentStart = 0; // seconds: where the recogniser's own clock last restarted
const SR = 16000;

self.Module = {
  locateFile: (path) => `engine/${path}`,
  print: () => {},
  printErr: () => {},
  onRuntimeInitialized: () => self.postMessage({ type: 'engine' }),
};
importScripts('engine/sherpa-onnx-wasm-main-asr.js', 'engine/sherpa-onnx-asr.js');

async function fetchInto(url, path, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onProgress(got, total);
  }
  const bytes = new Uint8Array(got);
  let at = 0;
  for (const p of parts) { bytes.set(p, at); at += p.length; }
  self.Module.FS.writeFile(path, bytes);
}

async function load(model) {
  const files = ['encoder.onnx', 'decoder.onnx', 'joiner.onnx', 'tokens.txt'];
  const sizes = new Map();
  for (const f of files) {
    await fetchInto(`${model.base}/${f}`, `/${f}`, (got, total) => {
      sizes.set(f, [got, total]);
      const done = [...sizes.values()].reduce((a, [g]) => a + g, 0);
      self.postMessage({ type: 'progress', bytes: done, file: f });
    });
  }
  recognizer = createOnlineRecognizer(self.Module, {
    featConfig: { sampleRate: SR, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: './encoder.onnx', decoder: './decoder.onnx', joiner: './joiner.onnx' },
      paraformer: { encoder: '', decoder: '' },
      zipformer2Ctc: { model: '' },
      nemoCtc: { model: '' },
      toneCtc: { model: '' },
      tokens: './tokens.txt',
      numThreads: 1,
      provider: 'cpu',
      debug: 0,
      modelType: '',
      modelingUnit: 'cjkchar',
      bpeVocab: '',
    },
    decodingMethod: 'greedy_search',
    maxActivePaths: 4,
    enableEndpoint: 1,
    rule1MinTrailingSilence: 2.0,
    rule2MinTrailingSilence: 0.9,
    rule3MinUtteranceLength: 30,
    hotwordsFile: '',
    hotwordsScore: 1.5,
    ctcFstDecoderConfig: { graph: '', maxActive: 3000 },
    ruleFsts: '',
    ruleFars: '',
  });
  // The engine has its own copy now: free the files' memory.
  for (const f of files) self.Module.FS.unlink(`/${f}`);
  begin();
  self.postMessage({ type: 'ready' });
}

function begin() {
  if (stream) stream.free();
  stream = recognizer.createStream();
  fed = 0;
  segmentStart = 0;
}

/** Word pieces with times -> words with times, on the recording's own clock. */
function wordsOf(tokens, times) {
  const words = [];
  tokens.forEach((tok, i) => {
    if (/^[▁ ]/.test(tok) || words.length === 0) words.push({ w: tok.replace(/^[▁ ]/, ''), t: segmentStart + times[i] });
    else words[words.length - 1].w += tok;
  });
  return words.filter((x) => x.w);
}

function accept(samples) {
  const t0 = performance.now();
  stream.acceptWaveform(SR, samples);
  fed += samples.length;
  while (recognizer.isReady(stream)) recognizer.decode(stream);
  const r = recognizer.getResult(stream);
  const words = r.tokens && r.tokens.length ? wordsOf(r.tokens, r.timestamps) : [];
  // `closed` says the recogniser has finished with these words: the next
  // message starts a new list.
  const closed = recognizer.isEndpoint(stream);
  if (closed) {
    recognizer.reset(stream);
    segmentStart = fed / SR;
  }
  self.postMessage({ type: 'words', words, closed, heard: fed / SR, cost: performance.now() - t0, span: samples.length / SR });
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'load') load(m.model).catch((err) => self.postMessage({ type: 'error', message: String(err.message || err) }));
  else if (m.type === 'begin') begin();
  else if (m.type === 'audio') accept(m.samples);
  else if (m.type === 'skip') {
    // The microphone was away for this long: move the clock on, hear nothing.
    recognizer.reset(stream);
    fed += m.samples;
    segmentStart = fed / SR;
  }
};
