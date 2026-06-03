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

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseHalsailFleet } from '../lib/halsail/parse-results';
import { RFC_UUID, contentHashUuid } from '../lib/halsail/snapshot-id';
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

const file = buildThursdayBlueSeries(classes, oneDesigns, {
  // Stable export marker so re-running produces a byte-identical file.
  exportedAt: '2026-06-02T00:00:00.000Z',
});

const outPath = join(DATA_DIR, 'dbsc-thursday-blue-2026.sailscoring');

// Snapshot lineage so a regenerated file re-imports cleanly as an *update* of
// the already-imported series (Import Series → "Update existing"). The app's
// checkLineage treats a file as a clean descendant when its snapshotHistory
// includes the local series' last snapshotId. We derive a content-hash
// snapshotId (stable for unchanged data → byte-identical reruns) and append it
// to the previous file's history, so every snapshot the user ever imported
// stays in the chain. See docs/notes/halsail/querying-public-results.md.
function contentSnapshotId(f: typeof file): string {
  return contentHashUuid(
    JSON.stringify({ series: f.series, fleets: f.fleets, competitors: f.competitors, races: f.races }),
  );
}

const snapshotId = contentSnapshotId(file);
let snapshotHistory: string[] = [snapshotId];
if (existsSync(outPath)) {
  const prior = JSON.parse(readFileSync(outPath, 'utf8')) as { snapshotHistory?: string[] };
  // Drop any prior entries that aren't valid RFC 4122 UUIDs: earlier versions
  // of this script sliced raw hash digests, producing ids the app's z.uuid()
  // boundary rejects. Such a snapshot could never have been imported, so it
  // carries no lineage worth preserving.
  const priorHistory = (prior.snapshotHistory ?? []).filter((id) => RFC_UUID.test(id));
  // Append only when the content actually changed; otherwise keep the chain
  // as-is so an unchanged regeneration is byte-identical.
  snapshotHistory = priorHistory.includes(snapshotId) ? priorHistory : [...priorHistory, snapshotId];
}
file.snapshotId = snapshotId;
file.snapshotHistory = snapshotHistory;

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
