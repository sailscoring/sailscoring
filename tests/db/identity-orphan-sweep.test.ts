// @vitest-environment node

/**
 * The sweep that runs after a series or competitor delete: an app identity
 * left with no competitor rows goes, while one still linked stays, and an
 * archive identity is left for the next archive ingest to judge — it may be
 * a ranking-only sailor the manifest still wants.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import { sweepOrphanIdentitiesBestEffort } from '@/lib/competitor-identity-reconcile';
import * as schema from '@/lib/db/schema';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('sweepOrphanIdentitiesBestEffort', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId!: string;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_sweep_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'orphan-sweep-test',
      slug: `sweep-${workspaceId.slice(10, 18)}`,
      createdAt: new Date(),
    });
  });

  afterAll(async () => {
    await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    await sql.end();
  });

  test('removes app identities a deleted series left behind, and nothing else', async () => {
    const kept = uuid();
    const sample = uuid();
    const sampleId = uuid();
    await db.insert(schema.series).values([
      { id: kept, workspaceId, name: 'Nationals', startDate: '2026-08-22', displayOrder: 0 },
      { id: sample, workspaceId, name: 'Sample Series', startDate: '2026-05-01', displayOrder: 1 },
    ]);
    const competitor = async (seriesId: string, name: string) => {
      const id = uuid();
      await db.insert(schema.competitors).values({
        id,
        seriesId,
        workspaceId,
        fleetIds: [],
        sailNumber: '1',
        names: [name],
        clubs: [],
        gender: '',
        age: null,
      });
      return id;
    };
    const both = await competitor(kept, 'Tim Norwood');
    const bothInSample = await competitor(sample, 'Tim Norwood');
    const onlyInSample = await competitor(sample, 'Sample Sailor');

    const [sharedId, sampleOnlyId, archiveId] = [uuid(), uuid(), uuid()];
    await db.insert(schema.competitorIdentities).values([
      { id: sharedId, workspaceId, label: 'Tim Norwood', slug: `tim-norwood-${sharedId.slice(0, 4)}` },
      { id: sampleOnlyId, workspaceId, label: 'Sample Sailor', slug: `sample-sailor-${sampleOnlyId.slice(0, 4)}` },
      { id: archiveId, workspaceId, label: 'Ranked Sailor', slug: `ranked-sailor-${archiveId.slice(0, 4)}`, managedBy: 'archive' },
    ]);
    await db.insert(schema.competitorIdentityLinks).values([
      { competitorId: both, identityId: sharedId, workspaceId },
      { competitorId: bothInSample, identityId: sharedId, workspaceId },
      { competitorId: onlyInSample, identityId: sampleOnlyId, workspaceId },
    ]);

    await db.delete(schema.series).where(eq(schema.series.id, sample));
    await sweepOrphanIdentitiesBestEffort(workspaceId, db);

    const left = await db
      .select({ id: schema.competitorIdentities.id })
      .from(schema.competitorIdentities)
      .where(eq(schema.competitorIdentities.workspaceId, workspaceId));
    expect(left.map((r) => r.id).sort()).toEqual([sharedId, archiveId].sort());
  });
});
