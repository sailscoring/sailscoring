/**
 * One-shot: thread HYC's "SC TESTING" FTP paths from
 * `reference/data/2026-hyc-club-racing/2016_club.csv` onto the matching
 * series rows in the HYC workspace.
 *
 * Workflow:
 *   1. pnpm hyc-ftp-paths inspect      # readonly: list HYC series + fleets
 *   2. confirm SERIES_MAPPING below matches the series names from step 1
 *   3. pnpm hyc-ftp-paths plan         # readonly: show proposed diff
 *   4. pnpm hyc-ftp-paths apply        # writes (only fills empty slots)
 *
 * Default policy is "fill empty slots only" — fleets with an existing
 * ftpPaths entry are left alone and logged. Pass `--overwrite` (works
 * with both `plan` and `apply`) to replace existing entries that differ
 * from the CSV; entries that already match the CSV are still no-ops.
 *
 * Replaces the old `update-ftp-paths.py` (removed), which did the same
 * threading against the local .sailscoring files before the app became
 * server-of-record.
 */
import { eq, sql } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDb, getDbClient } from '@/lib/db/client';
import { organization } from '@/lib/db/schema/auth';
import { fleets, series } from '@/lib/db/schema/series';

const HYC_SLUG = 'hyc';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.resolve(
  __dirname,
  '../reference/data/2026-hyc-club-racing/2016_club.csv',
);

/**
 * Per-series mapping of fleet name → CSV row ID. Series are matched by name
 * within the HYC workspace: Sailwave re-imports mint a fresh
 * series UUID each time, so the name is the only stable handle. `seriesName`
 * must match `series.name` exactly — confirm against an `inspect` run.
 *
 * CSV row 2212 (Saturday Cruisers IRC) currently points at the HPH path —
 * looks like a typo in the source CSV. Pass through unchanged; fix in the
 * CSV if/when HYC corrects it.
 */
interface SeriesMapping {
  seriesName: string;     // matched against `series.name`
  fleetCsvIds: Record<string, number>; // fleet name → CSV row id
}

const SERIES_MAPPING: SeriesMapping[] = [
  {
    seriesName: "Tuesdays & Saturdays - Howth 17's - Series 1",
    fleetCsvIds: {
      'Howth 17 HPH': 2202,
      'Howth 17 Scr': 2203,
    },
  },
  {
    seriesName: 'Tuesdays - One Designs - Series 1',
    fleetCsvIds: {
      'Puppeteer HPH': 2198,
      'Puppeteer Scr': 2199,
      'Squib HPH': 2200,
      'Squib Scr': 2201,
    },
  },
  {
    seriesName: 'Wednesdays - Cruisers - Series 1',
    fleetCsvIds: {
      'Division A HPH': 2205,
      'Division A IRC': 2206,
      'Division B HPH': 2207,
      'Division B IRC': 2208,
      'Division C HPH': 2209,
      'Division C IRC': 2210,
    },
  },
  {
    seriesName: 'Thursdays - Dinghies - Series 1',
    fleetCsvIds: {
      PY: 2213,
      Optimist: 2214,
    },
  },
  {
    seriesName: 'Saturday - Cruisers - Series 1',
    fleetCsvIds: {
      'Division B HPH': 2211,
      'Division B IRC': 2212,
      'Division C HPH': 2219,
      'Division C IRC': 2220,
    },
  },
  {
    seriesName: 'Saturdays - One Designs - Series 1',
    fleetCsvIds: {
      'Puppeteer HPH': 2215,
      'Puppeteer Scr': 2216,
      'Squib HPH': 2217,
      'Squib Scr': 2218,
    },
  },
];

function loadPathsByCsvId(csvPath: string): Map<number, string> {
  const text = fs.readFileSync(csvPath, 'utf-8');
  const out = new Map<number, string>();
  for (const line of text.split(/\r?\n/)) {
    const row = line.split(',');
    const idCell = row[0]?.trim();
    if (!idCell || !/^\d+$/.test(idCell)) continue;
    const id = Number.parseInt(idCell, 10);
    const ftpPath = row[row.length - 1]?.trim();
    if (!ftpPath) continue;
    out.set(id, ftpPath);
  }
  return out;
}

async function findHycWorkspace(): Promise<{ id: string; name: string }> {
  const db = getDb();
  const [org] = await db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(eq(organization.slug, HYC_SLUG))
    .limit(1);
  if (!org) {
    throw new Error(`workspace with slug="${HYC_SLUG}" not found`);
  }
  return org;
}

async function inspect(): Promise<void> {
  const db = getDb();
  const workspace = await findHycWorkspace();
  console.log(`workspace ${workspace.name} (${workspace.id})`);

  const seriesRows = await db
    .select({
      id: series.id,
      name: series.name,
      startDate: series.startDate,
      endDate: series.endDate,
      ftpPaths: series.ftpPaths,
    })
    .from(series)
    .where(eq(series.workspaceId, workspace.id))
    .orderBy(series.startDate, series.name);

  for (const s of seriesRows) {
    console.log('');
    console.log(`series ${s.id}`);
    console.log(`  name:       ${s.name}`);
    console.log(`  dates:      ${s.startDate || '?'} → ${s.endDate || '?'}`);
    const existingCount = Object.keys(s.ftpPaths ?? {}).length;
    console.log(`  ftpPaths:   ${existingCount} entries`);
    const fleetRows = await db
      .select({
        id: fleets.id,
        name: fleets.name,
        scoringSystem: fleets.scoringSystem,
        displayOrder: fleets.displayOrder,
      })
      .from(fleets)
      .where(eq(fleets.seriesId, s.id))
      .orderBy(fleets.displayOrder);
    for (const f of fleetRows) {
      const existing = (s.ftpPaths ?? {})[f.id];
      const tag = existing ? ` ← ${existing}` : '';
      console.log(
        `    fleet ${f.id}  ${f.name} (${f.scoringSystem})${tag}`,
      );
    }
  }
}

interface PlannedUpdate {
  seriesId: string;
  seriesName: string;
  before: Record<string, string>;
  after: Record<string, string>;
  changes: Array<{ fleetId: string; fleetName: string; from?: string; to: string }>;
  skipped: Array<{ fleetId: string; fleetName: string; existing: string; wanted: string }>;
  warnings: string[];
}

async function buildPlan(overwrite: boolean): Promise<PlannedUpdate[]> {
  if (SERIES_MAPPING.length === 0) {
    throw new Error(
      'SERIES_MAPPING is empty — run `inspect` first and fill it in.',
    );
  }
  const db = getDb();
  const workspace = await findHycWorkspace();
  const pathsByCsvId = loadPathsByCsvId(CSV_PATH);

  // Resolve series by name within the workspace. Sailwave re-imports mint a
  // fresh UUID each time, so name is the only stable handle. Flag duplicate
  // names so we never silently thread paths onto the wrong (e.g. stale) row.
  const seriesRows = await db
    .select({ id: series.id, name: series.name, ftpPaths: series.ftpPaths })
    .from(series)
    .where(eq(series.workspaceId, workspace.id));
  const seriesByName = new Map<string, (typeof seriesRows)[number]>();
  const duplicateNames = new Set<string>();
  for (const row of seriesRows) {
    if (seriesByName.has(row.name)) duplicateNames.add(row.name);
    seriesByName.set(row.name, row);
  }

  const plans: PlannedUpdate[] = [];
  for (const m of SERIES_MAPPING) {
    if (duplicateNames.has(m.seriesName)) {
      throw new Error(
        `multiple series named "${m.seriesName}" in HYC workspace — ` +
          'cannot resolve by name; remove the stale duplicate(s) first',
      );
    }
    const s = seriesByName.get(m.seriesName);
    if (!s) {
      throw new Error(
        `series "${m.seriesName}" not found in HYC workspace ` +
          `(known: ${[...seriesByName.keys()].join(', ')})`,
      );
    }
    const fleetRows = await db
      .select({ id: fleets.id, name: fleets.name })
      .from(fleets)
      .where(eq(fleets.seriesId, s.id));
    const fleetIdByName = new Map(fleetRows.map((f) => [f.name, f.id]));

    const before: Record<string, string> = { ...(s.ftpPaths ?? {}) };
    const after: Record<string, string> = { ...before };
    const changes: PlannedUpdate['changes'] = [];
    const skipped: PlannedUpdate['skipped'] = [];
    const warnings: string[] = [];

    for (const [fleetName, csvId] of Object.entries(m.fleetCsvIds)) {
      const fleetId = fleetIdByName.get(fleetName);
      if (!fleetId) {
        warnings.push(
          `fleet "${fleetName}" not found in series ${m.seriesName} ` +
            `(known: ${[...fleetIdByName.keys()].join(', ')})`,
        );
        continue;
      }
      const wanted = pathsByCsvId.get(csvId);
      if (!wanted) {
        warnings.push(`CSV row ${csvId} (fleet "${fleetName}") has no path`);
        continue;
      }
      const existing = before[fleetId];
      if (existing === wanted) {
        // Already matches CSV; no-op regardless of --overwrite.
        skipped.push({ fleetId, fleetName, existing, wanted });
        continue;
      }
      if (existing && !overwrite) {
        skipped.push({ fleetId, fleetName, existing, wanted });
        continue;
      }
      after[fleetId] = wanted;
      changes.push({ fleetId, fleetName, from: existing, to: wanted });
    }

    plans.push({
      seriesId: s.id,
      seriesName: m.seriesName,
      before,
      after,
      changes,
      skipped,
      warnings,
    });
  }
  return plans;
}

function printPlan(plans: PlannedUpdate[]): void {
  for (const p of plans) {
    console.log('');
    console.log(`series ${p.seriesName} (${p.seriesId})`);
    console.log(`  before: ${Object.keys(p.before).length} entries`);
    console.log(`  after:  ${Object.keys(p.after).length} entries`);
    if (p.changes.length === 0) {
      console.log('  no changes');
    } else {
      for (const c of p.changes) {
        if (c.from) {
          console.log(
            `  * ${c.fleetName} (${c.fleetId}) ${c.from} → ${c.to} (overwrite)`,
          );
        } else {
          console.log(`  + ${c.fleetName} (${c.fleetId}) → ${c.to}`);
        }
      }
    }
    for (const s of p.skipped) {
      if (s.existing === s.wanted) {
        console.log(
          `  ~ ${s.fleetName} (${s.fleetId}) already has ${s.existing} (matches CSV)`,
        );
      } else {
        console.log(
          `  ~ ${s.fleetName} (${s.fleetId}) already has ${s.existing}, ` +
            `CSV wants ${s.wanted} (pass --overwrite to replace)`,
        );
      }
    }
    for (const w of p.warnings) {
      console.log(`  ! ${w}`);
    }
  }
}

async function apply(plans: PlannedUpdate[]): Promise<void> {
  const db = getDb();
  let updated = 0;
  for (const p of plans) {
    if (p.changes.length === 0) continue;
    const [row] = await db
      .update(series)
      .set({
        ftpPaths: p.after,
        version: sql`${series.version} + 1`,
        updatedAt: sql`now()`,
        lastModifiedAt: sql`now()`,
      })
      .where(eq(series.id, p.seriesId))
      .returning({ id: series.id, version: series.version });
    if (!row) {
      throw new Error(`update returned no rows for series ${p.seriesId}`);
    }
    updated += 1;
    console.log(
      `applied ${p.changes.length} path(s) to ${p.seriesName} ` +
        `(${p.seriesId}); version now ${row.version}`,
    );
  }
  console.log('');
  console.log(`done — updated ${updated} series row(s)`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const overwrite = args.includes('--overwrite');
  const cmd = args.find((a) => !a.startsWith('--'));
  try {
    if (cmd === 'inspect') {
      await inspect();
    } else if (cmd === 'plan') {
      const plans = await buildPlan(overwrite);
      printPlan(plans);
    } else if (cmd === 'apply') {
      const plans = await buildPlan(overwrite);
      printPlan(plans);
      const hasWarnings = plans.some((p) => p.warnings.length > 0);
      if (hasWarnings) {
        throw new Error('warnings present — resolve before applying');
      }
      console.log('');
      console.log(overwrite ? 'applying (with --overwrite)...' : 'applying...');
      await apply(plans);
    } else {
      console.error(
        'usage: pnpm hyc-ftp-paths <inspect|plan|apply> [--overwrite]',
      );
      process.exitCode = 2;
    }
  } finally {
    await getDbClient().end();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
