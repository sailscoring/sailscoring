/**
 * Capture the DBSC summer-series archive from `archive.halsail.com` into
 * `reference/data/dbsc-summer-series-archive/`. The Hal *archive* is a separate
 * app from the live HalSail site, with a four-level AJAX cascade (all public
 * GET, no auth/token):
 *
 *   _CrsResultSetDropDown/{account}?DSKey={ds}  → the archived datasets (years)
 *   _CrsClassDropDown/{ds}                       → classes (fleets) in a dataset
 *   _CrsSeryDropDown/{ds}?ClassKey={c}           → series available to a class  ← the join
 *   _CrsResults/{ds}?SeriesKey={s}               → the results table fragment
 *
 * The class→series mapping is the telling artifact: it is *only* exposed by the
 * per-class _CrsSeryDropDown call and is absent from any results page, so we
 * persist it both raw (series/class-{c}.html) and normalized (catalog.json).
 *
 *   --map-only   Stage A: datasets + classes + the class→series join only.
 *                Builds catalog.json per year; fetches no results fragments.
 *   --year=YYYY  Restrict to one dataset (default: all four).
 *
 * Resumable: a raw file already on disk is reused, not re-fetched. Run via
 * `pnpm halsail:archive:fetch`. Network + file IO only — no DB.
 * See `docs/notes/halsail/querying-public-results.md` for the endpoint model.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://archive.halsail.com';
// The DBSC archive account; any of its DSKeys lists all the others.
const ACCOUNT = '1426';
const SEED_DSKEY = '3413';
const OUT_DIR = join(__dirname, '..', 'reference', 'data', 'dbsc-summer-series-archive');
const DELAY_MS = 750;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (sailscoring halsail:archive:fetch; +parity)',
  'X-Requested-With': 'XMLHttpRequest',
};

interface Opt {
  key: string;
  name: string;
}
interface SeriesEntry extends Opt {
  resultsPath: string;
}
interface ClassEntry extends Opt {
  series: SeriesEntry[];
}
interface Catalog {
  dsKey: string;
  name: string;
  year: string;
  account: string;
  source: string;
  fetchedAt: string;
  counts: { classes: number; pairs: number; distinctSeriesNames: number };
  classes: ClassEntry[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** HalSail's option markup is loose: unquoted attrs, newlines between the tag
 *  and its text. Parse permissively and drop the "please select" placeholder. */
function parseOptions(html: string): Opt[] {
  const out: Opt[] = [];
  const re = /<option[^>]*value="?([^">]+)"?[^>]*>([\s\S]*?)<\/option>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const key = m[1].trim();
    const name = m[2].replace(/\s+/g, ' ').trim();
    if (!key || key === '0') continue;
    if (/^(please\s+select|select\b)/i.test(name)) continue;
    out.push({ key, name });
  }
  return out;
}

let requestCount = 0;

/** Fetch with retry/backoff; reuse a cached copy on disk if present (resume). */
async function fetchCached(url: string, cachePath: string): Promise<string> {
  if (existsSync(cachePath)) {
    const cached = readFileSync(cachePath, 'utf8');
    console.log(`  · cached ${cachePath.replace(OUT_DIR + '/', '')} (${cached.length} bytes)`);
    return cached;
  }
  for (let attempt = 1; ; attempt++) {
    if (requestCount > 0) await sleep(DELAY_MS);
    requestCount++;
    try {
      const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      if (body.length < 16) throw new Error(`suspiciously short (${body.length} bytes)`);
      mkdirSync(join(cachePath, '..'), { recursive: true });
      writeFileSync(cachePath, body);
      console.log(`  ✓ ${cachePath.replace(OUT_DIR + '/', '')} (${body.length} bytes)`);
      return body;
    } catch (err) {
      if (attempt >= 4) throw err;
      const backoff = DELAY_MS * 2 ** attempt;
      console.warn(`  retry ${attempt} after ${backoff}ms: ${url} (${(err as Error).message})`);
      await sleep(backoff);
    }
  }
}

function yearOf(name: string, dsKey: string): string {
  const m = name.match(/\b(20\d\d)\b/);
  return m ? m[1] : dsKey;
}

async function buildCatalog(ds: Opt): Promise<Catalog> {
  const year = yearOf(ds.name, ds.key);
  const yearDir = join(OUT_DIR, year);
  console.log(`\n=== ${ds.name} (DSKey ${ds.key}) → ${year}/ ===`);

  const classesHtml = await fetchCached(
    `${BASE}/Result/_CrsClassDropDown/${ds.key}`,
    join(yearDir, '_classdropdown.html'),
  );
  const classOpts = parseOptions(classesHtml);

  const classes: ClassEntry[] = [];
  for (const c of classOpts) {
    const seryHtml = await fetchCached(
      `${BASE}/Result/_CrsSeryDropDown/${ds.key}?ClassKey=${c.key}`,
      join(yearDir, 'series', `class-${c.key}.html`),
    );
    const series: SeriesEntry[] = parseOptions(seryHtml).map((s) => ({
      ...s,
      resultsPath: `results/series-${s.key}.html`,
    }));
    classes.push({ ...c, series });
  }

  const pairs = classes.reduce((n, c) => n + c.series.length, 0);
  const distinctSeriesNames = new Set(
    classes.flatMap((c) => c.series.map((s) => s.name)),
  ).size;

  const catalog: Catalog = {
    dsKey: ds.key,
    name: ds.name,
    year,
    account: ACCOUNT,
    source: BASE,
    fetchedAt: new Date().toISOString(),
    counts: { classes: classes.length, pairs, distinctSeriesNames },
    classes,
  };
  writeFileSync(join(yearDir, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
  console.log(
    `  catalog.json: ${classes.length} classes, ${pairs} (class×series) pairs, ` +
      `${distinctSeriesNames} distinct series names`,
  );
  return catalog;
}

async function main() {
  const mapOnly = process.argv.includes('--map-only');
  const yearArg = process.argv.find((a) => a.startsWith('--year='))?.split('=')[1];
  if (!mapOnly) {
    console.error('Stage B (results) not implemented yet. Re-run with --map-only.');
    process.exit(1);
  }
  mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Hal archive capture (map-only) → ${OUT_DIR}`);
  const datasets = parseOptions(
    await fetchCached(
      `${BASE}/Result/_CrsResultSetDropDown/${ACCOUNT}?DSKey=${SEED_DSKEY}`,
      join(OUT_DIR, '_resultsets.html'),
    ),
  );
  const selected = yearArg
    ? datasets.filter((d) => yearOf(d.name, d.key) === yearArg)
    : datasets;
  if (selected.length === 0) {
    console.error(`No dataset matched --year=${yearArg}. Available: ` +
      datasets.map((d) => yearOf(d.name, d.key)).join(', '));
    process.exit(1);
  }

  const catalogs: Catalog[] = [];
  for (const ds of selected) catalogs.push(await buildCatalog(ds));

  writeFileSync(
    join(OUT_DIR, 'manifest.json'),
    JSON.stringify(
      {
        account: ACCOUNT,
        source: BASE,
        fetchedAt: new Date().toISOString(),
        datasets: datasets.map((d) => ({ dsKey: d.key, name: d.name, year: yearOf(d.name, d.key) })),
      },
      null,
      2,
    ) + '\n',
  );

  console.log(`\n— Stage A summary (${requestCount} requests made) —`);
  for (const c of catalogs) {
    console.log(
      `  ${c.year}: ${c.counts.classes} classes, ${c.counts.pairs} result fragments to pull in Stage B`,
    );
  }
  const totalPairs = catalogs.reduce((n, c) => n + c.counts.pairs, 0);
  console.log(`  Stage B total: ${totalPairs} result fragments.`);
}

void main();
