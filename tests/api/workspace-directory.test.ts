// @vitest-environment node

/**
 * The workspace's entry in the public directory: a club workspace is listed
 * until it opts out, the description round-trips, a change is logged to the
 * activity feed, and a personal workspace can't be opted in.
 *
 * Skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq, inArray } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { ForbiddenError } from '@/lib/auth/require-workspace';
import {
  getDirectorySettings,
  setDirectorySettings,
} from '@/lib/api-handlers/workspace';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

describe.skipIf(skip)('workspace directory settings', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const clubId = `org_dir_${suffix}`;
  const personalId = `org_dirp_${suffix}`;
  const club: WorkspaceContext = {
    userId: `dir-user-${suffix}`,
    email: 'dir@sailscoring.test',
    workspaceId: clubId,
    workspaceSlug: `dir-${suffix}`,
    role: 'owner',
    features: [],
  };
  const personal: WorkspaceContext = {
    ...club,
    workspaceId: personalId,
    workspaceSlug: `u-dir${suffix}`,
  };

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    await db.insert(schema.organization).values([
      { id: clubId, name: 'Directory Club', slug: club.workspaceSlug, createdAt: new Date() },
      { id: personalId, name: 'My Workspace', slug: personal.workspaceSlug, createdAt: new Date() },
    ]);
  });

  afterAll(async () => {
    await db
      .delete(schema.organization)
      .where(inArray(schema.organization.id, [clubId, personalId]));
    await sql?.end();
  });

  test('a club workspace is listed by default, with no description', async () => {
    expect(await getDirectorySettings(club)).toEqual({
      kind: 'club',
      listed: true,
      description: '',
    });
  });

  test('opting out and describing it round-trip, and are logged', async () => {
    const after = await setDirectorySettings(club, {
      listed: false,
      description: '  Club racing on Dublin Bay  ',
    });
    expect(after).toEqual({
      kind: 'club',
      listed: false,
      description: 'Club racing on Dublin Bay',
    });
    expect(await getDirectorySettings(club)).toEqual(after);

    const logged = await db
      .select({ summary: schema.activityLog.summary })
      .from(schema.activityLog)
      .where(
        and(
          eq(schema.activityLog.workspaceId, clubId),
          eq(schema.activityLog.action, 'publish.directory-updated'),
        ),
      );
    expect(logged.map((r) => r.summary)).toEqual([
      'Took the workspace out of the public directory',
    ]);
  });

  test('a description too long for the card is refused', async () => {
    await expect(
      setDirectorySettings(club, { listed: true, description: 'x'.repeat(161) }),
    ).rejects.toThrow();
  });

  test('a personal workspace is never listed and cannot be opted in', async () => {
    expect((await getDirectorySettings(personal)).listed).toBe(false);
    await expect(
      setDirectorySettings(personal, { listed: true, description: '' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
