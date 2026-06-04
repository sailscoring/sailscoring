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
    ],
  },
  tuesday: {
    sailscoring: 'dbsc-tuesday-cruisers-2026.sailscoring',
    pairings: [
      { file: 'tue-combined-95502.html', fleet: 'Combined Cruisers' },
      { file: 'tue-c3-echo-95467.html', fleet: 'Cruisers 3 ECHO' },
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
  return { points, code: codeText ? codeText.trim().toUpperCase() : null, discarded };
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
      const rank = Number(tds[0]);
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
      console.log(`FAIL  ${fleet}: could not parse HalSail summary in ${file}`);
      anyDiff = true;
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
