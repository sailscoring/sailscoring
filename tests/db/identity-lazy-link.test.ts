// @vitest-environment node

/**
 * Lazy on-demand identity population (#222): `relinkIdentitiesAfterWrite` runs
 * the batch reconcile pass after competitor writes, gated on the workspace's
 * own `competitor-identity` flag. The behaviours that matter: the gate (no
 * identities grow in an unadopted workspace), the no-op probe (nothing
 * unlinked → nothing written), auto-link into an existing identity on a
 * corroborated match, identity creation for a new sailor, and the
 * never-re-merge-a-human-split conflict rule.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import { collectStaleLinks, relinkIdentitiesAfterWrite } from '@/lib/competitor-identity-reconcile';
import { removeIdentityLink } from '@/lib/competitor-identity-repository';
import * as schema from '@/lib/db/schema';
import { serializeOrgMetadata } from '@/lib/features';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('relinkIdentitiesAfterWrite', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId!: string; // spine adopted
  let coldWorkspaceId!: string; // spine not adopted
  const seriesByYear: Record<number, string> = {};
  let coldSeriesId!: string;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_lazy_${uuid().replace(/-/g, '')}`;
    coldWorkspaceId = `org_cold_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values([
      {
        id: workspaceId,
        name: 'lazy-link-test',
        slug: `lazy-${workspaceId.slice(9, 17)}`,
        metadata: serializeOrgMetadata({
          kind: 'club',
          enabledFeatures: ['competitor-identity'],
          disabledFeatures: [],
          seededFeatureSamples: [],
        }),
        createdAt: new Date(),
      },
      {
        id: coldWorkspaceId,
        name: 'lazy-link-cold',
        slug: `cold-${coldWorkspaceId.slice(9, 17)}`,
        createdAt: new Date(),
      },
    ]);
    for (const year of [2023, 2024, 2025]) {
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
    coldSeriesId = uuid();
    await db.insert(schema.series).values({
      id: coldSeriesId,
      workspaceId: coldWorkspaceId,
      name: 'Cold Series',
      startDate: '2025-05-01',
      displayOrder: 0,
    });
  });

  afterAll(async () => {
    for (const id of [workspaceId, coldWorkspaceId]) {
      await db.delete(schema.organization).where(eq(schema.organization.id, id));
    }
    await sql?.end();
  });

  async function addCompetitor(p: {
    workspaceId?: string;
    seriesId: string;
    names: string[];
    sailNumber: string;
    club?: string;
  }): Promise<string> {
    const id = uuid();
    await db.insert(schema.competitors).values({
      id,
      seriesId: p.seriesId,
      workspaceId: p.workspaceId ?? workspaceId,
      fleetIds: [],
      sailNumber: p.sailNumber,
      names: p.names,
      club: p.club ?? '',
      gender: '',
      age: null,
    });
    return id;
  }

  async function identityIdOf(competitorId: string): Promise<string | null> {
    const [row] = await db
      .select({ identityId: schema.competitorIdentityLinks.identityId })
      .from(schema.competitorIdentityLinks)
      .where(eq(schema.competitorIdentityLinks.competitorId, competitorId));
    return row?.identityId ?? null;
  }

  test('gated: an unadopted workspace grows no identities', async () => {
    await addCompetitor({
      workspaceId: coldWorkspaceId,
      seriesId: coldSeriesId,
      names: ['Aoife Murphy'],
      sailNumber: 'IRL1200',
    });
    expect(await relinkIdentitiesAfterWrite(coldWorkspaceId, db)).toBeNull();
    const identities = await db
      .select({ id: schema.competitorIdentities.id })
      .from(schema.competitorIdentities)
      .where(eq(schema.competitorIdentities.workspaceId, coldWorkspaceId));
    expect(identities).toHaveLength(0);
  });

  test('creates an identity for a new sailor, then links a corroborated recurrence', async () => {
    const first = await addCompetitor({
      seriesId: seriesByYear[2023],
      names: ['Holly Cantwell'],
      sailNumber: 'IRL1641',
      club: 'RSGYC',
    });
    const r1 = await relinkIdentitiesAfterWrite(workspaceId, db);
    expect(r1).not.toBeNull();
    expect(r1!.identitiesCreated).toBe(1);
    const identityId = await identityIdOf(first);
    expect(identityId).not.toBeNull();
    const [identity] = await db
      .select()
      .from(schema.competitorIdentities)
      .where(eq(schema.competitorIdentities.id, identityId!));
    expect(identity.label).toBe('Holly Cantwell');
    expect(identity.slug).toMatch(/^holly-cantwell-/);

    // Same name + same sail in a later series → linked to the same identity,
    // no second identity minted.
    const second = await addCompetitor({
      seriesId: seriesByYear[2024],
      names: ['Holly Cantwell'],
      sailNumber: 'IRL1641',
    });
    const r2 = await relinkIdentitiesAfterWrite(workspaceId, db);
    expect(r2).not.toBeNull();
    expect(r2!.identitiesCreated).toBe(0);
    expect(r2!.competitorsLinked).toBe(1);
    expect(await identityIdOf(second)).toBe(identityId);
  });

  test('no-op probe: nothing unlinked → null, corpus untouched', async () => {
    expect(await relinkIdentitiesAfterWrite(workspaceId, db)).toBeNull();
  });

  test('a name match with no corroboration stays a separate identity', async () => {
    // Same name, different sail, different club, no ages: the weak edge is a
    // review suggestion, never an auto-link.
    const namesake = await addCompetitor({
      seriesId: seriesByYear[2025],
      names: ['Holly Cantwell'],
      sailNumber: 'IRL9999',
      club: 'TBSC',
    });
    const r = await relinkIdentitiesAfterWrite(workspaceId, db);
    expect(r).not.toBeNull();
    expect(r!.identitiesCreated).toBe(1);
    const namesakeIdentity = await identityIdOf(namesake);
    const original = await db
      .select({ id: schema.competitorIdentityLinks.identityId })
      .from(schema.competitorIdentityLinks)
      .innerJoin(
        schema.competitors,
        eq(schema.competitors.id, schema.competitorIdentityLinks.competitorId),
      )
      .where(eq(schema.competitors.seriesId, seriesByYear[2023]));
    expect(namesakeIdentity).not.toBeNull();
    expect(namesakeIdentity).not.toBe(original[0].id);
  });

  test('never re-merges across two confirmed identities (human split sticks)', async () => {
    // Two confirmed identities that the signals would fuse (same name + sail),
    // plus a fresh unlinked row matching both: the cluster spans two confirmed
    // identities, so it's a conflict — the new row stays unlinked for review.
    const idA = uuid();
    const idB = uuid();
    await db.insert(schema.competitorIdentities).values([
      { id: idA, workspaceId, label: 'Jack Keating', slug: `jack-keating-${uuid().slice(0, 4)}`, sailNumber: '1605' },
      { id: idB, workspaceId, label: 'Jack Keating', slug: `jack-keating-${uuid().slice(0, 4)}`, sailNumber: '1605' },
    ]);
    const rowA = await addCompetitor({
      seriesId: seriesByYear[2023],
      names: ['Jack Keating'],
      sailNumber: '1605',
    });
    const rowB = await addCompetitor({
      seriesId: seriesByYear[2024],
      names: ['Jack Keating'],
      sailNumber: '1605',
    });
    await db.insert(schema.competitorIdentityLinks).values([
      { competitorId: rowA, identityId: idA, workspaceId },
      { competitorId: rowB, identityId: idB, workspaceId },
    ]);

    const fresh = await addCompetitor({
      seriesId: seriesByYear[2025],
      names: ['Jack Keating'],
      sailNumber: '1605',
    });
    const r = await relinkIdentitiesAfterWrite(workspaceId, db);
    expect(r).not.toBeNull();
    expect(r!.conflictsSkipped).toBeGreaterThanOrEqual(1);
    expect(await identityIdOf(fresh)).toBeNull();
    // Neither confirmed link moved.
    expect(await identityIdOf(rowA)).toBe(idA);
    expect(await identityIdOf(rowB)).toBe(idB);
  });

  test('a co-owned entry links each person to their own identity (#316)', async () => {
    // Two established single-owner arcs...
    const j1 = await addCompetitor({
      seriesId: seriesByYear[2023],
      names: ['Joseph Murtagh'],
      sailNumber: 'IRL808',
      club: 'HYC',
    });
    const m1 = await addCompetitor({
      seriesId: seriesByYear[2023],
      names: ['Maeve Murtagh'],
      sailNumber: 'IRL808',
      club: 'HYC',
    });
    await relinkIdentitiesAfterWrite(workspaceId, db);
    const jId = await identityIdOf(j1);
    const mId = await identityIdOf(m1);
    expect(jId).not.toBeNull();
    expect(mId).not.toBeNull();
    expect(jId).not.toBe(mId);

    // ...then a co-owned entry on the same hull: both arcs claim it.
    const coOwned = await addCompetitor({
      seriesId: seriesByYear[2024],
      names: ['Joseph Murtagh', 'Maeve Murtagh'],
      sailNumber: 'IRL808',
      club: 'HYC',
    });
    const r = await relinkIdentitiesAfterWrite(workspaceId, db);
    expect(r).not.toBeNull();
    const links = await db
      .select({ identityId: schema.competitorIdentityLinks.identityId })
      .from(schema.competitorIdentityLinks)
      .where(eq(schema.competitorIdentityLinks.competitorId, coOwned));
    expect(new Set(links.map((l) => l.identityId))).toEqual(new Set([jId, mId]));
  });

  test('fragment names need sail or age corroboration — club alone only suggests', async () => {
    // A whole-row sailor at a club...
    const solo = await addCompetitor({
      seriesId: seriesByYear[2023],
      names: ['Nuala Brennan'],
      sailNumber: 'IRL111',
      club: 'RCYC',
    });
    await relinkIdentitiesAfterWrite(workspaceId, db);
    const soloId = await identityIdOf(solo);
    expect(soloId).not.toBeNull();

    // ...and a namesake fragment on a co-owned entry: same club, different
    // boat. Club-only corroboration is demoted for fragments, so this mints
    // a separate identity instead of joining the solo arc.
    const coOwned = await addCompetitor({
      seriesId: seriesByYear[2024],
      names: ['Nuala Brennan', 'Peter Brennan'],
      sailNumber: 'IRL999',
      club: 'RCYC',
    });
    await relinkIdentitiesAfterWrite(workspaceId, db);
    const links = await db
      .select({ identityId: schema.competitorIdentityLinks.identityId })
      .from(schema.competitorIdentityLinks)
      .where(eq(schema.competitorIdentityLinks.competitorId, coOwned));
    expect(links).toHaveLength(2);
    expect(links.map((l) => l.identityId)).not.toContain(soloId);
  });

  test('a membership whose label matches no person surfaces as stale and can be unlinked', async () => {
    // A joined-pair label that shares a surname with a person still gets
    // attributed (initial matching favours continuity); stale is the label
    // that matches nobody — a hand-rename that walked away from the row.
    const jointId = uuid();
    await db.insert(schema.competitorIdentities).values({
      id: jointId,
      workspaceId,
      label: 'Windchaser Syndicate',
      slug: `windchaser-syndicate-${jointId.slice(0, 4)}`,
    });
    const row = await addCompetitor({
      seriesId: seriesByYear[2025],
      names: ['Tomás Sharkey', 'Vera Sharkey'],
      sailNumber: 'IRL404',
    });
    await db.insert(schema.competitorIdentityLinks).values({
      competitorId: row,
      identityId: jointId,
      workspaceId,
    });

    const stale = await collectStaleLinks(db, workspaceId);
    const mine = stale.filter((l) => l.competitorId === row);
    expect(mine).toHaveLength(1);
    expect(mine[0].identityId).toBe(jointId);
    expect(mine[0].identityLabel).toBe('Windchaser Syndicate');

    expect(await removeIdentityLink(workspaceId, row, jointId)).toBe(true);
    expect(await removeIdentityLink(workspaceId, row, jointId)).toBe(false);
    expect((await collectStaleLinks(db, workspaceId)).filter((l) => l.competitorId === row)).toHaveLength(0);
  });
});
