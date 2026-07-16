// @vitest-environment node

/**
 * As-published season rankings (#309): the ingest handler against a real
 * Postgres — upsert with content-hash idempotency, slug collision with a
 * computed ranking, workspace scoping, and delete. Skipped when
 * DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import {
  deleteArchiveRanking,
  putArchiveRanking,
} from '@/lib/api-handlers/archive';
import { parseManifest } from '@/lib/competitor-identity-manifest';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('as-published rankings ingest (#309)', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;

  const ctx = (): WorkspaceContext => ({
    userId: 'ar-user',
    email: 'ar@sailscoring.test',
    workspaceId,
    workspaceSlug: `ar-${workspaceId.slice(7, 17)}`,
    role: 'owner',
    features: [],
  });

  const rankingId = uuid();
  const doc = () => ({
    formatVersion: 1 as const,
    ranking: {
      id: rankingId,
      name: 'IODAI National Ranking 2012 — Junior',
      slug: 'national-ranking-2012-junior',
      season: 2012,
      fleetLabel: 'Junior',
      ruleNote: 'Nationals (non-discardable) + best 2 of 4 regionals',
      source: {
        url: 'https://web.archive.org/web/20130130093824/http://www.iodai.com/live/ranking/',
        capturedAt: '2013-01-30',
        note: 'Final Rankings 2012 — Wayback',
      },
    },
    table: {
      caption: 'All 4 regionals plus the Nationals',
      leadColumns: [{ key: 'club', label: 'Club' }],
      eventHeaders: [{ label: 'Leinsters' }, { label: 'Nationals' }],
      summaryColumns: [{ key: 'nett', label: 'Nett' }],
      rows: [
        {
          identity: 'aoife-kelly-ab12',
          rank: 1,
          rankLabel: '1st',
          name: 'Aoife Kelly',
          leadCells: ['RCYC'],
          eventCells: [{ text: '1.0' }, { text: '2.0', discard: true }],
          summaryCells: ['3.0'],
        },
        {
          identity: null,
          rank: 2,
          rankLabel: '2nd',
          name: 'Unmatched Sailor',
          leadCells: ['HYC'],
          eventCells: [{ text: '2.0' }, { text: '1.0' }],
          summaryCells: ['3.0'],
        },
      ],
    },
  });

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    process.env.DATABASE_URL = DATABASE_URL;
    workspaceId = `org_ar_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Archive Rankings Club',
      slug: `ar-${workspaceId.slice(7, 17)}`,
      createdAt: new Date(),
    });
  });

  afterAll(async () => {
    if (workspaceId) {
      await db
        .delete(schema.organization)
        .where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  test('ingest, idempotent re-put, update, delete', async () => {
    const first = await putArchiveRanking(ctx(), rankingId, doc());
    expect(first).toMatchObject({
      unchanged: false,
      rankedCount: 2,
      linkedRows: 1,
    });

    const again = await putArchiveRanking(ctx(), rankingId, doc());
    expect(again.unchanged).toBe(true);

    const changed = doc();
    changed.table.rows[1].identity = 'unmatched-sailor-zz99';
    const updated = await putArchiveRanking(ctx(), rankingId, changed);
    expect(updated).toMatchObject({ unchanged: false, linkedRows: 2 });

    const [row] = await db
      .select()
      .from(schema.asPublishedRankings)
      .where(eq(schema.asPublishedRankings.id, rankingId));
    expect(row.season).toBe(2012);
    expect(row.rankedCount).toBe(2);
    expect(row.table.rows[0].identity).toBe('aoife-kelly-ab12');

    await deleteArchiveRanking(ctx(), rankingId);
    const gone = await db
      .select()
      .from(schema.asPublishedRankings)
      .where(eq(schema.asPublishedRankings.id, rankingId));
    expect(gone).toEqual([]);
  });

  test('a computed ranking already holding the slug is a rejection', async () => {
    await db.insert(schema.rankings).values({
      id: uuid(),
      workspaceId,
      name: 'Live ladder',
      slug: 'national-ranking-2012-junior',
      config: { buckets: [] },
    });
    await expect(
      putArchiveRanking(ctx(), uuid(), { ...doc(), ranking: { ...doc().ranking, id: undefined } }),
    ).rejects.toThrow();
    const d = doc();
    const otherId = uuid();
    d.ranking.id = otherId;
    await expect(putArchiveRanking(ctx(), otherId, d)).rejects.toThrow(
      /computed ranking already uses this slug/,
    );
  });

  test('a manifest identity with zero members parses (ranking-only sailors)', () => {
    const manifest = parseManifest(
      JSON.stringify({
        version: 1,
        series: {},
        identities: [
          {
            slug: 'ranking-only-sailor-aa11',
            name: 'Ranking Only',
            members: [],
          },
        ],
      }),
    );
    expect(manifest.identities[0].members).toEqual([]);
  });
});
