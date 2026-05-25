// @vitest-environment node

/**
 * Integration tests for `submitFeedback`. Covers the rate limit (per-user,
 * across workspaces), the row+log side effects, and the FEEDBACK_TO gate.
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
import { BadRequestError, NotFoundError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { submitFeedback } from '@/lib/api-handlers/feedback';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

function ctxFor(workspaceId: string, userId: string, email: string): WorkspaceContext {
  return { userId, email, workspaceId, workspaceSlug: 'test-ws', role: 'owner' };
}

const FEEDBACK_LOG = path.join(process.cwd(), 'tests', '.feedback.log');

async function readLogLines(): Promise<unknown[]> {
  try {
    const text = await fs.readFile(FEEDBACK_LOG, 'utf8');
    return text
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

async function clearLog() {
  await fs.rm(FEEDBACK_LOG, { force: true });
}

describe.skipIf(skip)('submitFeedback', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceA: string;
  let workspaceB: string;
  let prevTo: string | undefined;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceA = `org_fa_${uuid().replace(/-/g, '')}`;
    workspaceB = `org_fb_${uuid().replace(/-/g, '')}`;
    const now = new Date();
    await db.insert(schema.organization).values([
      { id: workspaceA, name: 'Org A', slug: `fa-${workspaceA.slice(7, 17)}`, createdAt: now },
      { id: workspaceB, name: 'Org B', slug: `fb-${workspaceB.slice(7, 17)}`, createdAt: now },
    ]);
    prevTo = process.env.FEEDBACK_TO;
    // Use the .test TLD so the email helper takes the file-log path even
    // if RESEND_API_KEY happens to be set in the environment.
    process.env.FEEDBACK_TO = 'feedback@sailscoring.test';
  });

  afterAll(async () => {
    if (workspaceA)
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceA));
    if (workspaceB)
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceB));
    await sql?.end();
    if (prevTo === undefined) delete process.env.FEEDBACK_TO;
    else process.env.FEEDBACK_TO = prevTo;
  });

  beforeEach(async () => {
    // Each test uses a unique userId so per-user rate-limit state is fresh,
    // but make sure rows from prior tests don't bleed in if the suite re-runs.
    await clearLog();
  });

  test('inserts a row and appends a log line', async () => {
    const userId = `u-${uuid()}`;
    await submitFeedback(
      ctxFor(workspaceA, userId, 'a@sailscoring.test'),
      { message: 'hello', pageUrl: 'https://app.sailscoring.test/x' },
      'TestAgent/1.0',
    );

    const rows = await db
      .select()
      .from(schema.feedback)
      .where(eq(schema.feedback.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toBe('hello');
    expect(rows[0].pageUrl).toBe('https://app.sailscoring.test/x');
    expect(rows[0].userAgent).toBe('TestAgent/1.0');
    expect(rows[0].userEmail).toBe('a@sailscoring.test');

    const lines = await readLogLines();
    const line = lines.find(
      (l): l is { userEmail: string; message: string } =>
        typeof l === 'object' &&
        l !== null &&
        (l as { userEmail?: string }).userEmail === 'a@sailscoring.test',
    );
    expect(line).toBeTruthy();
    expect(line!.message).toBe('hello');
  });

  test('throws BadRequestError on the 6th submission within an hour', async () => {
    const userId = `u-${uuid()}`;
    const ctx = ctxFor(workspaceA, userId, 'b@sailscoring.test');
    for (let i = 0; i < 5; i++) {
      await submitFeedback(
        ctx,
        { message: `msg ${i}`, pageUrl: 'https://app.sailscoring.test/x' },
        null,
      );
    }
    await expect(
      submitFeedback(
        ctx,
        { message: 'overflow', pageUrl: 'https://app.sailscoring.test/x' },
        null,
      ),
    ).rejects.toThrow(BadRequestError);
  });

  test('rate limit is per-user across workspaces', async () => {
    const userId = `u-${uuid()}`;
    const ctxA = ctxFor(workspaceA, userId, 'c@sailscoring.test');
    const ctxB = ctxFor(workspaceB, userId, 'c@sailscoring.test');
    // 3 in workspace A + 2 in workspace B = 5; the 6th anywhere must fail.
    for (let i = 0; i < 3; i++) {
      await submitFeedback(
        ctxA,
        { message: `a-${i}`, pageUrl: 'https://app.sailscoring.test/x' },
        null,
      );
    }
    for (let i = 0; i < 2; i++) {
      await submitFeedback(
        ctxB,
        { message: `b-${i}`, pageUrl: 'https://app.sailscoring.test/x' },
        null,
      );
    }
    await expect(
      submitFeedback(
        ctxB,
        { message: 'overflow', pageUrl: 'https://app.sailscoring.test/x' },
        null,
      ),
    ).rejects.toThrow(BadRequestError);
  });

  test('throws NotFoundError when FEEDBACK_TO is unset', async () => {
    const saved = process.env.FEEDBACK_TO;
    delete process.env.FEEDBACK_TO;
    try {
      await expect(
        submitFeedback(
          ctxFor(workspaceA, `u-${uuid()}`, 'd@sailscoring.test'),
          { message: 'hi', pageUrl: 'https://app.sailscoring.test/x' },
          null,
        ),
      ).rejects.toThrow(NotFoundError);
    } finally {
      process.env.FEEDBACK_TO = saved;
    }
  });
});
