// @vitest-environment node

/**
 * The reconcile pass's DB side (#212): collectClusterInputs reads competitors
 * joined to their series for the race year, applyClusters writes identities and
 * stamps competitors.identity_id in one transaction. The behaviour that pure
 * tests can't reach is the SQL: identity creation, link stamping, and — the
 * part that matters most for a re-runnable backfill — idempotency.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import { clusterCompetitors } from '@/lib/competitor-identity-cluster';
import {
  identityIdForSlug,
  parseManifest,
  planManifestApply,
} from '@/lib/competitor-identity-manifest';
import * as schema from '@/lib/db/schema';
import {
  applyClusters,
  applyManifest,
  collectClusterInputs,
  collectCompetitorIndex,
  ensureSlugs,
  resetIdentities,
} from '@/lib/competitor-identity-reconcile';
import { computeRankingStandings } from '@/lib/ranking-standings';

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
    excluded?: boolean;
  }): Promise<string> {
    const id = uuid();
    await db.insert(schema.competitors).values({
      id,
      seriesId: seriesByYear[p.year],
      workspaceId,
      fleetIds: [],
      sailNumber: p.sailNumber,
      names: [p.name],
      club: p.club,
      gender: '',
      age: null,
      excluded: p.excluded ?? false,
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

  async function identityCount(): Promise<number> {
    const rows = await db
      .select({ id: schema.competitorIdentities.id })
      .from(schema.competitorIdentities)
      .where(eq(schema.competitorIdentities.workspaceId, workspaceId));
    return rows.length;
  }

  async function slugOf(identityId: string): Promise<string | null> {
    const [row] = await db
      .select({ slug: schema.competitorIdentities.slug })
      .from(schema.competitorIdentities)
      .where(eq(schema.competitorIdentities.id, identityId));
    return row?.slug ?? null;
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
    // A vanity slug is minted on create, from the label + a random suffix.
    expect(identity.slug).toMatch(/^aoife-murphy-[a-z2-9]{4}$/);
  });

  test('an excluded competitor neither claims nor mints an identity', async () => {
    // Same name as the linked pair, but on a roster she never entered: the
    // spine must not pull her in, nor invent a second Aoife from her.
    const reserve = await addCompetitor({
      year: 2021, name: 'Aoife Murphy', sailNumber: 'IRL1601', club: 'RCYC', excluded: true,
    });
    const stranger = await addCompetitor({
      year: 2021, name: 'Niamh Byrne', sailNumber: 'IRL1700', club: 'RCYC', excluded: true,
    });
    const before = await identityCount();
    const applied = await reconcile();
    expect(applied.identitiesCreated).toBe(0);
    expect(await identityIdOf(reserve)).toBeNull();
    expect(await identityIdOf(stranger)).toBeNull();
    expect(await identityCount()).toBe(before);
    await db.delete(schema.competitors).where(eq(schema.competitors.id, reserve));
    await db.delete(schema.competitors).where(eq(schema.competitors.id, stranger));
  });

  test('slug is stable across a rename', async () => {
    const id = (await identityIdOf(aoife1))!;
    const slugBefore = await slugOf(id);
    await db
      .update(schema.competitorIdentities)
      .set({ label: 'Aoife M Murphy' })
      .where(eq(schema.competitorIdentities.id, id));
    // ensureSlugs must not re-mint an existing slug, and nothing recomputes it.
    await ensureSlugs(db, workspaceId);
    expect(await slugOf(id)).toBe(slugBefore);
  });

  test('ensureSlugs backfills a pre-slug (null) identity', async () => {
    const legacyId = uuid();
    await db.insert(schema.competitorIdentities).values({
      id: legacyId,
      workspaceId,
      label: 'Legacy Sailor',
      sailNumber: 'IRL1',
      // slug intentionally omitted (null) — predates the column
    });
    expect(await slugOf(legacyId)).toBeNull();
    const filled = await ensureSlugs(db, workspaceId);
    expect(filled).toBe(1);
    expect(await slugOf(legacyId)).toMatch(/^legacy-sailor-[a-z2-9]{4}$/);
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

  test('reset removes identities and clears links, ready for a clean rebuild', async () => {
    expect(await identityCount()).toBeGreaterThan(0);
    const removed = await resetIdentities(db, workspaceId);
    expect(removed).toBeGreaterThan(0);
    expect(await identityCount()).toBe(0);
    expect(await identityIdOf(aoife1)).toBeNull(); // FK SET NULL cleared the link

    // A fresh pass rebuilds from scratch.
    const rebuilt = await reconcile();
    expect(rebuilt.identitiesCreated).toBe(1);
    expect(await identityIdOf(aoife1)).not.toBeNull();
  });
});

describe.skipIf(skip)('reconcile-identities manifest apply path (#218)', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId!: string;
  const seriesByYear: Record<number, string> = {};
  const slugByYear: Record<number, string> = {};

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_man_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'manifest-test',
      slug: `man-${workspaceId.slice(8, 16)}`,
      createdAt: new Date(),
    });
    for (const year of [2018, 2020, 2021]) {
      const id = uuid();
      seriesByYear[year] = id;
      slugByYear[year] = `iodai-event-${year}`;
      await db.insert(schema.series).values({
        id,
        workspaceId,
        name: `Event ${year}`,
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
    club?: string;
  }): Promise<string> {
    const id = uuid();
    await db.insert(schema.competitors).values({
      id,
      seriesId: seriesByYear[p.year],
      workspaceId,
      fleetIds: [],
      sailNumber: p.sailNumber,
      names: [p.name],
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

  /** The series-slug → seriesId map a real manifest would embed. */
  function seriesMap() {
    return Object.fromEntries(
      Object.entries(slugByYear).map(([year, slug]) => [slug, seriesByYear[Number(year)]]),
    );
  }

  async function planFor(manifestObj: unknown) {
    const manifest = parseManifest(JSON.stringify(manifestObj));
    const { index } = await collectCompetitorIndex(db, workspaceId);
    return planManifestApply(
      manifest,
      workspaceId,
      (seriesId, sail) => index.get(`${seriesId}|${sail}`),
    );
  }

  let charlie1!: string;
  let charlie2!: string;

  test('applies a manifest entry under a deterministic, slug-derived id', async () => {
    charlie1 = await addCompetitor({ year: 2018, name: 'Charlie Keating', sailNumber: '1423', club: 'HYC' });
    charlie2 = await addCompetitor({ year: 2020, name: 'Charlie Keating', sailNumber: '1599', club: 'HYC' });

    const plan = await planFor({
      version: 1,
      series: seriesMap(),
      identities: [
        {
          slug: 'charlie-keating-x78q',
          name: 'Charlie Keating',
          club: 'HYC',
          nationality: 'IRL',
          members: [
            ['iodai-event-2018', '1423'],
            ['iodai-event-2020', '1599'],
          ],
        },
      ],
    });
    expect(plan.unresolvedMembers).toEqual([]);

    const res = await applyManifest(db, workspaceId, plan);
    expect(res.identitiesWritten).toBe(1);
    expect(res.competitorsLinked).toBe(2);

    const expectedId = identityIdForSlug(workspaceId, 'charlie-keating-x78q');
    expect(await identityIdOf(charlie1)).toBe(expectedId);
    expect(await identityIdOf(charlie2)).toBe(expectedId);

    const [identity] = await db
      .select()
      .from(schema.competitorIdentities)
      .where(eq(schema.competitorIdentities.id, expectedId));
    expect(identity.slug).toBe('charlie-keating-x78q');
    expect(identity.label).toBe('Charlie Keating');
    expect(identity.sailNumber).toBe('1599'); // last member's sail
    expect(identity.nationality).toBe('IRL');
  });

  test('re-applying is byte-stable: same id, refreshed in place', async () => {
    const before = await db
      .select({ id: schema.competitorIdentities.id })
      .from(schema.competitorIdentities)
      .where(eq(schema.competitorIdentities.workspaceId, workspaceId));

    const plan = await planFor({
      version: 1,
      series: seriesMap(),
      identities: [
        {
          slug: 'charlie-keating-x78q',
          name: 'Charlie Keating',
          members: [
            ['iodai-event-2018', '1423'],
            ['iodai-event-2020', '1599'],
          ],
        },
      ],
    });
    await applyManifest(db, workspaceId, plan);

    const after = await db
      .select({ id: schema.competitorIdentities.id })
      .from(schema.competitorIdentities)
      .where(eq(schema.competitorIdentities.workspaceId, workspaceId));
    expect(after.map((r) => r.id).sort()).toEqual(before.map((r) => r.id).sort());
  });

  test('manifest links are authoritative — they overwrite a prior link', async () => {
    // The auto-pass only fills `identity_id IS NULL` rows; the manifest, by
    // contrast, is the golden record, so it must move an already-linked row.
    const throwaway = uuid();
    await db.insert(schema.competitorIdentities).values({
      id: throwaway,
      workspaceId,
      label: 'Wrong Identity',
      slug: 'wrong-identity-zzzz',
      sailNumber: '1423',
    });
    // Replace charlie1's membership with the wrong identity (the pre-link-table
    // seed overwrote the single FK; replicate that shape).
    await db
      .delete(schema.competitorIdentityLinks)
      .where(eq(schema.competitorIdentityLinks.competitorId, charlie1));
    await db.insert(schema.competitorIdentityLinks).values({
      competitorId: charlie1,
      identityId: throwaway,
      workspaceId,
    });
    expect(await identityIdOf(charlie1)).toBe(throwaway);

    const plan = await planFor({
      version: 1,
      series: seriesMap(),
      identities: [
        {
          slug: 'charlie-keating-x78q',
          name: 'Charlie Keating',
          members: [
            ['iodai-event-2018', '1423'],
            ['iodai-event-2020', '1599'],
          ],
        },
      ],
    });
    await applyManifest(db, workspaceId, plan);

    const expectedId = identityIdForSlug(workspaceId, 'charlie-keating-x78q');
    expect(await identityIdOf(charlie1)).toBe(expectedId); // moved off the throwaway
    expect(await identityIdOf(charlie2)).toBe(expectedId);
  });

  test('reports an unresolved member without dropping the resolved rows', async () => {
    const plan = await planFor({
      version: 1,
      series: seriesMap(),
      identities: [
        {
          slug: 'someone-else-ab12',
          name: 'Someone Else',
          members: [
            ['iodai-event-2018', '1423'], // belongs to Charlie, real row
            ['iodai-event-2021', '9999'], // no such competitor
          ],
        },
      ],
    });
    expect(plan.unresolvedMembers).toEqual([
      { slug: 'someone-else-ab12', seriesSlug: 'iodai-event-2021', sailNumber: '9999', reason: 'no-competitor' },
    ]);
    expect(plan.assignments[0].competitorIds).toHaveLength(1);
  });

  test('disambiguates two sailors sharing a sail in one series by name', async () => {
    // A shared hull / placeholder sail: two competitors, same sail, same series.
    const jess = await addCompetitor({ year: 2021, name: 'Jess Tottenham', sailNumber: '1682' });
    const ellie = await addCompetitor({ year: 2021, name: 'Ellie Tottenham', sailNumber: '1682' });

    const plan = await planFor({
      version: 1,
      series: seriesMap(),
      identities: [
        { slug: 'jess-tottenham-aa11', name: 'Jess Tottenham', members: [['iodai-event-2021', '1682']] },
        { slug: 'ellie-tottenham-bb22', name: 'Ellie Tottenham', members: [['iodai-event-2021', '1682']] },
      ],
    });

    expect(plan.unresolvedMembers).toEqual([]);
    const byslug = Object.fromEntries(plan.assignments.map((a) => [a.slug, a.competitorIds]));
    expect(byslug['jess-tottenham-aa11']).toEqual([jess]);
    expect(byslug['ellie-tottenham-bb22']).toEqual([ellie]);
  });
});

/**
 * Crew as people (#348). The auto-pass half is about the `role` stamp and the
 * gate; the manifest half is about a boat being legitimately claimed twice,
 * which the per-row "replace this row's memberships" rule used to make
 * impossible.
 */
describe.skipIf(skip)('reconcile-identities crew slot (#348)', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId!: string;
  const seriesByYear: Record<number, string> = {};
  const slugByYear: Record<number, string> = {};

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_crew_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'crew-test',
      slug: `crew-${workspaceId.slice(9, 17)}`,
      createdAt: new Date(),
    });
    for (const year of [2023, 2024]) {
      const id = uuid();
      seriesByYear[year] = id;
      slugByYear[year] = `ksc-event-${year}`;
      await db.insert(schema.series).values({
        id,
        workspaceId,
        name: `Event ${year}`,
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

  async function addBoat(p: {
    year: number;
    name: string;
    sailNumber: string;
    crewNames?: string[];
    club?: string;
  }): Promise<string> {
    const id = uuid();
    await db.insert(schema.competitors).values({
      id,
      seriesId: seriesByYear[p.year],
      workspaceId,
      fleetIds: [],
      sailNumber: p.sailNumber,
      names: [p.name],
      crewNames: p.crewNames ?? null,
      club: p.club ?? 'KSC',
      gender: '',
      age: null,
    });
    return id;
  }

  async function linksOf(competitorId: string) {
    const rows = await db
      .select({
        role: schema.competitorIdentityLinks.role,
        label: schema.competitorIdentities.label,
      })
      .from(schema.competitorIdentityLinks)
      .innerJoin(
        schema.competitorIdentities,
        eq(schema.competitorIdentities.id, schema.competitorIdentityLinks.identityId),
      )
      .where(eq(schema.competitorIdentityLinks.competitorId, competitorId));
    return rows.map((r) => `${r.label}:${r.role}`).sort();
  }

  async function reconcile(includeCrew: boolean) {
    const inputs = await collectClusterInputs(db, workspaceId, { includeCrew });
    return applyClusters(db, workspaceId, clusterCompetitors(inputs));
  }

  let boat23!: string;
  let boat24!: string;

  test('without the gate, only the primary slot is linked', async () => {
    boat23 = await addBoat({
      year: 2023,
      name: 'Frank Larkin',
      sailNumber: '900',
      crewNames: ['Maeve Dervan'],
    });
    await reconcile(false);
    expect(await linksOf(boat23)).toEqual(['Frank Larkin:primary']);
  });

  test('with the gate, the crew gets an identity of their own', async () => {
    await reconcile(true);
    expect(await linksOf(boat23)).toEqual([
      'Frank Larkin:primary',
      'Maeve Dervan:crew',
    ]);
  });

  test('a crew recurring on the same boat joins their own identity', async () => {
    boat24 = await addBoat({
      year: 2024,
      name: 'Sam Cronin',
      sailNumber: '900',
      crewNames: ['Maeve Dervan'],
    });
    await reconcile(true);
    expect(await linksOf(boat24)).toEqual([
      'Maeve Dervan:crew',
      'Sam Cronin:primary',
    ]);
    // One Maeve across both seasons, not one per appearance. Scoped to this
    // workspace: identities are workspace-local, and other suites seed the
    // same name into workspaces of their own.
    const maeve = await db
      .select({ id: schema.competitorIdentities.id })
      .from(schema.competitorIdentities)
      .where(
        and(
          eq(schema.competitorIdentities.workspaceId, workspaceId),
          eq(schema.competitorIdentities.label, 'Maeve Dervan'),
        ),
      );
    expect(maeve).toHaveLength(1);
  });

  test('an unrecognisable crew cell mints nothing', async () => {
    const boat = await addBoat({
      year: 2024,
      name: 'Ann Ryan',
      sailNumber: '311',
      crewNames: ['???'],
    });
    await reconcile(true);
    expect(await linksOf(boat)).toEqual(['Ann Ryan:primary']);
  });

  test('a manifest can claim both slots of one boat', async () => {
    // The sail addresses the boat, so helm and crew share a member key and
    // differ only by slot. Applying per row would have the second assignment
    // delete the first's link on its way past.
    const manifest = parseManifest(
      JSON.stringify({
        version: 1,
        series: { [slugByYear[2023]]: seriesByYear[2023] },
        identities: [
          {
            slug: 'frank-larkin-mmmm',
            name: 'Frank Larkin',
            members: [[slugByYear[2023], '900']],
          },
          {
            slug: 'maeve-dervan-nnnn',
            name: 'Maeve Dervan',
            members: [[slugByYear[2023], '900', 'crew']],
          },
        ],
      }),
    );
    const { index } = await collectCompetitorIndex(db, workspaceId);
    const plan = planManifestApply(manifest, workspaceId, (seriesId, sail) =>
      index.get(`${seriesId}|${sail}`),
    );
    expect(plan.unresolvedMembers).toEqual([]);

    const applied = await applyManifest(db, workspaceId, plan);
    expect(applied.competitorsLinked).toBe(2);
    expect(await linksOf(boat23)).toEqual([
      'Frank Larkin:primary',
      'Maeve Dervan:crew',
    ]);
    const [maeve] = await db
      .select({ managedBy: schema.competitorIdentities.managedBy })
      .from(schema.competitorIdentities)
      .where(
        eq(
          schema.competitorIdentities.id,
          identityIdForSlug(workspaceId, 'maeve-dervan-nnnn'),
        ),
      );
    expect(maeve?.managedBy).toBe('archive');
  });
  test('a crew earns no ranking points from their helm placing', async () => {
    // The ladder joins memberships to credit each linked identity with the
    // boat's place. Crew memberships must not ride along on that join —
    // whether crew score is the club's call, not a consequence of the schema.
    const fleetId = uuid();
    await db.insert(schema.fleets).values({
      id: fleetId,
      seriesId: seriesByYear[2023],
      workspaceId,
      name: 'Main Fleet',
      displayOrder: 0,
      scoringSystem: 'scratch',
    });
    await db
      .update(schema.series)
      .set({ asPublished: true })
      .where(eq(schema.series.id, seriesByYear[2023]));
    await db.insert(schema.asPublishedResults).values({
      id: uuid(),
      workspaceId,
      seriesId: seriesByYear[2023],
      fleetId,
      results: {
        leadColumns: [],
        raceHeaders: [],
        summaryColumns: [],
        rows: [
          {
            competitorId: boat23,
            rank: 1,
            rankLabel: '1st',
            leadCells: [],
            raceCells: [],
            summaryCells: [],
          },
        ],
      },
    });

    const standings = await computeRankingStandings(workspaceId, {
      buckets: [
        {
          id: 'all',
          name: 'All',
          seriesIds: [seriesByYear[2023]],
          countBest: 1,
          requiredMin: 1,
        },
      ],
    });
    const frank = identityIdForSlug(workspaceId, 'frank-larkin-mmmm');
    const maeve = identityIdForSlug(workspaceId, 'maeve-dervan-nnnn');
    const ranked = standings.result.rows.map((r) => r.identityId);
    expect(ranked).toContain(frank);
    expect(ranked).not.toContain(maeve);
  });
});
