/**
 * Put the listening engine for recording finishes by voice (ADR-017) where
 * the app serves it from: sherpa-onnx's streaming recogniser built as
 * WebAssembly, and the model it runs. About 85 MB, so neither is committed.
 *
 * Run: pnpm voice:sync            (also run automatically by `prebuild`)
 *      pnpm voice:sync --from <dir> [--pin]
 *
 * The pinned release lives in lib/voice/engine-release.json: its version,
 * the model, where the files are published (`source`), and each file's size
 * and SHA-256. The files land in public/voice/engine/<version>/, gitignored,
 * beside a manifest.json the page reads to know what to download.
 *
 * Idempotent: a file already there at the pinned size is left alone, so
 * repeat builds are fast and need no network.
 *
 * `--from <dir>` copies from a local build instead of fetching: the layout
 * `prototypes/voice/build-engine.sh` and `fetch-models.sh` leave in
 * `prototypes/voice/engine/`. With `--pin` the pin file is rewritten to
 * match what was copied, which is how a new build becomes the pinned one
 * before its files are published.
 *
 * While the pin names no `source` and there is no local copy, this prints a
 * notice and succeeds: the app builds, and the voice setup says the engine
 * isn't available on this server.
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

interface PinnedFile {
  /** Where the file sits under the version's directory. */
  path: string;
  bytes: number;
  sha256: string;
}

interface Pin {
  version: string;
  model: string;
  /** The base URL the files are published under, each as its `path` with
   *  `/` written `-`; null until they are published. */
  source: string | null;
  files: PinnedFile[];
}

const ROOT = join(__dirname, '..');
const PIN_FILE = join(ROOT, 'lib', 'voice', 'engine-release.json');
const PUBLIC_DIR = join(ROOT, 'public', 'voice', 'engine');

/** Each file, and where a local build keeps it. */
const LOCAL_LAYOUT = (model: string): Record<string, string> => ({
  'sherpa-onnx-wasm-main-asr.js': 'sherpa-onnx-wasm-main-asr.js',
  'sherpa-onnx-wasm-main-asr.wasm': 'sherpa-onnx-wasm-main-asr.wasm',
  'sherpa-onnx-asr.js': 'sherpa-onnx-asr.js',
  'model/encoder.onnx': `models/${model}/encoder.onnx`,
  'model/decoder.onnx': `models/${model}/decoder.onnx`,
  'model/joiner.onnx': `models/${model}/joiner.onnx`,
  'model/tokens.txt': `models/${model}/tokens.txt`,
});

const FETCH_ATTEMPTS = 3;

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

async function fetchTo(url: string, target: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    if (attempt > 1) await setTimeout(1000 * 2 ** (attempt - 2));
    try {
      const res = await fetch(url);
      if (res.ok) {
        writeFileSync(target, new Uint8Array(await res.arrayBuffer()));
        return;
      }
      lastError = new Error(`${res.status} ${res.statusText}`);
      if (res.status < 500 && res.status !== 408 && res.status !== 429) break;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function writeManifest(pin: Pin): void {
  const manifest = {
    version: pin.version,
    model: pin.model,
    bytes: pin.files.reduce((n, f) => n + f.bytes, 0),
    files: pin.files.map((f) => ({ path: `${pin.version}/${f.path}`, bytes: f.bytes })),
  };
  writeFileSync(join(PUBLIC_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

async function main() {
  const args = process.argv.slice(2);
  const fromAt = args.indexOf('--from');
  const from = fromAt >= 0 ? args[fromAt + 1] : undefined;
  const repin = args.includes('--pin');
  if (fromAt >= 0 && !from) throw new Error('--from needs a directory.');
  if (repin && !from) throw new Error('--pin only makes sense with --from <dir>.');

  const pin = JSON.parse(readFileSync(PIN_FILE, 'utf8')) as Pin;
  const target = join(PUBLIC_DIR, pin.version);

  if (from) {
    const layout = LOCAL_LAYOUT(pin.model);
    const files: PinnedFile[] = [];
    for (const [path, local] of Object.entries(layout)) {
      const source = join(from, local);
      if (!existsSync(source)) throw new Error(`${source} is missing. Build the engine and fetch the model first: see prototypes/voice/README.md.`);
      const out = join(target, path);
      mkdirSync(dirname(out), { recursive: true });
      copyFileSync(source, out);
      files.push({ path, bytes: statSync(out).size, sha256: sha256(out) });
    }
    if (repin) {
      const next: Pin = { ...pin, files };
      writeFileSync(PIN_FILE, JSON.stringify(next, null, 2) + '\n');
      writeManifest(next);
      console.log(`Pinned the engine in ${from} as version ${pin.version}: ${files.length} files.`);
      return;
    }
    for (const f of files) {
      const pinned = pin.files.find((p) => p.path === f.path);
      if (!pinned || pinned.sha256 !== f.sha256) {
        throw new Error(`${f.path} in ${from} is not the pinned file. Pass --pin to pin this build instead.`);
      }
    }
    writeManifest(pin);
    console.log(`Copied the voice engine (version ${pin.version}) from ${from}.`);
    return;
  }

  const missing = pin.files.filter((f) => {
    const file = join(target, f.path);
    return !existsSync(file) || statSync(file).size !== f.bytes;
  });
  if (missing.length === 0 && pin.files.length > 0) {
    writeManifest(pin);
    console.log(`Voice engine already at version ${pin.version}; nothing to do.`);
    return;
  }
  if (!pin.source || pin.files.length === 0) {
    console.log(
      'The voice engine is not published yet and there is no local copy: skipping.\n' +
        'Finishes by voice will say the engine isn’t available. For a local copy:\n' +
        '  pnpm voice:sync --from <path to prototypes/voice/engine>',
    );
    return;
  }
  for (const f of missing) {
    const out = join(target, f.path);
    mkdirSync(dirname(out), { recursive: true });
    const url = `${pin.source.replace(/\/$/, '')}/${f.path.replace(/\//g, '-')}`;
    console.log(`Fetching ${url} (${(f.bytes / 1048576).toFixed(1)} MB)…`);
    await fetchTo(url, out);
    if (sha256(out) !== f.sha256) throw new Error(`${url} is not the pinned file: its SHA-256 differs.`);
  }
  writeManifest(pin);
  console.log(`Fetched the voice engine, version ${pin.version}: ${missing.length} files.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
