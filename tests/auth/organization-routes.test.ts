// @vitest-environment node

/**
 * The organization plugin's update and delete routes are closed
 * (`disabledPaths` in lib/auth.ts). An owner may call both under the
 * plugin's default roles, and the update body takes `slug` and `metadata`
 * wholesale: the workspace's public URLs and its operator-managed features.
 * These run as the owner of their own workspace, the strongest role the
 * plugin knows, so if the owner is refused, everyone is.
 *
 * Skipped when DATABASE_URL is unset; CI provides it.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { removeUser, request, signInFreshUser, type SignedInUser } from './oauth-helpers';

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('organization update and delete routes', () => {
  let owner!: SignedInUser;

  beforeAll(async () => {
    owner = await signInFreshUser('org-routes');
  });

  afterAll(async () => {
    if (owner) await removeUser(owner);
  });

  async function workspaceRow() {
    const [row] = await getDb()
      .select({
        slug: schema.organization.slug,
        name: schema.organization.name,
        metadata: schema.organization.metadata,
      })
      .from(schema.organization)
      .where(eq(schema.organization.id, owner.personalWorkspaceId));
    return row;
  }

  test('an owner cannot rewrite the workspace slug, name or metadata', async () => {
    const before = await workspaceRow();
    const res = await request(owner, '/api/auth/organization/update', {
      json: {
        organizationId: owner.personalWorkspaceId,
        data: {
          slug: `moved-${Date.now()}`,
          name: 'Renamed',
          metadata: { enabledFeatures: ['rankings'] },
        },
      },
    });
    expect(res.status).toBe(404);
    expect(await workspaceRow()).toEqual(before);
  });

  test('an owner cannot delete the workspace', async () => {
    const res = await request(owner, '/api/auth/organization/delete', {
      json: { organizationId: owner.personalWorkspaceId },
    });
    expect(res.status).toBe(404);
    expect(await workspaceRow()).toBeDefined();
  });

  test('the routes the app does use stay open', async () => {
    const res = await request(owner, '/api/auth/organization/list');
    expect(res.status).toBe(200);
  });
});
