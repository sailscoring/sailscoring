// @vitest-environment node

/**
 * Integration tests for `pushCompetitorsToRrsOrg`. The outbound POST is
 * stubbed via RRS_ORG_API_URL on an RFC 6761 `.test` host, which the handler
 * writes to `tests/.rrs-org.log` instead of the network — the same pattern as
 * the feedback email stub. Covers the feature gate, the payload actually
 * "sent", persistence of the remembered push settings, and the archived-series
 * guard.
 *
 * Skipped when DATABASE_URL is unset.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import { ArchivedError } from '@/app/api/v1/_lib/handler';
import { ForbiddenError, type WorkspaceContext } from '@/lib/auth/require-workspace';
import { pushCompetitorsToRrsOrg } from '@/lib/api-handlers/rrs-org';
import * as series from '@/lib/api-handlers/series';
import { createRepos } from '@/lib/postgres-repository';
import type { RrsOrgCompetitor } from '@/lib/rrs-org';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

const EVENT_UUID = 'd17854ef-f55f-4ab6-8429-3f55527b6e9f';
const PUSH_LOG = path.join(process.cwd(), 'tests', '.rrs-org.log');

function makeRow(id: string, overrides?: Partial<RrsOrgCompetitor>): RrsOrgCompetitor {
  return {
    competitor_id: id,
    sail_number: '14302',
    country_code: 'IRL',
    first_name: 'Kevin',
    last_name: 'Donnelly',
    boat_name: 'Mistral Behaving',
    boat_class: 'GP14',
    division: '',
    club_name: '',
    email: '',
    phone: '',
    mna_code: 'IRL',
    mna_number: '',
    ...overrides,
  };
}

async function readLogLines(): Promise<{ payload: { uuid: string; source: string; competitors: RrsOrgCompetitor[] } }[]> {
  try {
    const text = await fs.readFile(PUSH_LOG, 'utf8');
    return text
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

describe.skipIf(skip)('pushCompetitorsToRrsOrg', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;
  let seriesId: string;
  let prevUrl: string | undefined;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_rrs_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'RRS Push',
      slug: `rrs-${workspaceId.slice(8, 18)}`,
      createdAt: new Date(),
    });
    ctx = {
      userId: 'rrs-user',
      email: 'rrs@sailscoring.test',
      workspaceId,
      workspaceSlug: `rrs-${workspaceId.slice(8, 18)}`,
      role: 'owner',
      features: ['rrs-import'],
    };

    seriesId = uuid();
    await series.putSeries(ctx, seriesId, {
      id: seriesId, name: 'GP14 Leinsters', venue: 'Sligo YC',
      startDate: '2026-07-11', endDate: '2026-07-12',
      venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
      createdAt: Date.now(), lastSavedAt: null, lastModifiedAt: Date.now(),
      scoringMode: 'scratch' as const,
      discardThresholds: [], dnfScoring: 'seriesEntries' as const,
      ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: false,
      enabledCompetitorFields: ['boatName'],
      primaryPersonLabel: 'helm' as const, subdivisionAxes: [],
    });

    prevUrl = process.env.RRS_ORG_API_URL;
    process.env.RRS_ORG_API_URL = 'https://rrs-org.test/api/competitors';
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
    if (prevUrl === undefined) delete process.env.RRS_ORG_API_URL;
    else process.env.RRS_ORG_API_URL = prevUrl;
  });

  beforeEach(async () => {
    await fs.rm(PUSH_LOG, { force: true });
  });

  test('rejects when the rrs-import feature is off', async () => {
    await expect(
      pushCompetitorsToRrsOrg({ ...ctx, features: [] }, seriesId, {
        eventUuid: EVENT_UUID,
        divisionSource: 'none',
        competitors: [makeRow('c1')],
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  test('sends the payload, reports the count, and remembers the settings', async () => {
    const result = await pushCompetitorsToRrsOrg(ctx, seriesId, {
      eventUuid: EVENT_UUID,
      divisionSource: 'axis',
      divisionAxisId: 'axis-1',
      competitors: [makeRow('c1'), makeRow('c2', { sail_number: '14241' })],
    });
    expect(result).toEqual({ ok: true, pushed: 2 });

    const lines = await readLogLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].payload.uuid).toBe(EVENT_UUID);
    expect(lines[0].payload.source).toBe('sailscoring');
    expect(lines[0].payload.competitors.map((c) => c.sail_number)).toEqual(['14302', '14241']);

    const saved = await createRepos({ workspaceId }).series.get(seriesId);
    expect(saved?.rrsOrgPush).toEqual({
      eventUuid: EVENT_UUID,
      divisionSource: 'axis',
      divisionAxisId: 'axis-1',
    });
  });

  test('drops a stale divisionAxisId when the source is not axis', async () => {
    await pushCompetitorsToRrsOrg(ctx, seriesId, {
      eventUuid: EVENT_UUID,
      divisionSource: 'fleet',
      divisionAxisId: 'axis-1',
      competitors: [makeRow('c1')],
    });
    const saved = await createRepos({ workspaceId }).series.get(seriesId);
    expect(saved?.rrsOrgPush).toEqual({ eventUuid: EVENT_UUID, divisionSource: 'fleet' });
  });

  test('rejects an invalid body', async () => {
    await expect(
      pushCompetitorsToRrsOrg(ctx, seriesId, {
        eventUuid: 'not-a-uuid',
        divisionSource: 'none',
        competitors: [makeRow('c1')],
      }),
    ).rejects.toThrow();
    await expect(
      pushCompetitorsToRrsOrg(ctx, seriesId, {
        eventUuid: EVENT_UUID,
        divisionSource: 'none',
        competitors: [],
      }),
    ).rejects.toThrow();
  });

  test('rejects a push to an archived series', async () => {
    await series.setSeriesArchived(ctx, seriesId, { archived: true });
    try {
      await expect(
        pushCompetitorsToRrsOrg(ctx, seriesId, {
          eventUuid: EVENT_UUID,
          divisionSource: 'none',
          competitors: [makeRow('c1')],
        }),
      ).rejects.toThrow(ArchivedError);
    } finally {
      await series.setSeriesArchived(ctx, seriesId, { archived: false });
    }
  });
});
