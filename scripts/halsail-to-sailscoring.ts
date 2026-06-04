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

const outPath = join(DATA_DIR, 'dbsc-thursday-blue-2026.sailscoring');

// Identity + snapshot lineage. The app matches a file to an existing series by
// `seriesId`, and `checkLineage` treats the file as a clean descendant when its
// `snapshotHistory` includes the local series' `lastSnapshotId`. So to keep a
// weekly regeneration importing cleanly as an *update* (Settings → "Update
// from file"), we carry the seriesId and history forward from the previously
// generated file rather than re-minting them.
//
// `seriesId` is the in-app series' UUID once the file has been imported and
// re-seeded. Pass `--adopt <export.sailscoring>` once to take the seriesId and
// history from an in-app export — the bootstrap that stamps the committed file
// with the real UUID the first time. A never-yet-imported file has no UUID to
// carry, so it falls back to the builder's slug and imports as a new series.
function readIdentity(path: string): { seriesId?: string; history: string[] } {
  const j = JSON.parse(readFileSync(path, 'utf8')) as { seriesId?: string; snapshotHistory?: string[] };
  return {
    seriesId: j.seriesId && RFC_UUID.test(j.seriesId) ? j.seriesId : undefined,
    // Drop entries that aren't valid RFC 4122 UUIDs: early versions sliced raw
    // hash digests into ids the app's z.uuid() boundary rejects, and such a
    // snapshot could never have been imported, so it carries no lineage.
    history: (j.snapshotHistory ?? []).filter((id) => RFC_UUID.test(id)),
  };
}

const adoptIdx = process.argv.indexOf('--adopt');
const adoptPath = adoptIdx >= 0 ? process.argv[adoptIdx + 1] : undefined;
const identitySource = adoptPath ?? (existsSync(outPath) ? outPath : undefined);
const identity = identitySource ? readIdentity(identitySource) : { history: [] as string[] };

const file = buildThursdayBlueSeries(classes, oneDesigns, {
  // Stable export marker so re-running produces a byte-identical file.
  exportedAt: '2026-06-02T00:00:00.000Z',
  ...(identity.seriesId ? { seriesId: identity.seriesId } : {}),
});

// Content-hash snapshotId — stable for unchanged data, so an unchanged
// regeneration is byte-identical. Appended to the carried history unless the
// content is unchanged (in which case the head already equals it).
function contentSnapshotId(f: typeof file): string {
  return contentHashUuid(
    JSON.stringify({ series: f.series, fleets: f.fleets, competitors: f.competitors, races: f.races }),
  );
}

const snapshotId = contentSnapshotId(file);
file.snapshotId = snapshotId;
file.snapshotHistory = identity.history.includes(snapshotId)
  ? identity.history
  : [...identity.history, snapshotId];

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
