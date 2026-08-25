// @vitest-environment node

/**
 * locateSeries — the cross-membership lookup behind GET
 * /api/v1/series/{id}/workspace. A series URL opened while the session's
 * active workspace points elsewhere dead-ends on the scoped GET's 404; this
 * lookup resolves which of the caller's workspaces holds the series so the
 * client can offer an explicit switch. Must fail closed: a series in a
 * workspace the caller is not a member of looks exactly like a missing one.
 *
 * Skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { inArray } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import { NotFoundError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { locateSeries, putSeries } from '@/lib/api-handlers/series';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

function ctxFor(userId: string, workspaceId: string, slug: string): WorkspaceContext {
  return {
    userId,
    email: `${userId}@sailscoring.test`,
    workspaceId,
    workspaceSlug: slug,
    role: 'owner',
    features: [],
  };
}

function sampleSeries(id: string) {
  return {
    id,
    name: `Series ${id.slice(0, 8)}`,
    venue: 'HYC',
    startDate: '2026-04-01',
    endDate: '2026-04-30',
    venueLogoUrl: '',
    eventLogoUrl: '',
    venueUrl: '',
    eventUrl: '',
    createdAt: Date.now(),
    lastSavedAt: null,
    lastModifiedAt: Date.now(),
    scoringMode: 'handicap' as const,
    discardThresholds: [],
    dnfScoring: 'seriesEntries' as const,
    ftpHost: '',
    ftpPath: '',
    ftpPaths: {},
    includeJsonExport: true,
    publishRatingCalculations: true,
    enabledCompetitorFields: ['boatName', 'club'],
    primaryPersonLabel: 'helm' as const,
    subdivisionAxes: [],
  };
}

describe.skipIf(skip)('locateSeries (cross-membership lookup)', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  // The scorer is a member of A and B; the stranger only of C. The series
  // lives in A; every lookup runs with B (or C) as the active workspace, the
  // exact state the two-tab switch leaves behind.
  let orgA: string;
  let orgB: string;
  let orgC: string;
  let scorer: string;
  let stranger: string;
  let seriesId: string;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    const stamp = uuid().replace(/-/g, '');
    orgA = `org_la_${stamp}`;
    orgB = `org_lb_${stamp}`;
    orgC = `org_lc_${stamp}`;
    scorer = `usr_loc_${stamp}`;
    stranger = `usr_str_${stamp}`;
    const now = new Date();
    await db.insert(schema.organization).values([
      { id: orgA, name: 'Locate A', slug: `la-${stamp.slice(0, 10)}`, createdAt: now },
      { id: orgB, name: 'Locate B', slug: `lb-${stamp.slice(0, 10)}`, createdAt: now },
      { id: orgC, name: 'Locate C', slug: `lc-${stamp.slice(0, 10)}`, createdAt: now },
    ]);
    await db.insert(schema.user).values([
      { id: scorer, name: 'Scorer', email: `${scorer}@sailscoring.test` },
      { id: stranger, name: 'Stranger', email: `${stranger}@sailscoring.test` },
    ]);
    await db.insert(schema.member).values([
      { id: `mem_a_${stamp}`, organizationId: orgA, userId: scorer, role: 'owner', createdAt: now },
      { id: `mem_b_${stamp}`, organizationId: orgB, userId: scorer, role: 'member', createdAt: now },
      { id: `mem_c_${stamp}`, organizationId: orgC, userId: stranger, role: 'owner', createdAt: now },
    ]);
    seriesId = uuid();
    await putSeries(ctxFor(scorer, orgA, 'la'), seriesId, sampleSeries(seriesId));
  });

  afterAll(async () => {
    // Series, members, and everything else cascade off the organization rows.
    await db
      .delete(schema.organization)
      .where(inArray(schema.organization.id, [orgA, orgB, orgC]));
    await db
      .delete(schema.user)
      .where(inArray(schema.user.id, [scorer, stranger]));
    await sql?.end();
  });

  test('resolves the owning workspace for a member whose active workspace is elsewhere', async () => {
    const location = await locateSeries(ctxFor(scorer, orgB, 'lb'), seriesId);
    expect(location.workspaceId).toBe(orgA);
    expect(location.workspaceName).toBe('Locate A');
    expect(location.workspaceSlug).toMatch(/^la-/);
  });

  test('also resolves from the owning workspace itself', async () => {
    const location = await locateSeries(ctxFor(scorer, orgA, 'la'), seriesId);
    expect(location.workspaceId).toBe(orgA);
  });

  test('fails closed for a non-member: 404, not 403', async () => {
    await expect(
      locateSeries(ctxFor(stranger, orgC, 'lc'), seriesId),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test('404s for an id that exists nowhere', async () => {
    await expect(
      locateSeries(ctxFor(scorer, orgB, 'lb'), uuid()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
