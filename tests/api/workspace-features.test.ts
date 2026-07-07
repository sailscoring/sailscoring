// @vitest-environment node

/**
 * Self-service feature toggle handler (#278). Drives `setWorkspaceFeature`
 * against a real Postgres: enabling/disabling writes the org metadata, disable
 * records an opt-out, and operator-managed keys are rejected. Skipped when
 * DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import { ForbiddenError } from '@/lib/auth/require-workspace';
import { setWorkspaceFeature } from '@/lib/api-handlers/workspace';
import { parseOrgMetadata } from '@/lib/features';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('setWorkspaceFeature (#278)', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let orgId: string;
  const slug = `feat-${uuid().slice(0, 8)}`;

  const ctx = (): WorkspaceContext => ({
    userId: 'usr_x',
    email: 'x@sailscoring.test',
    workspaceId: orgId,
    workspaceSlug: slug,
    role: 'owner',
    features: [],
  });

  async function metadata() {
    const [row] = await db
      .select({ metadata: schema.organization.metadata })
      .from(schema.organization)
      .where(eq(schema.organization.id, orgId))
      .limit(1);
    return parseOrgMetadata(row?.metadata ?? null, slug);
  }

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    orgId = `org_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: orgId,
      name: 'Feature Toggle Club',
      slug,
      createdAt: new Date(),
      metadata: null,
    });
  });

  afterAll(async () => {
    if (orgId)
      await db.delete(schema.organization).where(eq(schema.organization.id, orgId));
    await sql?.end();
  });

  test('enabling a self-service feature writes it to enabledFeatures', async () => {
    const res = await setWorkspaceFeature(ctx(), { feature: 'prizes', enabled: true });
    expect(res.enabledFeatures).toContain('prizes');
    expect((await metadata()).enabledFeatures).toContain('prizes');
  });

  test('disabling drops the enable and records an opt-out', async () => {
    await setWorkspaceFeature(ctx(), { feature: 'prizes', enabled: true });
    const res = await setWorkspaceFeature(ctx(), { feature: 'prizes', enabled: false });
    expect(res.enabledFeatures).not.toContain('prizes');
    expect(res.disabledFeatures).toContain('prizes');
    const meta = await metadata();
    expect(meta.enabledFeatures).not.toContain('prizes');
    expect(meta.disabledFeatures).toContain('prizes');
  });

  test('a default-on feature can be opted out', async () => {
    const res = await setWorkspaceFeature(ctx(), { feature: 'echo', enabled: false });
    expect(res.disabledFeatures).toContain('echo');
  });

  test('operator-managed keys are rejected with a forbidden error', async () => {
    await expect(
      setWorkspaceFeature(ctx(), { feature: 'competitor-identity', enabled: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      setWorkspaceFeature(ctx(), { feature: 'ftp-upload', enabled: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // The rejected write left no trace.
    const meta = await metadata();
    expect(meta.enabledFeatures).not.toContain('competitor-identity');
    expect(meta.enabledFeatures).not.toContain('ftp-upload');
  });
});
