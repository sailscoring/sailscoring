// @vitest-environment node

/**
 * Verifies the Idempotency-Key middleware in workspaceRoute: the same
 * key replays the original response without invoking the handler again.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';

vi.mock('@/lib/auth/require-workspace', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/auth/require-workspace')>();
  return { ...original, requireWorkspace: vi.fn() };
});

import { workspaceRoute } from '@/app/api/v1/_lib/handler';
import { requireWorkspace } from '@/lib/auth/require-workspace';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const mockedRequire = requireWorkspace as ReturnType<typeof vi.fn>;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('Idempotency-Key replay', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_idem_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'idem',
      slug: `idem-${workspaceId.slice(8, 16)}`,
      createdAt: new Date(),
    });
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.idempotencyKeys).where(
        eq(schema.idempotencyKeys.workspaceId, workspaceId),
      );
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  test('same key replays the original response and skips the handler', async () => {
    mockedRequire.mockResolvedValue({
      userId: 'u', email: 'e@x', workspaceId, role: 'owner',
    });

    let invocations = 0;
    const handler = workspaceRoute(async () => {
      invocations += 1;
      return { value: invocations };
    });

    const key = `key-${uuid()}`;
    const make = () =>
      new Request('http://localhost/api/v1/x', {
        method: 'PUT',
        headers: { 'idempotency-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });

    const first = await handler(
      make() as Parameters<typeof handler>[0],
      { params: Promise.resolve({}) },
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ value: 1 });

    const second = await handler(
      make() as Parameters<typeof handler>[0],
      { params: Promise.resolve({}) },
    );
    expect(second.status).toBe(200);
    // Same body as first call — handler not re-invoked.
    expect(await second.json()).toEqual({ value: 1 });
    expect(invocations).toBe(1);
  });

  test('GET requests do not consult the idempotency table', async () => {
    mockedRequire.mockResolvedValue({
      userId: 'u', email: 'e@x', workspaceId, role: 'owner',
    });

    let invocations = 0;
    const handler = workspaceRoute(async () => {
      invocations += 1;
      return { v: invocations };
    });

    const key = `get-${uuid()}`;
    const make = () =>
      new Request('http://localhost/api/v1/x', {
        method: 'GET',
        headers: { 'idempotency-key': key },
      });

    await handler(make() as Parameters<typeof handler>[0], { params: Promise.resolve({}) });
    await handler(make() as Parameters<typeof handler>[0], { params: Promise.resolve({}) });
    expect(invocations).toBe(2);
  });
});
