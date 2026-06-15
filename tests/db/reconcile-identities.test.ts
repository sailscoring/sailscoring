// @vitest-environment node

/**
 * The reconcile pass's DB side (#212): collectClusterInputs reads competitors
 * joined to their series for the race year, applyClusters writes identities and
 * stamps competitors.identity_id in one transaction. The behaviour that pure
 * tests can't reach is the SQL: identity creation, link stamping, and — the
 * part that matters most for a re-runnable backfill — idempotency.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import { clusterCompetitors } from '@/lib/competitor-identity-cluster';
import * as schema from '@/lib/db/schema';
import { applyClusters, collectClusterInputs } from '@/scripts/reconcile-identities';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('reconcile-identities apply path', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId!: string;
  const seriesByYear: Record<number, string> = {};

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_rec_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'reconcile-test',
      slug: `rec-${workspaceId.slice(8, 16)}`,
      createdAt: new Date(),
    });
    for (const year of [2018, 2021, 2022]) {
      const id = uuid();
      seriesByYear[year] = id;
      await db.insert(schema.series).values({
        id,
        workspaceId,
        name: `Series ${year}`,
        startDate: `${year}-05-01`,
        displayOrder: year,
      });
    }
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  async function addCompetitor(p: {
    year: number;
    name: string;
    sailNumber: string;
    club: string;
  }): Promise<string> {
    const id = uuid();
    await db.insert(schema.competitors).values({
      id,
      seriesId: seriesByYear[p.year],
      workspaceId,
      fleetIds: [],
      sailNumber: p.sailNumber,
      name: p.name,
      club: p.club,
      gender: '',
      age: null,
    });
    return id;
  }

  async function identityIdOf(competitorId: string): Promise<string | null> {
    const [row] = await db
      .select({ identityId: schema.competitors.identityId })
      .from(schema.competitors)
      .where(eq(schema.competitors.id, competitorId));
    return row?.identityId ?? null;
  }

  async function identityCount(): Promise<number> {
    const rows = await db
      .select({ id: schema.competitorIdentities.id })
      .from(schema.competitorIdentities)
      .where(eq(schema.competitorIdentities.workspaceId, workspaceId));
    return rows.length;
  }

  async function reconcile() {
    const inputs = await collectClusterInputs(db, workspaceId);
    const result = clusterCompetitors(inputs);
    return applyClusters(db, workspaceId, result);
  }

  let aoife1!: string;
  let aoife2!: string;

  test('first pass creates one identity and links both rows', async () => {
    aoife1 = await addCompetitor({ year: 2018, name: 'Aoife Murphy', sailNumber: 'IRL1200', club: 'RCYC' });
    aoife2 = await addCompetitor({ year: 2021, name: 'Aoife Murphy', sailNumber: 'IRL1599', club: 'RCYC' });

    const applied = await reconcile();
    expect(applied.identitiesCreated).toBe(1);
    expect(applied.competitorsLinked).toBe(2);

    const id1 = await identityIdOf(aoife1);
    const id2 = await identityIdOf(aoife2);
    expect(id1).not.toBeNull();
    expect(id1).toBe(id2);

    // Identity denormalises from the most-recent linked row.
    const [identity] = await db
      .select()
      .from(schema.competitorIdentities)
      .where(eq(schema.competitorIdentities.id, id1!));
    expect(identity.label).toBe('Aoife Murphy');
    expect(identity.sailNumber).toBe('IRL1599');
  });

  test('re-running is idempotent: no new identities, no new links', async () => {
    const before = await identityCount();
    const applied = await reconcile();
    expect(applied.identitiesCreated).toBe(0);
    expect(applied.competitorsLinked).toBe(0);
    expect(await identityCount()).toBe(before);
  });

  test('a newly added series links into the existing identity', async () => {
    const existing = await identityIdOf(aoife1);
    const aoife3 = await addCompetitor({ year: 2022, name: 'Aoife Murphy', sailNumber: 'IRL1599', club: 'RCYC' });

    const applied = await reconcile();
    expect(applied.identitiesCreated).toBe(0); // joins the existing identity
    expect(applied.competitorsLinked).toBe(1); // only the new row
    expect(await identityIdOf(aoife3)).toBe(existing);
  });
});
