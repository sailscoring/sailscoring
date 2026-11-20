/**
 * The listening engine on the phone: finding out whether this server has
 * one, downloading it once, and running it in a worker. The engine's only
 * job is words with times (`HeardBatch`); what they mean is `session.ts`.
 *
 * The engine is a release of the voice-engine repo, put beside the app by
 * `pnpm voice:sync`, which also writes the manifest read here. Its worker
 * speaks that repo's PROTOCOL.md, protocol 1, and nothing here depends on
 * which recogniser is behind it.
 *
 * The engine and its model are kept in Cache Storage under their own name,
 * which the worker reads the model from and the service worker serves the
 * engine from, so listening starts with no signal once they are there.
 */

import type { HeardBatch } from '../session';

/** What `pnpm voice:sync` writes to /voice/engine/manifest.json. */
export interface EngineManifest {
  /** The release: its files are under /voice/engine/<version>/. */
  version: string;
  model: string;
  /** The worker script, under /voice/engine/. */
  worker: string;
  /** How long after a word is said the model gives its time. */
  lagSeconds: number;
  /** The model's entry in the release's manifest, handed to the worker. */
  entry: unknown;
  /** The size of the whole download. */
  bytes: number;
  /** What a phone downloads, under /voice/engine/. */
  files: { path: string; bytes: number }[];
}

const BASE = '/voice/engine/';
/** Shared with public/voice/sw.js, and named to the worker in `init`. */
export const ENGINE_CACHE = 'voice-engine-v1';

export type WordsBatch = HeardBatch & {
  /** Milliseconds the recogniser spent on this much sound, and how much. */
  cost: number;
  span: number;
};

/** Something that turns sound into words. The real one is the worker; a
 *  test supplies its own. */
export interface Listener {
  /** How long after a word is said its time lands; a test's stand-in may
   *  leave it to the session's default. */
  readonly lagSeconds?: number;
  /** A new take: the clock of the words that follow starts again. */
  begin(): void;
  /** Sound at 16 kHz. The buffer is handed over, not copied. */
  feed(samples: Float32Array): void;
  /** Words for the current take. Set by whoever is listening. */
  onWords: ((batch: WordsBatch) => void) | null;
  onError: ((message: string) => void) | null;
  close(): void;
}

/** A test's stand-in for the engine: set on `window` before the page runs. */
type ListenerOverride = () => Listener;
const override = (): ListenerOverride | undefined =>
  (globalThis as { __sailscoringVoiceListener?: ListenerOverride }).__sailscoringVoiceListener;

/** The engine this server offers, or null where it has none. */
export async function readManifest(): Promise<EngineManifest | null> {
  if (override()) return { version: 'test', model: 'test', worker: '', lagSeconds: 0.5, entry: null, bytes: 0, files: [] };
  try {
    const res = await fetch(`${BASE}manifest.json`, { cache: 'no-cache' });
    if (!res.ok) return null;
    const manifest = (await res.json()) as EngineManifest;
    return Array.isArray(manifest.files) && manifest.files.length > 0 && typeof manifest.worker === 'string' ? manifest : null;
  } catch {
    return null;
  }
}

const urlOf = (path: string) => `${BASE}${path}`;

async function openCache(): Promise<Cache | null> {
  try {
    return await caches.open(ENGINE_CACHE);
  } catch {
    return null;
  }
}

/** Whether every file of the engine is already on this phone. */
export async function isDownloaded(manifest: EngineManifest): Promise<boolean> {
  if (manifest.files.length === 0) return true;
  const cache = await openCache();
  if (!cache) return false;
  const hits = await Promise.all(manifest.files.map((f) => cache.match(urlOf(f.path))));
  return hits.every(Boolean);
}

/**
 * Download whatever of the engine isn't on this phone yet, saying how far it
 * has got. Asks the browser to keep the phone's copy, which it otherwise may
 * clear when storage runs short.
 */
export async function download(manifest: EngineManifest, onProgress: (got: number, total: number) => void): Promise<void> {
  const cache = await openCache();
  if (!cache) throw new Error('This browser can’t keep the download.');
  void navigator.storage?.persist?.().catch(() => false);
  let got = 0;
  for (const file of manifest.files) {
    const url = urlOf(file.path);
    if (await cache.match(url)) {
      got += file.bytes;
      onProgress(got, manifest.bytes);
      continue;
    }
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`The download failed (${res.status}).`);
    const reader = res.body.getReader();
    const parts: BlobPart[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      onProgress(Math.min(got, manifest.bytes), manifest.bytes);
    }
    const type = res.headers.get('content-type') ?? 'application/octet-stream';
    await cache.put(url, new Response(new Blob(parts, { type }), { headers: { 'content-type': type } }));
  }
  // Older versions' files are no use to anyone now.
  const keep = new Set(manifest.files.map((f) => new URL(urlOf(f.path), location.origin).href));
  for (const request of await cache.keys()) {
    if (!keep.has(request.url)) await cache.delete(request);
  }
}

/** Start the engine in its worker. Resolves once it can take sound. */
function startWorker(manifest: EngineManifest): Promise<Listener> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(urlOf(manifest.worker));
    let take = 0;
    let ready = false;
    const listener: Listener = {
      lagSeconds: manifest.lagSeconds,
      onWords: null,
      onError: null,
      begin() {
        take += 1;
        worker.postMessage({ type: 'begin', take });
      },
      feed(samples) {
        worker.postMessage({ type: 'audio', samples }, [samples.buffer]);
      },
      close() {
        worker.terminate();
      },
    };
    const failed = (message: string) => {
      if (ready) listener.onError?.(message);
      else {
        worker.terminate();
        reject(new Error(message));
      }
    };
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data as
        | { type: 'ready' }
        | { type: 'error'; message: string }
        | ({ type: 'words'; take: number } & WordsBatch);
      if (m.type === 'ready') {
        ready = true;
        resolve(listener);
      } else if (m.type === 'error') failed(m.message);
      // Words still arriving from a take that has ended are that take's.
      else if (m.type === 'words' && m.take === take) listener.onWords?.(m);
    };
    worker.onerror = (e) => failed(e.message || 'The listening engine stopped.');
    worker.postMessage({ type: 'init', base: urlOf(`${manifest.version}/`), model: manifest.entry, cache: ENGINE_CACHE });
  });
}

let running: { version: string; listener: Promise<Listener> } | null = null;

/**
 * The engine, started once and kept: the setup dialog starts it for its
 * trial call, and Listen carries on with the same one.
 */
export function getListener(manifest: EngineManifest): Promise<Listener> {
  if (running?.version === manifest.version) return running.listener;
  const make = override();
  const listener = make ? Promise.resolve(make()) : startWorker(manifest);
  running = { version: manifest.version, listener };
  listener.catch(() => {
    if (running?.listener === listener) running = null;
  });
  return listener;
}

/** Megabytes, for the download's line in the setup dialog. */
export const megabytes = (bytes: number) => Math.round(bytes / 1048576);
