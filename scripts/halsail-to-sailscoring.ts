/**
 * Generate a `.sailscoring` file from frozen HalSail result fragments.
 *
 * Reads the DBSC Thursday Blue cruiser fragments under
 * `reference/data/2026-dbsc-summer-series/halsail/` (captured per
 * `docs/notes/halsail/querying-public-results.md`), parses them, and emits a
 * format-v6 `.sailscoring` file for import into the DBSC workspace — the input
 * side of the parity loop in `docs/design/dbsc-parity-plan.md`.
 *
 * The file carries input only (competitors, ratings, races, finishes); the app
 * recomputes all standings. Run via `pnpm halsail:to-sailscoring`. Pure file
 * IO — no DB, no network (re-fetch fragments with the documented endpoints).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseHalsailFleet } from '../lib/halsail/parse-results';
import {
  buildThursdayBlueSeries,
  type ClassInput,
  type OneDesignInput,
} from '../lib/halsail/to-series';

const DATA_DIR = join(__dirname, '..', 'reference', 'data', '2026-dbsc-summer-series');
const HALSAIL_DIR = join(DATA_DIR, 'halsail');

function load(file: string) {
  const html = readFileSync(join(HALSAIL_DIR, file), 'utf8');
  return parseHalsailFleet(html);
}

const classes: ClassInput[] = [
  { classNum: 0, echo: load('c0-echo-95445.html'), irc: load('c0-irc-95446.html') },
  { classNum: 1, echo: load('c1-echo-95452.html'), irc: load('c1-irc-95450.html') },
  { classNum: 2, echo: load('c2-echo-95460.html'), irc: load('c2-irc-95458.html') },
  { classNum: 3, echo: load('c3-echo-95466.html') },
];

const oneDesigns: OneDesignInput[] = [
  { fleetId: 'cf-j109', name: 'J/109', parentClass: 1, fleet: load('j109-95454.html') },
  { fleetId: 'cf-sigma33', name: 'Sigma 33', parentClass: 2, fleet: load('sigma33-95462.html') },
];

// Flag boats whose IRC TCC changes mid-series: HalSail scores these per-race,
// but our model stores one fixed `ircTcc`, so the generated file uses the
// boat's first-race TCC and its later races may not match HalSail exactly.
for (const cl of classes) {
  if (!cl.irc) continue;
  for (const c of cl.irc.competitors) {
    const applied = [...new Set(cl.irc.races
      .flatMap((r) => r.finishers.filter((f) => f.sail === c.sail))
      .map((f) => f.hcap)
      .filter((h): h is number => h != null))];
    if (applied.length > 1) {
      console.warn(`  ! IRC TCC changes mid-series for sail ${c.sail} (Cruisers ${cl.classNum}): ${applied.join(' → ')}; using first. Expect a parity mismatch on later races.`);
    }
  }
}

const file = buildThursdayBlueSeries(classes, oneDesigns, {
  // Stable export marker so re-running produces a byte-identical file.
  exportedAt: '2026-06-02T00:00:00.000Z',
});

const outPath = join(DATA_DIR, 'dbsc-thursday-blue-2026.sailscoring');
writeFileSync(outPath, JSON.stringify(file, null, 2) + '\n');

const echoFleets = file.fleets.filter((f) => f.scoringSystem === 'echo').length;
const ircFleets = file.fleets.filter((f) => f.scoringSystem === 'irc').length;
const scratchFleets = file.fleets.filter((f) => f.scoringSystem === 'scratch').length;
console.log(`wrote ${outPath}`);
console.log(
  `  ${file.fleets.length} fleets (${ircFleets} IRC, ${echoFleets} ECHO, ${scratchFleets} one-design), ` +
    `${file.competitors.length} competitors, ${file.races.length} races`,
);
for (const r of file.races) {
  const fin = r.finishes.filter((f) => f.resultCode === null).length;
  const coded = r.finishes.length - fin;
  console.log(`  Race ${r.raceNumber} (${r.date}): ${fin} finishers, ${coded} coded, ${r.starts.length} starts`);
}
