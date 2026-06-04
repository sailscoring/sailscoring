/**
 * Refresh the frozen HalSail result fragments under
 * `reference/data/2026-dbsc-summer-series/halsail/` — step 1 of the weekly
 * parity loop (see that dir's README and `docs/design/dbsc-parity-plan.md`).
 *
 * Rather than carry a second copy of the fleet→seriesId map (the converter
 * already encodes it), this re-fetches whatever fragments are *already* on
 * disk: each is named `{fleet}-{seriesId}.html`, so we parse the trailing id
 * and re-pull it. A new fleet is captured once by hand; thereafter this keeps
 * it current. The DBSC "Thursday Overall" series ids are stable all season —
 * they just gain races — so this is a refresh, not a re-probe.
 *
 *   `_catalog-public-{id}.html`  → GET /Result/Public/{id}   (the page shell)
 *   `{fleet}-{id}.html`          → GET /Result/_Boat/{id}     (the table fragment)
 *
 * Run via `pnpm halsail:fetch`. Network + file IO only — no DB.
 * See `docs/notes/halsail/querying-public-results.md` for the endpoint model.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HALSAIL_DIR = join(__dirname, '..', 'reference', 'data', '2026-dbsc-summer-series', 'halsail');
const BASE = 'https://halsail.com';
// Be a good citizen: a small gap between requests, and a real UA (some HalSail
// front-ends 403 the default fetch agent).
const DELAY_MS = 750;
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (sailscoring halsail:fetch; +parity)' };

interface Fragment {
  file: string;
  id: string;
  url: string;
}

/** Parse the captured fragments into (file, id, endpoint) tuples. */
function manifest(): Fragment[] {
  const out: Fragment[] = [];
  for (const file of readdirSync(HALSAIL_DIR).sort()) {
    if (!file.endsWith('.html')) continue;
    const catalog = file.match(/^_catalog-public-(\d+)\.html$/);
    if (catalog) {
      out.push({ file, id: catalog[1], url: `${BASE}/Result/Public/${catalog[1]}` });
      continue;
    }
    const boat = file.match(/-(\d+)\.html$/);
    if (boat) {
      out.push({ file, id: boat[1], url: `${BASE}/Result/_Boat/${boat[1]}` });
      continue;
    }
    console.warn(`  ? skipping ${file}: no seriesId in filename`);
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const fragments = manifest();
  if (fragments.length === 0) {
    console.error(`No .html fragments in ${HALSAIL_DIR} to refresh.`);
    process.exit(1);
  }
  console.log(`Refreshing ${fragments.length} fragment(s) from ${BASE}`);

  let failed = 0;
  for (let i = 0; i < fragments.length; i++) {
    const { file, url } = fragments[i];
    if (i > 0) await sleep(DELAY_MS);
    try {
      const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      // Guard against silently writing an error/placeholder page over good data.
      if (body.length < 1024) throw new Error(`suspiciously short (${body.length} bytes)`);
      const path = join(HALSAIL_DIR, file);
      const before = readFileSync(path, 'utf8');
      writeFileSync(path, body);
      const changed = body !== before ? 'changed' : 'unchanged';
      console.log(`  ✓ ${file}  ${body.length} bytes  (${changed})`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${file}  ${url}  ${(err as Error).message}`);
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} fragment(s) failed — existing copies left untouched.`);
    process.exit(1);
  }
  console.log('\nDone. Next: pnpm halsail:to-sailscoring');
}

void main();
