/**
 * Sync the national-letters dataset into lib/nationality/generated/.
 *
 * Run: pnpm nationality:sync
 *
 * The pinned dataset version lives in lib/nationality/dataset-version.txt.
 * Bump it, run this script, and commit the regenerated codes.ts + flags.ts.
 * Generated files are committed so production builds never reach out to
 * GitHub at build time.
 *
 * Trust model: every flag SVG byte is sha256-verified against the value
 * carried in codes.json (which itself comes from the same release). The
 * dataset's own CI pre-optimises with SVGO, so we don't re-run SVGO here.
 *
 * Byte budget: a flag is only ever drawn into a 20×13 px box, but a few are
 * coat-of-arms line art running to 30–150 KB of paths. Any flag whose markup
 * exceeds RASTER_THRESHOLD_BYTES is rasterized to a small WebP data URI
 * instead (at most ~2 KB base64); the rest stay vector. The vector art is
 * always recoverable from the pinned release, so a future large-format need
 * is a re-sync with a different threshold, not a data loss.
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import { extract } from 'tar';
import type { NationalFlag, NationalFlagVector } from '../lib/nationality/types';

const NATIONALITY_DIR = join(__dirname, '..', 'lib', 'nationality');
const VERSION_FILE = join(NATIONALITY_DIR, 'dataset-version.txt');
const GENERATED_DIR = join(NATIONALITY_DIR, 'generated');

/** Flags whose inner markup is longer than this are shipped as a raster.
 *  The worst-case raster is ~2 KB of base64, so below that the vector is
 *  both smaller and resolution-independent. */
const RASTER_THRESHOLD_BYTES = 2048;
/** Raster width in px: 4× the 20 px box, which covers 3× DPR screens and
 *  300 dpi print. Height follows the viewBox aspect ratio. */
const RASTER_WIDTH_PX = 80;
const WEBP_QUALITY = 80;

interface CodesFile {
  schemaVersion: string;
  generatedAt: string;
  codes: CodeEntry[];
}

interface CodeEntry {
  code: string;
  name: string;
  category: string;
  presentIn: string[];
  names: Record<string, string>;
  flag: { file: string; sha256: string };
  iso3166Alpha2: string | null;
  iso3166Alpha3: string | null;
}

interface AliasesFile {
  schemaVersion: string;
  aliases: Record<string, { canonical: string; note?: string; source?: string }>;
}

const SVG_OUTER = /^<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/;
const VIEWBOX_ATTR = /\bviewBox\s*=\s*"([^"]+)"/;

function parseSvg(code: string, raw: string): NationalFlagVector {
  const match = SVG_OUTER.exec(raw.trim());
  if (!match) {
    throw new Error(`flag SVG for ${code} does not match <svg>…</svg> shape`);
  }
  const viewBoxMatch = VIEWBOX_ATTR.exec(match[1]);
  if (!viewBoxMatch) {
    throw new Error(`flag SVG for ${code} is missing a viewBox attribute`);
  }
  return { viewBox: viewBoxMatch[1], inner: match[2] };
}

/** Render the vector flag to a WebP data URI RASTER_WIDTH_PX wide. The SVG
 *  is re-wrapped with explicit pixel dimensions so librsvg rasterizes at
 *  the target size rather than at the viewBox's nominal size. */
async function rasterize(code: string, flag: NationalFlagVector): Promise<NationalFlag> {
  const parts = flag.viewBox.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n)) || parts[2] <= 0 || parts[3] <= 0) {
    throw new Error(`flag SVG for ${code} has an unusable viewBox ${JSON.stringify(flag.viewBox)}`);
  }
  const height = Math.max(1, Math.round((RASTER_WIDTH_PX * parts[3]) / parts[2]));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `viewBox="${flag.viewBox}" width="${RASTER_WIDTH_PX}" height="${height}">${flag.inner}</svg>`;
  const { data, info } = await sharp(Buffer.from(svg))
    .webp({ quality: WEBP_QUALITY })
    .toBuffer({ resolveWithObject: true });
  return {
    viewBox: `0 0 ${info.width} ${info.height}`,
    raster: {
      src: `data:image/webp;base64,${data.toString('base64')}`,
      width: info.width,
      height: info.height,
    },
  };
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

async function fetchAsset(version: string, asset: string): Promise<Buffer> {
  const url = `https://github.com/sailscoring/national-letters/releases/download/${version}/${asset}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function extractTarball(tarball: Buffer): Promise<Map<string, Buffer>> {
  const dir = mkdtempSync(join(tmpdir(), 'national-letters-'));
  try {
    await pipeline(
      Readable.from(tarball),
      extract({ cwd: dir, gzip: true }),
    );
    const flagsDir = join(dir, 'flags');
    const entries = await readdir(flagsDir);
    const out = new Map<string, Buffer>();
    for (const name of entries) {
      if (!name.endsWith('.svg')) continue;
      out.set(`flags/${name}`, await readFile(join(flagsDir, name)));
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function jsonStringEscape(s: string): string {
  return JSON.stringify(s);
}

function renderCodesModule(version: string, codes: CodeEntry[], aliases: AliasesFile['aliases']): string {
  const lines: string[] = [];
  lines.push('// AUTOGENERATED by scripts/sync-national-letters.ts — do not edit by hand.');
  lines.push(`// Source: github.com/sailscoring/national-letters @ ${version}`);
  lines.push('');
  lines.push("import type { NationalCode, NationalAlias } from '../types';");
  lines.push('');
  lines.push(`export const DATASET_VERSION = ${jsonStringEscape(version)};`);
  lines.push('');
  lines.push('export const NATIONAL_CODES: readonly NationalCode[] = [');
  for (const c of codes) {
    const parts = [
      `code: ${jsonStringEscape(c.code)}`,
      `name: ${jsonStringEscape(c.name)}`,
      `iso3166Alpha2: ${c.iso3166Alpha2 == null ? 'null' : jsonStringEscape(c.iso3166Alpha2)}`,
      `iso3166Alpha3: ${c.iso3166Alpha3 == null ? 'null' : jsonStringEscape(c.iso3166Alpha3)}`,
    ];
    lines.push(`  { ${parts.join(', ')} },`);
  }
  lines.push('];');
  lines.push('');
  lines.push('export const NATIONAL_ALIASES: Readonly<Record<string, NationalAlias>> = {');
  for (const [from, { canonical, note }] of Object.entries(aliases)) {
    const parts = [
      `canonical: ${jsonStringEscape(canonical)}`,
      ...(note ? [`note: ${jsonStringEscape(note)}`] : []),
    ];
    lines.push(`  ${jsonStringEscape(from)}: { ${parts.join(', ')} },`);
  }
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

function renderFlagsModule(version: string, codes: CodeEntry[], flags: Map<string, NationalFlag>): string {
  const lines: string[] = [];
  lines.push('// AUTOGENERATED by scripts/sync-national-letters.ts — do not edit by hand.');
  lines.push(`// Source: github.com/sailscoring/national-letters @ ${version}`);
  lines.push('//');
  lines.push('// This module embeds every flag inline: vector markup for the small ones,');
  lines.push(`// an ${RASTER_WIDTH_PX} px WebP data URI for those over ${RASTER_THRESHOLD_BYTES} bytes of markup.`);
  lines.push('// Importing it pulls the full dataset into the bundle — keep this');
  lines.push('// server-only or behind dynamic imports.');
  lines.push('');
  lines.push("import type { NationalFlag } from '../types';");
  lines.push('');
  lines.push('export const NATIONAL_FLAGS: Readonly<Record<string, NationalFlag>> = {');
  for (const c of codes) {
    const flag = flags.get(c.flag.file);
    if (!flag) throw new Error(`flag missing from tarball for ${c.code}`);
    const body = flag.raster
      ? `raster: { src: ${jsonStringEscape(flag.raster.src)}, width: ${flag.raster.width}, height: ${flag.raster.height} }`
      : `inner: ${jsonStringEscape(flag.inner)}`;
    lines.push(`  ${jsonStringEscape(c.code)}: { viewBox: ${jsonStringEscape(flag.viewBox)}, ${body} },`);
  }
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const version = readFileSync(VERSION_FILE, 'utf8').trim();
  if (!/^v\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`dataset-version.txt must contain a vMAJOR.MINOR.PATCH tag, got ${JSON.stringify(version)}`);
  }
  console.log(`Syncing national-letters ${version}…`);

  const [codesBuf, aliasesBuf, tarballBuf] = await Promise.all([
    fetchAsset(version, 'codes.json'),
    fetchAsset(version, 'aliases.json'),
    fetchAsset(version, 'flags.tar.gz'),
  ]);

  const codes: CodesFile = JSON.parse(codesBuf.toString('utf8'));
  const aliases: AliasesFile = JSON.parse(aliasesBuf.toString('utf8'));

  if (codes.schemaVersion !== '1.0') {
    throw new Error(`unexpected codes.json schemaVersion ${codes.schemaVersion}; expected 1.0`);
  }
  if (aliases.schemaVersion !== '1.0') {
    throw new Error(`unexpected aliases.json schemaVersion ${aliases.schemaVersion}; expected 1.0`);
  }

  const flagBytes = await extractTarball(tarballBuf);

  const flags = new Map<string, NationalFlag>();
  let verified = 0;
  let rasterized = 0;
  for (const c of codes.codes) {
    const bytes = flagBytes.get(c.flag.file);
    if (!bytes) throw new Error(`flag ${c.flag.file} missing from flags.tar.gz`);
    const actual = sha256(bytes);
    if (actual !== c.flag.sha256) {
      throw new Error(
        `sha256 mismatch for ${c.code}: codes.json says ${c.flag.sha256}, tarball has ${actual}`,
      );
    }
    verified += 1;
    const vector = parseSvg(c.code, bytes.toString('utf8'));
    if (Buffer.byteLength(vector.inner) > RASTER_THRESHOLD_BYTES) {
      flags.set(c.flag.file, await rasterize(c.code, vector));
      rasterized += 1;
    } else {
      flags.set(c.flag.file, vector);
    }
  }
  console.log(`Verified ${verified} flag SVGs against codes.json sha256 hashes.`);
  console.log(`Rasterized ${rasterized} flags over ${RASTER_THRESHOLD_BYTES} bytes; ${verified - rasterized} stay vector.`);

  writeFileSync(join(GENERATED_DIR, 'codes.ts'), renderCodesModule(version, codes.codes, aliases.aliases));
  writeFileSync(join(GENERATED_DIR, 'flags.ts'), renderFlagsModule(version, codes.codes, flags));
  console.log(`Wrote ${codes.codes.length} codes + flags to lib/nationality/generated/.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
