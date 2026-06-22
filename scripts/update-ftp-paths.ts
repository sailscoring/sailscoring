/**
 * Thread per-fleet FTP upload paths onto series rows in a workspace.
 *
 * Generic over workspace and club: it takes the paths as input rather than
 * knowing where they come from. A caller (e.g. `../hyc-archive/scripts/
 * ftp-paths.ts`) resolves its own catalogue into the JSON payload below and
 * hands it here; this script owns the DB layer and does the threading.
 *
 * Workflow:
 *   1. pnpm update-ftp-paths inspect --workspace <slug>   # readonly: list series + fleets
 *   2. build the payload (see shape below) from your catalogue
 *   3. pnpm update-ftp-paths plan  --input paths.json     # readonly: show proposed diff
 *   4. pnpm update-ftp-paths apply --input paths.json     # writes (only fills empty slots)
 *
 * Default policy is "fill empty slots only" — fleets with an existing ftpPaths
 * entry are left alone and logged. Pass `--overwrite` (works with both `plan`
 * and `apply`) to replace existing entries that differ from the payload;
 * entries that already match are still no-ops.
 *
 * Payload shape (`--input` JSON):
 *   {
 *     "workspace": "hyc",
 *     "series": [
 *       { "name": "Tuesdays - One Designs - Series 1",
 *         "fleetPaths": { "Puppeteer HPH": "/reshyc/...", "Puppeteer Scr": "..." } }
 *     ]
 *   }
 * Series are matched by name within the workspace; fleets by name within the
 * series. Names must match exactly — confirm against an `inspect` run.
 */
import { eq, sql } from 'drizzle-orm';
import fs from 'node:fs';

import { getDb, getDbClient } from '@/lib/db/client';
import { organization } from '@/lib/db/schema/auth';
import { fleets, series } from '@/lib/db/schema/series';

interface SeriesPaths {
  name: string; // matched against `series.name`
  fleetPaths: Record<string, string>; // fleet name → FTP path
}

interface Payload {
  workspace: string; // organization slug
  series: SeriesPaths[];
}

function loadPayload(inputPath: string): Payload {
  const raw = JSON.parse(fs.readFileSync(inputPath, 'utf-8')) as unknown;
  if (
    !raw ||
    typeof raw !== 'object' ||
    typeof (raw as Payload).workspace !== 'string' ||
    !Array.isArray((raw as Payload).series)
  ) {
    throw new Error(
      `${inputPath}: expected { workspace: string, series: SeriesPaths[] }`,
    );
  }
  return raw as Payload;
}

async function findWorkspace(slug: string): Promise<{ id: string; name: string }> {
  const db = getDb();
  const [org] = await db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(eq(organization.slug, slug))
    .limit(1);
  if (!org) {
    throw new Error(`workspace with slug="${slug}" not found`);
  }
  return org;
}

async function inspect(slug: string): Promise<void> {
  const db = getDb();
  const workspace = await findWorkspace(slug);
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

async function buildPlan(
  payload: Payload,
  overwrite: boolean,
): Promise<PlannedUpdate[]> {
  if (payload.series.length === 0) {
    throw new Error('payload has no series');
  }
  const db = getDb();
  const workspace = await findWorkspace(payload.workspace);

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
  for (const m of payload.series) {
    if (duplicateNames.has(m.name)) {
      throw new Error(
        `multiple series named "${m.name}" in workspace — ` +
          'cannot resolve by name; remove the stale duplicate(s) first',
      );
    }
    const s = seriesByName.get(m.name);
    if (!s) {
      throw new Error(
        `series "${m.name}" not found in workspace ` +
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

    for (const [fleetName, wanted] of Object.entries(m.fleetPaths)) {
      const fleetId = fleetIdByName.get(fleetName);
      if (!fleetId) {
        warnings.push(
          `fleet "${fleetName}" not found in series ${m.name} ` +
            `(known: ${[...fleetIdByName.keys()].join(', ')})`,
        );
        continue;
      }
      if (!wanted) {
        warnings.push(`fleet "${fleetName}" has an empty path`);
        continue;
      }
      const existing = before[fleetId];
      if (existing === wanted) {
        // Already matches payload; no-op regardless of --overwrite.
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
      seriesName: m.name,
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
          `  ~ ${s.fleetName} (${s.fleetId}) already has ${s.existing} (matches payload)`,
        );
      } else {
        console.log(
          `  ~ ${s.fleetName} (${s.fleetId}) already has ${s.existing}, ` +
            `payload wants ${s.wanted} (pass --overwrite to replace)`,
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

function flagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const overwrite = args.includes('--overwrite');
  const cmd = args.find((a) => !a.startsWith('--'));
  try {
    if (cmd === 'inspect') {
      const slug = flagValue(args, '--workspace');
      if (!slug) {
        throw new Error('inspect requires --workspace <slug>');
      }
      await inspect(slug);
    } else if (cmd === 'plan' || cmd === 'apply') {
      const input = flagValue(args, '--input');
      if (!input) {
        throw new Error(`${cmd} requires --input <file>`);
      }
      const payload = loadPayload(input);
      const plans = await buildPlan(payload, overwrite);
      printPlan(plans);
      if (cmd === 'apply') {
        const hasWarnings = plans.some((p) => p.warnings.length > 0);
        if (hasWarnings) {
          throw new Error('warnings present — resolve before applying');
        }
        console.log('');
        console.log(overwrite ? 'applying (with --overwrite)...' : 'applying...');
        await apply(plans);
      }
    } else {
      console.error(
        'usage: pnpm update-ftp-paths <inspect --workspace <slug> | ' +
          'plan --input <file> | apply --input <file>> [--overwrite]',
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
