/**
 * Parity check: our scoring engine vs HalSail's published standings.
 *
 * Step 5 of the weekly DBSC loop (see
 * `reference/data/2026-dbsc-summer-series/README.md`). Runs
 * `calculateFleetStandings` on the generated `.sailscoring` and diffs the
 * result, per fleet and per competitor, against HalSail's published summary
 * table (the `_Boat` fragment captured under `halsail/`). No network, no DB,
 * no publish step — the fragments *are* what HalSail publishes.
 *
 * Why this is a real check and not circular: the finishes were reconstructed
 * from the same fragments, but the **points, discards, net scores and ranks**
 * we compare are recomputed independently by our engine and matched against
 * HalSail's own computed columns. A misread finish would still surface as a
 * points divergence.
 *
 * The parity bar (docs/design/dbsc-parity-plan.md): same competitors, same
 * per-race points (incl. coded results and the per-race DNC value), same
 * discards, same net scores, same finishing order.
 *
 * Run via `pnpm halsail:compare`. Exit code 1 if any fleet diverges.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseHalsailFleet } from '../lib/halsail/parse-results';
import { calculateFleetStandings } from '../lib/scoring';
import type {
  Competitor,
  DiscardThreshold,
  DnfScoring,
  Fleet,
  Finish,
  Race,
  RaceRatingOverride,
  RaceStart,
  Standing,
} from '../lib/types';

const DATA_DIR = join(__dirname, '..', 'reference', 'data', '2026-dbsc-summer-series');
const HALSAIL_DIR = join(DATA_DIR, 'halsail');

// Per-day: the generated .sailscoring and the HalSail fragment → our fleet name
// pairings (one published series per fleet).
interface DayCompare {
  sailscoring: string;
  pairings: { file: string; fleet: string }[];
}
const DAYS: Record<string, DayCompare> = {
  thursday: {
    sailscoring: 'dbsc-thursday-blue-2026.sailscoring',
    pairings: [
      { file: 'c0-irc-95446.html', fleet: 'Cruisers 0 IRC' },
      { file: 'c1-irc-95450.html', fleet: 'Cruisers 1 IRC' },
      { file: 'c2-irc-95458.html', fleet: 'Cruisers 2 IRC' },
      { file: 'c0-echo-95445.html', fleet: 'Cruisers 0 ECHO' },
      { file: 'c1-echo-95452.html', fleet: 'Cruisers 1 ECHO' },
      { file: 'c2-echo-95460.html', fleet: 'Cruisers 2 ECHO' },
      { file: 'c3-echo-95466.html', fleet: 'Cruisers 3 ECHO' },
      { file: 'j109-95454.html', fleet: 'J/109' },
      { file: 'sigma33-95462.html', fleet: 'Sigma 33' },
      { file: 'c45a-vprs-95884.html', fleet: 'Cruisers 4-5A VPRS' },
      { file: 'c45b-vprs-95886.html', fleet: 'Cruisers 4-5B VPRS' },
      { file: 'c5a-echo-95473.html', fleet: 'Cruisers 5A ECHO' },
      { file: 'c5b-echo-95475.html', fleet: 'Cruisers 5B ECHO' },
    ],
  },
  saturday: {
    sailscoring: 'dbsc-saturday-cruisers-2026.sailscoring',
    pairings: [
      { file: 'sat-c0-irc-95443.html', fleet: 'Cruisers 0 IRC' },
      { file: 'sat-c1-irc-95449.html', fleet: 'Cruisers 1 IRC' },
      { file: 'sat-c2-irc-95457.html', fleet: 'Cruisers 2 IRC' },
      { file: 'sat-c0-echo-95444.html', fleet: 'Cruisers 0 ECHO' },
      { file: 'sat-c1-echo-95451.html', fleet: 'Cruisers 1 ECHO' },
      { file: 'sat-c2-echo-95459.html', fleet: 'Cruisers 2 ECHO' },
      { file: 'sat-c3-echo-95465.html', fleet: 'Cruisers 3 ECHO' },
      { file: 'sat-j109-95453.html', fleet: 'J/109' },
      { file: 'sat-sigma33-95461.html', fleet: 'Sigma 33' },
      { file: 'sat-c45a-vprs-95883.html', fleet: 'Cruisers 4-5A VPRS' },
      { file: 'sat-c45b-vprs-95885.html', fleet: 'Cruisers 4-5B VPRS' },
      { file: 'sat-c5a-echo-95472.html', fleet: 'Cruisers 5A ECHO' },
      { file: 'sat-c5b-echo-95474.html', fleet: 'Cruisers 5B ECHO' },
    ],
  },
  'thursday-red': {
    sailscoring: 'dbsc-thursday-red-2026.sailscoring',
    pairings: [
      { file: 'dragon-95483.html', fleet: 'Dragon' },
      { file: 'ff-95486.html', fleet: 'Flying Fifteen' },
      { file: 'ruffian-95488.html', fleet: 'Ruffian 23' },
      { file: 'sb20-95490.html', fleet: 'SB20' },
      { file: 'shipman-95492.html', fleet: 'Shipman' },
      { file: 'sportsboats-95495.html', fleet: 'Mixed Sportsboats' },
      { file: 'glen-95500.html', fleet: 'Glen' },
      { file: 'j80-95876.html', fleet: 'J/80' },
      { file: 'glenmermaid-py-95497.html', fleet: 'Glen-Mermaid PY' },
      { file: 'b211-scr-95477.html', fleet: 'Beneteau 211' },
      { file: 'b211-echo-95480.html', fleet: 'Beneteau 211 ECHO' },
      { file: 'b317-scr-95469.html', fleet: 'Beneteau 31.7' },
      { file: 'b317-echo-95471.html', fleet: 'Beneteau 31.7 ECHO' },
    ],
  },
  'saturday-od': {
    sailscoring: 'dbsc-saturday-od-2026.sailscoring',
    pairings: [
      { file: 'sat-dragon-95482.html', fleet: 'Dragon' },
      { file: 'sat-ff-95485.html', fleet: 'Flying Fifteen' },
      { file: 'sat-ruffian-95487.html', fleet: 'Ruffian 23' },
      { file: 'sat-sb20-95489.html', fleet: 'SB20' },
      { file: 'sat-shipman-95491.html', fleet: 'Shipman' },
      { file: 'sat-sportsboats-95494.html', fleet: 'Mixed Sportsboats' },
      { file: 'sat-glen-95499.html', fleet: 'Glen' },
      { file: 'sat-j80-95875.html', fleet: 'J/80' },
      { file: 'sat-glenmermaid-py-95496.html', fleet: 'Glen-Mermaid PY' },
      { file: 'sat-b211-scr-95476.html', fleet: 'Beneteau 211' },
      { file: 'sat-b211-echo-95479.html', fleet: 'Beneteau 211 ECHO' },
      { file: 'sat-b317-scr-95468.html', fleet: 'Beneteau 31.7' },
      { file: 'sat-b317-echo-95470.html', fleet: 'Beneteau 31.7 ECHO' },
      { file: 'sat-db21-95511.html', fleet: 'Dublin Bay 21' },
      { file: 'sat-fireball-95587.html', fleet: 'Fireball' },
      { file: 'sat-idra14-95589.html', fleet: 'IDRA 14' },
      { file: 'sat-ilca7-95602.html', fleet: 'ILCA 7' },
      { file: 'sat-ilca6-95598.html', fleet: 'ILCA 6' },
      { file: 'sat-pyclass-95594.html', fleet: 'PY Class' },
    ],
  },
  'tuesday-od': {
    sailscoring: 'dbsc-tuesday-od-2026.sailscoring',
    pairings: [
      { file: 'tue-dragon-95484.html', fleet: 'Dragon' },
      { file: 'tue-ff-95509.html', fleet: 'Flying Fifteen' },
      { file: 'tue-ruffian-95510.html', fleet: 'Ruffian 23' },
      { file: 'tue-sb20-95508.html', fleet: 'SB20' },
      { file: 'tue-shipman-95493.html', fleet: 'Shipman' },
      { file: 'tue-sportsboats-95507.html', fleet: 'Mixed Sportsboats' },
      { file: 'tue-glen-95501.html', fleet: 'Glen' },
      { file: 'tue-j80-95877.html', fleet: 'J/80' },
      { file: 'tue-glenmermaid-py-95498.html', fleet: 'Glen-Mermaid PY' },
      { file: 'tue-b211-scr-95478.html', fleet: 'Beneteau 211' },
      { file: 'tue-b211-echo-95481.html', fleet: 'Beneteau 211 ECHO' },
      { file: 'tue-db21-95517.html', fleet: 'Dublin Bay 21' },
      { file: 'tue-fireball-95586.html', fleet: 'Fireball' },
      { file: 'tue-idra14-95588.html', fleet: 'IDRA 14' },
      { file: 'tue-ilca7-95600.html', fleet: 'ILCA 7' },
      { file: 'tue-ilca6-95596.html', fleet: 'ILCA 6' },
      { file: 'tue-pyclass-95592.html', fleet: 'PY Class' },
      { file: 'tue-wow-95505.html', fleet: 'Women on the Water' },
    ],
  },
  tuesday: {
    sailscoring: 'dbsc-tuesday-cruisers-2026.sailscoring',
    pairings: [
      { file: 'tue-combined-95502.html', fleet: 'Combined Cruisers' },
      { file: 'tue-c3-echo-95467.html', fleet: 'Cruisers 3 ECHO' },
    ],
  },
  'water-wags': {
    sailscoring: 'dbsc-water-wags-2026.sailscoring',
    pairings: [
      { file: 'wed-waterwag-95516.html', fleet: 'Water Wag' },
    ],
  },
};

const day = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'thursday';
const cfg = DAYS[day];
if (!cfg) {
  console.error(`Unknown day "${day}". Use one of: ${Object.keys(DAYS).join(', ')}.`);
  process.exit(1);
}
const SAILSCORING = join(DATA_DIR, cfg.sailscoring);
const PAIRINGS = cfg.pairings;

// Points are low-point integers (RDG averages can be fractional); flag deltas
// above this.
const POINTS_TOLERANCE = 0.05;

// Codes the engine actually understands (result codes + additive penalties).
// A HalSail code outside this set — after the converter's CODE_MAP normalises
// equivalents like TLE→DNF — means the engine would silently mis-score it, so
// the compare flags it rather than trusting a bare string match.
const KNOWN_CODES = new Set([
  'DNC', 'DNS', 'OCS', 'NSC', 'DNF', 'RET', 'DSQ', 'DNE', 'UFD', 'BFD', 'RDG',
  'SCP', 'ZFP', 'DPI',
]);

// ---- our side: run the engine on the .sailscoring ----

interface SailscoringFile {
  series: { discardThresholds: DiscardThreshold[]; dnfScoring: DnfScoring };
  fleets: Fleet[];
  competitors: Competitor[];
  races: {
    id: string;
    raceNumber: number;
    date: string;
    starts: { id: string; fleetIds: string[]; startTime: string }[];
    finishes: Omit<Finish, 'raceId'>[];
    ratingOverrides?: Omit<RaceRatingOverride, 'raceId'>[];
  }[];
}

interface OurRow {
  rank: number;
  net: number;
  byRaceNumber: Map<number, { points: number; code: string | null; discarded: boolean }>;
}

function computeOurStandings(): { raceNumbers: number[]; byFleetName: Map<string, Map<string, OurRow>> } {
  const file = JSON.parse(readFileSync(SAILSCORING, 'utf8')) as SailscoringFile;
  const races: Race[] = file.races.map((r) => ({ id: r.id, raceNumber: r.raceNumber, date: r.date }) as Race);
  const finishes: Finish[] = file.races.flatMap((r) => r.finishes.map((f) => ({ ...f, raceId: r.id }) as Finish));
  const raceStarts: RaceStart[] = file.races.flatMap((r) =>
    r.starts.map((s) => ({ ...s, raceId: r.id }) as RaceStart),
  );
  const ratingOverrides: RaceRatingOverride[] = file.races.flatMap((r) =>
    (r.ratingOverrides ?? []).map((o) => ({ ...o, raceId: r.id }) as RaceRatingOverride),
  );
  const raceNumbers = [...races].sort((a, b) => a.raceNumber - b.raceNumber).map((r) => r.raceNumber);

  const { fleetStandings } = calculateFleetStandings(
    file.fleets,
    file.competitors,
    races,
    finishes,
    file.series.discardThresholds,
    file.series.dnfScoring,
    raceStarts,
    ratingOverrides,
  );

  const byFleetName = new Map<string, Map<string, OurRow>>();
  for (const fs of fleetStandings) {
    const rows = new Map<string, OurRow>();
    for (const s of fs.standings as Standing[]) {
      const byRaceNumber = new Map<number, { points: number; code: string | null; discarded: boolean }>();
      raceNumbers.forEach((rn, i) => {
        byRaceNumber.set(rn, {
          points: s.racePoints[i],
          // HalSail shows a scoring penalty (SCP/ZFP/DPI) as the cell "code",
          // so fall back to our additive penalty code when there's no result
          // code, to line the two up.
          code: s.raceCodes[i] ?? s.racePenaltyCodes[i] ?? null,
          discarded: s.raceDiscards[i] ?? false,
        });
      });
      rows.set(normSail(s.competitor.sailNumber), { rank: s.rank, net: s.netPoints, byRaceNumber });
    }
    byFleetName.set(fs.fleet.name, rows);
  }
  return { raceNumbers, byFleetName };
}

// ---- HalSail side: parse the published summary table ----

interface HalRow {
  rank: number;
  net: number;
  byRaceNumber: Map<number, { points: number; code: string | null; discarded: boolean }>;
}

const normSail = (s: string) => s.replace(/\s+/g, '').toUpperCase();

/** Decode a HalSail summary race cell: "2" | "(3)" | "9/RET" | "(10/DNC)". */
function parseCell(text: string): { points: number; code: string | null; discarded: boolean } | null {
  const t = text.trim();
  if (!t) return null;
  const discarded = t.startsWith('(') && t.endsWith(')');
  const inner = discarded ? t.slice(1, -1).trim() : t;
  const [ptsText, codeText] = inner.split('/');
  const points = Number(ptsText);
  if (!Number.isFinite(points)) return null;
  let code = codeText ? codeText.trim().toUpperCase() : null;
  // The converter maps HalSail's TLE (Time Limit Expired) to DNF (DBSC scores
  // them identically); line the published code up with ours.
  if (code === 'TLE') code = 'DNF';
  return { points, code, discarded };
}

/** Parse the standings (Rank …) table out of a fragment into rows by sail. */
function parseHalsailSummary(html: string): { raceNumbers: number[]; rows: Map<string, HalRow> } | null {
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  for (const table of tables) {
    const ths = [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((m) =>
      m[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim(),
    );
    if (!ths.some((x) => /^rank$/i.test(x))) continue;

    const sailIdx = ths.findIndex((x) => /^sail$/i.test(x));
    const scoreIdx = ths.findIndex((x) => /^score$/i.test(x));
    const raceCols: { idx: number; raceNumber: number }[] = [];
    ths.forEach((x, i) => {
      const m = x.match(/^race\s*(\d+)$/i);
      if (m) raceCols.push({ idx: i, raceNumber: Number(m[1]) });
    });
    if (sailIdx < 0 || scoreIdx < 0 || raceCols.length === 0) return null;

    const rows = new Map<string, HalRow>();
    const trs = [...table.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) => m[0]).filter((r) => /<td/i.test(r));
    for (const tr of trs) {
      const tds = [...tr.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
        m[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim(),
      );
      if (tds.length < ths.length) continue;
      const sail = normSail(tds[sailIdx] ?? '');
      if (!sail) continue;
      // HalSail marks a tied rank with a trailing "=" (e.g. "22="); take the
      // leading integer.
      const rank = parseInt(tds[0], 10);
      const net = Number(tds[scoreIdx]);
      const byRaceNumber = new Map<number, { points: number; code: string | null; discarded: boolean }>();
      for (const { idx, raceNumber } of raceCols) {
        const cell = parseCell(tds[idx] ?? '');
        if (cell) byRaceNumber.set(raceNumber, cell);
      }
      rows.set(sail, { rank, net, byRaceNumber });
    }
    return { raceNumbers: raceCols.map((c) => c.raceNumber), rows };
  }
  return null;
}

// ---- diff ----

function compareFleet(
  fleet: string,
  ours: Map<string, OurRow>,
  hal: { raceNumbers: number[]; rows: Map<string, HalRow> },
): string[] {
  const diffs: string[] = [];
  const ourSails = new Set(ours.keys());
  const halSails = new Set(hal.rows.keys());

  for (const s of [...halSails].filter((x) => !ourSails.has(x)))
    diffs.push(`  ROSTER: ${s} in HalSail but not ours`);
  for (const s of [...ourSails].filter((x) => !halSails.has(x)))
    diffs.push(`  ROSTER: ${s} in ours but not HalSail`);

  for (const sail of [...halSails].filter((x) => ourSails.has(x))) {
    const o = ours.get(sail)!;
    const h = hal.rows.get(sail)!;
    if (o.rank !== h.rank) diffs.push(`  RANK ${sail}: ours=${o.rank} HalSail=${h.rank}`);
    if (Math.abs(o.net - h.net) > POINTS_TOLERANCE)
      diffs.push(`  NET  ${sail}: ours=${o.net} HalSail=${h.net}`);
    for (const rn of hal.raceNumbers) {
      const oc = o.byRaceNumber.get(rn);
      const hc = h.byRaceNumber.get(rn);
      if (!oc || !hc) continue;
      const probs: string[] = [];
      // Integrity guard: a code HalSail uses that the engine doesn't recognise
      // (after the converter's CODE_MAP) would otherwise pass on a string match
      // while the engine silently mis-scores it. Flag it so we never again
      // "match" an unhandled code by coincidence (e.g. TLE).
      if (hc.code && !KNOWN_CODES.has(hc.code)) probs.push(`unrecognised code ${hc.code}`);
      if (Math.abs(oc.points - hc.points) > POINTS_TOLERANCE) probs.push(`pts ${oc.points}≠${hc.points}`);
      if ((oc.code ?? '') !== (hc.code ?? '')) probs.push(`code ${oc.code ?? '—'}≠${hc.code ?? '—'}`);
      if (oc.discarded !== hc.discarded) probs.push(`discard ${oc.discarded}≠${hc.discarded}`);
      if (probs.length) diffs.push(`  R${rn} ${sail}: ${probs.join(', ')}`);
    }
  }
  return diffs;
}

function main() {
  const { byFleetName } = computeOurStandings();
  let anyDiff = false;

  for (const { file, fleet } of PAIRINGS) {
    const ours = byFleetName.get(fleet);
    if (!ours) {
      console.log(`FAIL  ${fleet}: no engine standings (fleet name not found)`);
      anyDiff = true;
      continue;
    }
    const hal = parseHalsailSummary(readFileSync(join(HALSAIL_DIR, file), 'utf8'));
    if (!hal) {
      // No summary table = the fleet has no scored races yet on this day. If we
      // also have no boats for it, there's nothing to compare; only flag it if
      // our side somehow produced standings HalSail doesn't.
      if (ours.size === 0) {
        console.log(`SKIP  ${fleet}: no published results yet`);
      } else {
        console.log(`FAIL  ${fleet}: HalSail has no summary but we have ${ours.size} boats (${file})`);
        anyDiff = true;
      }
      continue;
    }
    const diffs = compareFleet(fleet, ours, hal);
    if (diffs.length) {
      anyDiff = true;
      console.log(`DIFF  ${fleet}  (${file})`);
      for (const d of diffs) console.log(d);
    } else {
      console.log(`OK    ${fleet}  (${ours.size} boats, races ${hal.raceNumbers.join('/')})`);
    }
  }

  process.exit(anyDiff ? 1 : 0);
}

main();
