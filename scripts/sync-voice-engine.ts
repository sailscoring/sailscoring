/**
 * Put the listening engine for recording finishes by voice (ADR-017) where
 * the app serves it from: a release of github.com/sailscoring/voice-engine,
 * the recogniser built as WebAssembly with its worker and model. About 85 MB,
 * so none of it is committed.
 *
 * Run: pnpm voice:sync                         (also run automatically by `prebuild`)
 *      pnpm voice:sync --from <release dir> [--pin]
 *
 * The pin is lib/voice/engine-release.json: the release, the model the app
 * uses from it, where the release is published (`source`), and the SHA-256
 * of its manifest.json. That manifest lists every file with its size and
 * SHA-256, so checking the one checksum checks them all. The files land in
 * public/voice/engine/<release>/, gitignored, beside a manifest.json of the
 * app's own (/voice/engine/manifest.json) that the page reads to know what
 * to download and which worker to start.
 *
 * Idempotent: a file already there at its size is left alone, so repeat
 * builds are fast and need no network.
 *
 * `--from <dir>` copies a release from a voice-engine checkout instead of
 * fetching it: `dist/<release>/`, which its scripts/assemble.mjs writes.
 * That is how a build is tried before it is published. The pin is left
 * alone, unless `--pin` rewrites it to name that release (with `source`
 * null until it is published); a later plain run with a different release
 * pinned leaves the copy where it is if it can't fetch the pinned one.
 *
 * While the pin names no `source` and there is no local copy, this prints a
 * notice and succeeds: the app builds, and the voice setup says the engine
 * isn't available on this server.
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

/** The worker messages the app speaks: voice-engine's PROTOCOL.md. */
const PROTOCOL = 1;

interface Pin {
  release: string | null;
  model: string;
  /** Where the release's files are published, ending in `/`; null until
   *  they are. */
  source: string | null;
  manifestSha256: string | null;
}

interface ReleaseFile {
  path: string;
  /** Its name among the published files. */
  asset: string;
  bytes: number;
  sha256: string;
}

interface ReleaseManifest {
  protocol: number;
  release: string;
  /** Carries a model no release may: for the bench and trials, never the app. */
  trialsOnly?: boolean;
  runtimes: Record<string, { worker: string; files: ReleaseFile[] }>;
  models: { id: string; runtime: string; lagSeconds: number; files: (ReleaseFile & { role: string })[] }[];
  notices: ReleaseFile[];
}

const ROOT = join(__dirname, '..');
const PIN_FILE = join(ROOT, 'lib', 'voice', 'engine-release.json');
const PUBLIC_DIR = join(ROOT, 'public', 'voice', 'engine');

const FETCH_ATTEMPTS = 3;

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function fetchBytes(url: string): Promise<Uint8Array> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    if (attempt > 1) await setTimeout(1000 * 2 ** (attempt - 2));
    try {
      const res = await fetch(url);
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
      lastError = new Error(`${res.status} ${res.statusText}`);
      if (res.status < 500 && res.status !== 408 && res.status !== 429) break;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function readManifest(bytes: Uint8Array, pin: Pin, where: string): ReleaseManifest {
  const manifest = JSON.parse(Buffer.from(bytes).toString('utf8')) as ReleaseManifest;
  if (manifest.trialsOnly) {
    throw new Error(`${where} is for trials only: it carries a model a release may not, so the app won't serve it.`);
  }
  if (manifest.protocol !== PROTOCOL) {
    throw new Error(`${where} speaks protocol ${manifest.protocol}; the app speaks ${PROTOCOL}.`);
  }
  if (!manifest.models.some((m) => m.id === pin.model)) {
    throw new Error(`${where} has no model ${pin.model}: it has ${manifest.models.map((m) => m.id).join(', ')}.`);
  }
  return manifest;
}

/** What the app serves from a release: its model, that model's runtime,
 *  and the licences. */
function wanted(manifest: ReleaseManifest, modelId: string) {
  const model = manifest.models.find((m) => m.id === modelId)!;
  const runtime = manifest.runtimes[model.runtime];
  if (!runtime) throw new Error(`release ${manifest.release} has no runtime ${model.runtime}`);
  return { model, runtime, phone: [...runtime.files, ...model.files], all: [...runtime.files, ...model.files, ...manifest.notices] };
}

/** The manifest the page reads: /voice/engine/manifest.json. */
function writeServedManifest(manifest: ReleaseManifest, modelId: string): void {
  const { model, runtime, phone } = wanted(manifest, modelId);
  const at = (path: string) => `${manifest.release}/${path}`;
  const served = {
    version: manifest.release,
    model: model.id,
    worker: at(runtime.worker),
    lagSeconds: model.lagSeconds,
    entry: model,
    bytes: phone.reduce((n, f) => n + f.bytes, 0),
    files: phone.map((f) => ({ path: at(f.path), bytes: f.bytes })),
  };
  writeFileSync(join(PUBLIC_DIR, 'manifest.json'), JSON.stringify(served, null, 2) + '\n');
  // Another release's files are no use now.
  for (const name of readdirSync(PUBLIC_DIR)) {
    if (name !== manifest.release && name !== 'manifest.json') rmSync(join(PUBLIC_DIR, name), { recursive: true, force: true });
  }
}

function place(manifest: ReleaseManifest, f: ReleaseFile, bytes: Uint8Array, from: string): void {
  if (bytes.length !== f.bytes || sha256(bytes) !== f.sha256) {
    throw new Error(`${from} is not the file release ${manifest.release}'s manifest lists: its size or SHA-256 differs.`);
  }
  const out = join(PUBLIC_DIR, manifest.release, f.path);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bytes);
}

const present = (release: string, f: ReleaseFile) => {
  const file = join(PUBLIC_DIR, release, f.path);
  return existsSync(file) && statSync(file).size === f.bytes;
};

async function main() {
  const args = process.argv.slice(2);
  const fromAt = args.indexOf('--from');
  const from = fromAt >= 0 ? args[fromAt + 1] : undefined;
  const repin = args.includes('--pin');
  if (fromAt >= 0 && !from) throw new Error('--from needs a directory.');
  if (repin && !from) throw new Error('--pin only makes sense with --from <dir>.');

  const pin = JSON.parse(readFileSync(PIN_FILE, 'utf8')) as Pin;
  mkdirSync(PUBLIC_DIR, { recursive: true });

  if (from) {
    const manifestFile = join(from, 'manifest.json');
    if (!existsSync(manifestFile)) {
      throw new Error(`${manifestFile} is missing. Assemble a release in voice-engine first: see its README.`);
    }
    const bytes = new Uint8Array(readFileSync(manifestFile));
    const manifest = readManifest(bytes, pin, manifestFile);
    if (repin) {
      const next: Pin = { ...pin, release: manifest.release, source: null, manifestSha256: sha256(bytes) };
      writeFileSync(PIN_FILE, JSON.stringify(next, null, 2) + '\n');
    } else if (manifest.release === pin.release && sha256(bytes) !== pin.manifestSha256) {
      throw new Error(`${from} is a different build of the pinned release ${pin.release}. Pass --pin to pin it instead.`);
    }
    for (const f of wanted(manifest, pin.model).all) {
      place(manifest, f, new Uint8Array(readFileSync(join(from, f.path))), join(from, f.path));
    }
    writeFileSync(join(PUBLIC_DIR, manifest.release, 'manifest.json'), bytes);
    writeServedManifest(manifest, pin.model);
    console.log(`Copied voice engine release ${manifest.release} (${pin.model}) from ${from}${repin ? ', and pinned it' : ''}.`);
    return;
  }

  if (!pin.release || !pin.manifestSha256) {
    console.log('No voice engine release is pinned: skipping. Finishes by voice will say the engine isn’t available.');
    return;
  }

  // Already here from an earlier run: check the manifest, then only sizes.
  const keptManifest = join(PUBLIC_DIR, pin.release, 'manifest.json');
  if (existsSync(keptManifest)) {
    const bytes = new Uint8Array(readFileSync(keptManifest));
    if (sha256(bytes) === pin.manifestSha256) {
      const manifest = readManifest(bytes, pin, keptManifest);
      if (wanted(manifest, pin.model).all.every((f) => present(pin.release!, f))) {
        writeServedManifest(manifest, pin.model);
        console.log(`Voice engine already at release ${pin.release}; nothing to do.`);
        return;
      }
    }
  }

  if (!pin.source) {
    console.log(
      `Voice engine release ${pin.release} is not published and there is no local copy: skipping.\n` +
        'Finishes by voice will say the engine isn’t available. For a local copy:\n' +
        '  pnpm voice:sync --from <voice-engine checkout>/dist/<release>',
    );
    return;
  }

  const base = pin.source.endsWith('/') ? pin.source : `${pin.source}/`;
  const bytes = await fetchBytes(`${base}manifest.json`);
  if (sha256(bytes) !== pin.manifestSha256) {
    throw new Error(`${base}manifest.json is not the pinned manifest: its SHA-256 differs.`);
  }
  const manifest = readManifest(bytes, pin, `${base}manifest.json`);
  let fetched = 0;
  for (const f of wanted(manifest, pin.model).all) {
    if (present(manifest.release, f)) continue;
    console.log(`Fetching ${f.asset} (${(f.bytes / 1048576).toFixed(1)} MB)…`);
    place(manifest, f, await fetchBytes(base + f.asset), base + f.asset);
    fetched++;
  }
  writeFileSync(keptManifest, bytes);
  writeServedManifest(manifest, pin.model);
  console.log(`Fetched voice engine release ${manifest.release} (${pin.model}): ${fetched} files.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
