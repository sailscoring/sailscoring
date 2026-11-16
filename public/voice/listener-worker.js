// The recogniser for recording finishes by voice, off the main thread:
// 16 kHz sound in, words with times out. A classic worker, because the
// engine's glue script expects a global Module.
//
// Messages in:  init { base }          where the engine's files are
//               load                   fetch the model and get ready
//               begin { take }         a new take: start the clock again
//               audio { samples }      sound, as Float32Array
// Messages out: engine | ready | error { message }
//               words { take, words: [{ w, t }], closed, heard, cost, span }
//
// The times are seconds since the take began. Nothing here knows about
// boats: reading the words is lib/voice/calls.ts.

/* global importScripts, createOnlineRecognizer */

const SR = 16000;
// The same cache the page fills when it downloads the engine, and the
// service worker serves from: see lib/voice/client/engine.ts.
const CACHE = 'voice-engine-v1';

let base = '';
let recognizer = null;
let stream = null;
let take = 0;
let fed = 0; // samples given to the recogniser since the take began
let segmentStart = 0; // seconds: where the recogniser's own clock last restarted

async function bytesOf(url) {
  let res;
  try {
    const cache = await caches.open(CACHE);
    res = await cache.match(url);
  } catch {
    // No cache storage here: the network will do.
  }
  if (!res) res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function load() {
  const files = ['encoder.onnx', 'decoder.onnx', 'joiner.onnx', 'tokens.txt'];
  for (const f of files) {
    self.Module.FS.writeFile(`/${f}`, await bytesOf(`${base}model/${f}`));
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
  begin(0);
  self.postMessage({ type: 'ready' });
}

function begin(nextTake) {
  if (stream) stream.free();
  stream = recognizer.createStream();
  take = nextTake;
  fed = 0;
  segmentStart = 0;
}

/** Word pieces with times to words with times, on the take's clock. */
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
  self.postMessage({ type: 'words', take, words, closed, heard: fed / SR, cost: performance.now() - t0, span: samples.length / SR });
}

const fail = (err) => self.postMessage({ type: 'error', message: String((err && err.message) || err) });

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      base = m.base;
      self.Module = {
        locateFile: (path) => base + path,
        print: () => {},
        printErr: () => {},
        onRuntimeInitialized: () => self.postMessage({ type: 'engine' }),
      };
      importScripts(`${base}sherpa-onnx-wasm-main-asr.js`, `${base}sherpa-onnx-asr.js`);
    } else if (m.type === 'load') load().catch(fail);
    else if (m.type === 'begin') begin(m.take);
    else if (m.type === 'audio') accept(m.samples);
  } catch (err) {
    fail(err);
  }
};
