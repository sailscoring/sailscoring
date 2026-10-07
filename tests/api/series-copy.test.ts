// @vitest-environment node

/**
 * `copySeries` carries a series whole: copied into another workspace, it
 * exports to the same .sailscoring file as its source, save for what a copy
 * deliberately leaves behind (publishing destinations, notes, the results
 * status). The fixture is the split-fleet championship sample, dressed with
 * the scoring inputs a hand-listed copy once dropped — split-fleet config and
 * rounds, per-start stages, exclusions, seeds, rating overrides.
 *
 * Skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, inArray } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as schema from '@/lib/db/schema';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import * as series from '@/lib/api-handlers/series';
import { buildSeriesFile, parseSeriesFile, type SeriesFile } from '@/lib/series-file';
import { seriesFileReposFor } from '@/lib/postgres-repository';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function uuid() {
  return crypto.randomUUID();
}

/**
 * A file with its ids swapped for natural keys (fleet name, sail number, race
 * number, sub-series name) and its unordered lists sorted, so two exports of
 * the same series compare equal even though every row id was re-minted.
 */
function normalise(file: SeriesFile): unknown {
  const names = new Map<string, string>();
  for (const f of file.fleets) names.set(f.id, `fleet:${f.name}`);
  for (const c of file.competitors) names.set(c.id, `competitor:${c.sailNumber}`);
  for (const r of file.races) names.set(r.id, `race:${r.raceNumber}`);
  for (const ss of file.subSeries ?? []) names.set(ss.id, `sub-series:${ss.name}`);
  for (const m of file.marks ?? []) names.set(m.id, `mark:${m.name}`);
  for (const c of file.courses ?? []) names.set(c.id, `course:${c.name}`);

  const rename = (v: unknown): unknown => {
    if (typeof v === 'string') return names.get(v) ?? (UUID.test(v) ? '<id>' : v);
    if (Array.isArray(v)) return v.map(rename);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [names.get(k) ?? k, rename(x)]),
      );
    }
    return v;
  };
  const by = <T>(key: (x: T) => string) => (a: T, b: T) => key(a).localeCompare(key(b));

  const { exportedAt: _e, seriesId: _s, ...rest } = file;
  const out = rename({ ...rest, series: { ...file.series, id: undefined, name: undefined } }) as SeriesFile;
  out.fleets.sort(by((f) => f.name));
  out.competitors.sort(by((c) => c.sailNumber));
  out.races.sort((a, b) => a.raceNumber - b.raceNumber);
  for (const r of out.races) {
    r.starts.sort(by((s) => `${s.startTime}|${s.fleetIds.join(',')}`));
    r.finishes.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    r.ratingOverrides?.sort(by((o) => `${o.competitorId}|${o.field}`));
  }
  out.tcfHistory?.sort(by((h) => `${h.raceId}|${h.competitorId}|${h.fleetId}`));
  return out;
}

describe.skipIf(skip)('series copy', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  const userId = `copy-user-${uuid().slice(0, 8)}`;
  const workspaceA = `org_cpa_${uuid().replace(/-/g, '')}`;
  const workspaceB = `org_cpb_${uuid().replace(/-/g, '')}`;
  let ctxA: WorkspaceContext;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    process.env.DATABASE_URL = DATABASE_URL;
    await db.insert(schema.user).values({
      id: userId,
      name: 'Copy User',
      email: `${userId}@sailscoring.test`,
    });
    for (const id of [workspaceA, workspaceB]) {
      await db.insert(schema.organization).values({
        id,
        name: id,
        slug: `cp-${id.slice(8, 20)}`,
        createdAt: new Date(),
      });
      await db.insert(schema.member).values({
        id: `mem_${uuid().replace(/-/g, '')}`,
        organizationId: id,
        userId,
        role: 'owner',
        createdAt: new Date(),
      });
    }
    ctxA = {
      userId,
      email: `${userId}@sailscoring.test`,
      workspaceId: workspaceA,
      workspaceSlug: 'cp-a',
      role: 'owner',
      features: [],
    };
  });

  afterAll(async () => {
    await db.delete(schema.organization).where(inArray(schema.organization.id, [workspaceA, workspaceB]));
    await db.delete(schema.user).where(eq(schema.user.id, userId));
    await sql?.end();
  });

  test('a copy into another workspace exports as its source, minus the publication state', async () => {
    const file = parseSeriesFile(
      readFileSync(join(__dirname, '..', '..', 'lib', 'sample-series', 'championship.sailscoring'), 'utf8'),
    );
    expect(file.splitFleets?.rounds.length).toBeGreaterThan(0);
    const [c0, c1, c2] = file.competitors;
    c0.excluded = true;
    c1.entryNumber = '42';
    c2.bowNumber = '7';
    file.fleets[0].color = '#0055aa';
    file.races[0].ratingOverrides = [
      { id: uuid(), competitorId: c1.id, field: 'pyNumber', value: 1010 },
    ];
    file.series.prizes = [{
      id: uuid(), name: 'Gold', recipientCount: 3,
      clauses: [{ kind: 'fleet', fleetId: file.fleets[0].id }],
    }];
    // What a copy leaves behind.
    Object.assign(file.series, {
      ftpHost: 'ftp.example.com',
      ftpPath: '/results',
      publishMode: 'ftp',
      seriesNote: 'Corrected 16:40',
      pageNotes: [{ page: 'overall', text: 'Q1 revised', updatedAt: 1 }],
      resultsStatus: 'final',
      finalisedAt: Date.UTC(2026, 8, 1),
    });

    const { id: srcId } = await series.importSeries(ctxA, { content: JSON.stringify(file) });
    const { id: copyId } = await series.copySeries(ctxA, srcId, {
      targetWorkspaceId: workspaceB,
      name: 'Championship copy',
    });

    const source = await buildSeriesFile(srcId, seriesFileReposFor({ workspaceId: workspaceA }));
    const copy = await buildSeriesFile(copyId, seriesFileReposFor({ workspaceId: workspaceB }));

    expect(copy.series.name).toBe('Championship copy');
    expect(copy.splitFleets?.rounds).toHaveLength(source.splitFleets!.rounds.length);

    const expected = normalise(source) as SeriesFile;
    expected.series = {
      ...expected.series,
      ftpHost: '',
      ftpPath: '',
      publishMode: 'sailscoring',
      seriesNote: undefined,
      pageNotes: undefined,
      resultsStatus: undefined,
      finalisedAt: undefined,
    };
    expect(JSON.parse(JSON.stringify(normalise(copy)))).toEqual(
      JSON.parse(JSON.stringify(expected)),
    );
  });
});
