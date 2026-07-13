/**
 * `pnpm blw-scrub <file…>` — strip PII (DOB / email / phone and cousins)
 * from Sailwave `.blw` files in place, before they're committed to an
 * archive repo (ADR-010, #283). Age stays: it's part of the published
 * results. Reports what was removed per file.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { scrubBlwBytes } from '@/lib/archive-kit/blw-scrub';

function run(paths: string[]): number {
  if (paths.length === 0) {
    console.error('usage: pnpm blw-scrub <file.blw…>  (rewrites in place)');
    return 1;
  }
  for (const path of paths) {
    const bytes = readFileSync(path);
    const { text, removed } = scrubBlwBytes(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    writeFileSync(path, text);
    const entries = Object.entries(removed);
    if (entries.length === 0) {
      console.log(`${path}: clean (nothing removed)`);
    } else {
      const summary = entries.map(([k, n]) => `${k}×${n}`).join(', ');
      console.log(`${path}: removed ${summary}`);
    }
  }
  return 0;
}

process.exit(run(process.argv.slice(2)));
