// @vitest-environment node

/**
 * Integration tests for the reconcile surface's correction operations (#221):
 * merge (and its undo), cluster-level split, the "looks right" review stamp,
 * confirmed-different distinctions, and the review queue's merge suggestions.
 * The load-bearing behaviours: a merge is undoable byte-for-byte (same id and
 * slug), a split lands on a fresh *confirmed* identity the automatic pass
 * never re-fuses, and a dismissed suggestion stays dismissed.
 *
 * Skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq, isNull } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import { BadRequestError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import * as identity from '@/lib/api-handlers/competitor-identity';
import { relinkIdentitiesAfterWrite } from '@/lib/competitor-identity-reconcile';
import { serializeOrgMetadata } from '@/lib/features';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('competitor-identity reconcile operations', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId!: string;
  let ctx!: WorkspaceContext;
  const seriesByYear: Record<number, string> = {};

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_recops_${uuid().replace(/-/g, '')}`;
    ctx = {
      userId: 'test-user',
      email: 'test@sailscoring.test',
      workspaceId,
      workspaceSlug: 'recops-ws',
      role: 'owner',
      features: ['competitor-reconcile'],
    };
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'reconcile-ops-test',
      slug: `recops-${workspaceId.slice(11, 19)}`,
      // The lazy pass (used in the split-sticks assertion) gates on the
      // workspace's own competitor-identity flag.
      metadata: serializeOrgMetadata({
        kind: 'club',
        enabledFeatures: ['competitor-identity'],
        disabledFeatures: [],
        seededFeatureSamples: [],
      }),
      createdAt: new Date(),
    });
    for (const year of [2022, 2023, 2024, 2025]) {
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
    await db
      .delete(schema.organization)
      .where(eq(schema.organization.id, workspaceId));
    await sql?.end();
  });

  async function seedIdentity(p: {
    label: string;
    slug: string;
    sailNumber?: string;
    club?: string;
  }): Promise<string> {
    const id = uuid();
    await db.insert(schema.competitorIdentities).values({
      id,
      workspaceId,
      label: p.label,
      slug: p.slug,
      sailNumber: p.sailNumber ?? '',
      club: p.club ?? null,
    });
    return id;
  }

  async function seedCompetitor(p: {
    year: number;
    name: string;
    sailNumber: string;
    club?: string;
    identityId?: string;
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
    if (p.identityId) {
      await db.insert(schema.competitorIdentityLinks).values({
        competitorId: id,
        identityId: p.identityId,
        workspaceId,
      });
    }
    return id;
  }

  async function identityIdOf(competitorId: string): Promise<string | null> {
    const [row] = await db
      .select({ identityId: schema.competitorIdentityLinks.identityId })
      .from(schema.competitorIdentityLinks)
      .where(eq(schema.competitorIdentityLinks.competitorId, competitorId));
    return row?.identityId ?? null;
  }

  test('merge moves the rows, deletes the source, and undo restores it exactly', async () => {
    const keep = await seedIdentity({ label: 'Órla Kelly', slug: 'orla-kelly-aaaa' });
    const dupe = await seedIdentity({ label: 'Orla Kelly', slug: 'orla-kelly-bbbb' });
    const rowA = await seedCompetitor({ year: 2022, name: 'Órla Kelly', sailNumber: 'IRL1000', identityId: keep });
    const rowB = await seedCompetitor({ year: 2023, name: 'Orla Kelly', sailNumber: 'IRL2000', identityId: dupe });

    const merged = await identity.mergeIntoIdentity(ctx, keep, { sourceId: dupe });
    expect(merged.identity.entries.map((e) => e.competitorId).sort()).toEqual(
      [rowA, rowB].sort(),
    );
    expect(merged.undo.source.id).toBe(dupe);
    expect(merged.undo.source.slug).toBe('orla-kelly-bbbb');
    expect(merged.undo.movedCompetitorIds).toEqual([rowB]);
    // Source row is gone.
    const gone = await db
      .select()
      .from(schema.competitorIdentities)
      .where(eq(schema.competitorIdentities.id, dupe));
    expect(gone).toHaveLength(0);

    // Undo: same id, same slug, rows re-pointed.
    const restored = await identity.restoreMergedIdentity(ctx, merged.undo);
    expect(restored.identity.id).toBe(dupe);
    expect(restored.identity.slug).toBe('orla-kelly-bbbb');
    expect(await identityIdOf(rowB)).toBe(dupe);
    expect(await identityIdOf(rowA)).toBe(keep);
  });

  test('split peels rows onto a fresh identity the auto-pass never re-fuses', async () => {
    // The classic over-merge: one identity carrying two sailors' rows on the
    // same name + sail.
    const fused = await seedIdentity({
      label: 'Jonathan Dempsey',
      slug: 'jonathan-dempsey-cccc',
      sailNumber: '1605',
    });
    const early1 = await seedCompetitor({ year: 2022, name: 'Jonathan Dempsey', sailNumber: '1605', identityId: fused });
    const late1 = await seedCompetitor({ year: 2024, name: 'Jonathan Dempsey', sailNumber: '1605', identityId: fused });
    const late2 = await seedCompetitor({ year: 2025, name: 'Jonathan Dempsey', sailNumber: '1605', identityId: fused });

    const split = await identity.splitFromIdentity(ctx, fused, {
      competitorIds: [late1, late2],
    });
    expect(split.identity.entries.map((e) => e.competitorId)).toEqual([early1]);
    const newId = split.newIdentityId;
    expect(await identityIdOf(late1)).toBe(newId);
    expect(await identityIdOf(late2)).toBe(newId);
    // Representative fields come from the most recent peeled row.
    const [fresh] = await db
      .select()
      .from(schema.competitorIdentities)
      .where(eq(schema.competitorIdentities.id, newId));
    expect(fresh.label).toBe('Jonathan Dempsey');
    expect(fresh.slug).toMatch(/^jonathan-dempsey-/);

    // The automatic pass would fuse these on name + sail — the two confirmed
    // identities make it a conflict instead, so the human split sticks.
    const relink = await relinkIdentitiesAfterWrite(workspaceId, db);
    // (null when nothing was unlinked anywhere; either way the links held.)
    if (relink) expect(relink.competitorsLinked).toBe(0);
    expect(await identityIdOf(early1)).toBe(fused);
    expect(await identityIdOf(late1)).toBe(newId);

    // Peeling everything is a rename, not a split.
    await expect(
      identity.splitFromIdentity(ctx, fused, { competitorIds: [early1] }),
    ).rejects.toThrow(BadRequestError);
  });

  test('reviewed stamp sets and clears, and a split clears it', async () => {
    const long = await seedIdentity({ label: 'Aoife Byrne', slug: 'aoife-byrne-dddd' });
    const r1 = await seedCompetitor({ year: 2022, name: 'Aoife Byrne', sailNumber: 'IRL1', identityId: long });
    const r2 = await seedCompetitor({ year: 2025, name: 'Aoife Byrne', sailNumber: 'IRL1', identityId: long });

    const stamped = await identity.reviewIdentity(ctx, long, { reviewed: true });
    expect(stamped.reviewedAt).not.toBeNull();

    // A later split invalidates the review — the arc changed.
    await identity.splitFromIdentity(ctx, long, { competitorIds: [r2] });
    const [after] = await db
      .select({ reviewedAt: schema.competitorIdentities.reviewedAt })
      .from(schema.competitorIdentities)
      .where(eq(schema.competitorIdentities.id, long));
    expect(after.reviewedAt).toBeNull();
    expect(await identityIdOf(r1)).toBe(long);
  });

  test('review queue suggests weak name matches and honours dismissals', async () => {
    // Same name, no corroboration: different sails, different clubs.
    const a = await seedIdentity({ label: 'Cian Walsh', slug: 'cian-walsh-eeee' });
    const b = await seedIdentity({ label: 'Cian Walsh', slug: 'cian-walsh-ffff' });
    await seedCompetitor({ year: 2022, name: 'Cian Walsh', sailNumber: 'IRL10', club: 'RCYC', identityId: a });
    await seedCompetitor({ year: 2024, name: 'Cian Walsh', sailNumber: 'IRL99', club: 'TBSC', identityId: b });

    const queue = await identity.reviewQueue(ctx);
    const pair = queue.mergeSuggestions.find(
      (s) =>
        (s.aId === a && s.bId === b) || (s.aId === b && s.bId === a),
    );
    expect(pair).toBeDefined();

    // Dismiss: they're different sailors — the suggestion never comes back.
    await identity.distinguishIdentities(ctx, { aId: a, bId: b });
    const after = await identity.reviewQueue(ctx);
    expect(
      after.mergeSuggestions.some(
        (s) =>
          (s.aId === a && s.bId === b) || (s.aId === b && s.bId === a),
      ),
    ).toBe(false);
  });

  test('feature gate: everything 403s without competitor-reconcile', async () => {
    const bare: WorkspaceContext = { ...ctx, features: [] };
    await expect(identity.listIdentities(bare)).rejects.toThrow();
    await expect(identity.reviewQueue(bare)).rejects.toThrow();
    await expect(
      identity.mergeIntoIdentity(bare, uuid(), { sourceId: uuid() }),
    ).rejects.toThrow();
  });

  test('workspace scoping: another workspace cannot merge our identities', async () => {
    const foreign: WorkspaceContext = {
      ...ctx,
      workspaceId: 'org_other_does_not_exist',
    };
    const a = await seedIdentity({ label: 'Scoped Sailor', slug: 'scoped-sailor-gggg' });
    const b = await seedIdentity({ label: 'Scoped Sailor', slug: 'scoped-sailor-hhhh' });
    await expect(
      identity.mergeIntoIdentity(foreign, a, { sourceId: b }),
    ).rejects.toThrow();
    // Both still present.
    const rows = await db
      .select()
      .from(schema.competitorIdentities)
      .where(
        and(
          eq(schema.competitorIdentities.workspaceId, workspaceId),
          isNull(schema.competitorIdentities.reviewedAt),
        ),
      );
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining([a, b]));
  });
});
