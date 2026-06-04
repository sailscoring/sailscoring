/**
 * Generate a `.sailscoring` file from frozen HalSail result fragments.
 *
 * Reads the DBSC cruiser fragments under
 * `reference/data/2026-dbsc-summer-series/halsail/` (captured per
 * `docs/notes/halsail/querying-public-results.md`), parses them, and emits a
 * format-v6 `.sailscoring` file for import into the DBSC workspace — the input
 * side of the parity loop in `docs/design/dbsc-parity-plan.md`.
 *
 * Day-aware: `pnpm halsail:to-sailscoring [thursday|saturday|tuesday]`
 * (default thursday). Each day has its own fragment set, builder config and
 * output file. The file carries input only (competitors, ratings, races,
 * finishes); the app recomputes all standings. Pure file IO — no DB, no network
 * (re-fetch fragments with `pnpm halsail:fetch`).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseHalsailFleet } from '../lib/halsail/parse-results';
import { RFC_UUID, contentHashUuid } from '../lib/halsail/snapshot-id';
import {
  buildCruiserDaySeries,
  buildCombinedCruisersSeries,
  type BuildOptions,
  type SeriesFile,
} from '../lib/halsail/to-series';

const DATA_DIR = join(__dirname, '..', 'reference', 'data', '2026-dbsc-summer-series');
const HALSAIL_DIR = join(DATA_DIR, 'halsail');

function load(file: string) {
  return parseHalsailFleet(readFileSync(join(HALSAIL_DIR, file), 'utf8'));
}

interface DayConfig {
  outFile: string;
  defaultSeriesId: string;
  seriesName: string;
  build: (opts: BuildOptions) => SeriesFile;
}

const DAYS: Record<string, DayConfig> = {
  thursday: {
    outFile: 'dbsc-thursday-blue-2026.sailscoring',
    defaultSeriesId: 'dbsc-thursday-blue-2026',
    seriesName: 'DBSC Thursday Blue — Cruisers (2026)',
    build: (opts) =>
      buildCruiserDaySeries(
        [
          { classNum: 0, echo: load('c0-echo-95445.html'), irc: load('c0-irc-95446.html') },
          { classNum: 1, echo: load('c1-echo-95452.html'), irc: load('c1-irc-95450.html') },
          { classNum: 2, echo: load('c2-echo-95460.html'), irc: load('c2-irc-95458.html') },
          { classNum: 3, echo: load('c3-echo-95466.html') },
        ],
        [
          { fleetId: 'cf-j109', name: 'J/109', parentClass: 1, fleet: load('j109-95454.html') },
          { fleetId: 'cf-sigma33', name: 'Sigma 33', parentClass: 2, fleet: load('sigma33-95462.html') },
        ],
        opts,
        [
          { vprsFleetId: 'cf-45a-vprs', vprsName: 'Cruisers 4-5A VPRS', startKey: '45a', vprs: load('c45a-vprs-95884.html'), echoFleets: [{ fleetId: 'cf-5a-echo', name: 'Cruisers 5A ECHO', echo: load('c5a-echo-95473.html') }] },
          { vprsFleetId: 'cf-45b-vprs', vprsName: 'Cruisers 4-5B VPRS', startKey: '45b', vprs: load('c45b-vprs-95886.html'), echoFleets: [{ fleetId: 'cf-5b-echo', name: 'Cruisers 5B ECHO', echo: load('c5b-echo-95475.html') }] },
        ],
      ),
  },
  saturday: {
    outFile: 'dbsc-saturday-cruisers-2026.sailscoring',
    defaultSeriesId: 'dbsc-saturday-cruisers-2026',
    seriesName: 'DBSC Saturday Cruisers (2026)',
    build: (opts) =>
      buildCruiserDaySeries(
        [
          { classNum: 0, echo: load('sat-c0-echo-95444.html'), irc: load('sat-c0-irc-95443.html') },
          { classNum: 1, echo: load('sat-c1-echo-95451.html'), irc: load('sat-c1-irc-95449.html') },
          { classNum: 2, echo: load('sat-c2-echo-95459.html'), irc: load('sat-c2-irc-95457.html') },
          { classNum: 3, echo: load('sat-c3-echo-95465.html') },
        ],
        [
          { fleetId: 'cf-j109', name: 'J/109', parentClass: 1, fleet: load('sat-j109-95453.html') },
          { fleetId: 'cf-sigma33', name: 'Sigma 33', parentClass: 2, fleet: load('sat-sigma33-95461.html') },
        ],
        opts,
        [
          { vprsFleetId: 'cf-45a-vprs', vprsName: 'Cruisers 4-5A VPRS', startKey: '45a', vprs: load('sat-c45a-vprs-95883.html'), echoFleets: [{ fleetId: 'cf-5a-echo', name: 'Cruisers 5A ECHO', echo: load('sat-c5a-echo-95472.html') }] },
          { vprsFleetId: 'cf-45b-vprs', vprsName: 'Cruisers 4-5B VPRS', startKey: '45b', vprs: load('sat-c45b-vprs-95885.html'), echoFleets: [{ fleetId: 'cf-5b-echo', name: 'Cruisers 5B ECHO', echo: load('sat-c5b-echo-95474.html') }] },
        ],
      ),
  },
  tuesday: {
    outFile: 'dbsc-tuesday-cruisers-2026.sailscoring',
    defaultSeriesId: 'dbsc-tuesday-cruisers-2026',
    seriesName: 'DBSC Tuesday Cruisers (2026)',
    build: (opts) =>
      buildCombinedCruisersSeries(
        [
          { fleetId: 'cf-combined', name: 'Combined Cruisers', fleet: load('tue-combined-95502.html') },
          { fleetId: 'cf-3-echo', name: 'Cruisers 3 ECHO', fleet: load('tue-c3-echo-95467.html') },
        ],
        opts,
      ),
  },
};

const args = process.argv.slice(2);
const day = args.find((a) => !a.startsWith('--')) ?? 'thursday';
const cfg = DAYS[day];
if (!cfg) {
  console.error(`Unknown day "${day}". Use one of: ${Object.keys(DAYS).join(', ')}.`);
  process.exit(1);
}
const outPath = join(DATA_DIR, cfg.outFile);

// Identity + snapshot lineage. The app matches a file to an existing series by
// `seriesId`, and `checkLineage` treats the file as a clean descendant when its
// `snapshotHistory` includes the local series' `lastSnapshotId`. So to keep a
// weekly regeneration importing cleanly as an *update* (Settings → "Update from
// file"), we carry the seriesId and history forward from the previously
// generated file rather than re-minting them.
//
// Pass `--adopt <export.sailscoring>` once to take the seriesId and history from
// an in-app export — the bootstrap that stamps the committed file with the real
// UUID the first time. A never-yet-imported file falls back to the day's slug
// and imports as a new series.
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

const file = cfg.build({
  seriesName: cfg.seriesName,
  seriesId: identity.seriesId ?? cfg.defaultSeriesId,
  // Stable export marker so re-running produces a byte-identical file.
  exportedAt: '2026-06-02T00:00:00.000Z',
});

// Content-hash snapshotId — stable for unchanged data, so an unchanged
// regeneration is byte-identical. Appended to the carried history unless the
// content is unchanged (in which case the head already equals it).
const snapshotId = contentHashUuid(
  JSON.stringify({ series: file.series, fleets: file.fleets, competitors: file.competitors, races: file.races }),
);
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
