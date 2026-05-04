// @vitest-environment node

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import { changeEmail } from '@/scripts/change-email';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

describe.skipIf(skip)('change-email operations', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  const cleanupUserIds: string[] = [];

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
  });

  afterAll(async () => {
    for (const id of cleanupUserIds) {
      await db.delete(schema.user).where(eq(schema.user.id, id));
    }
    await sql?.end();
  });

  async function makeUser(email: string): Promise<string> {
    const id = `usr_${crypto.randomUUID().replace(/-/g, '')}`;
    cleanupUserIds.push(id);
    await db.insert(schema.user).values({
      id,
      name: email.split('@')[0],
      email: email.toLowerCase(),
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  test('changeEmail rewrites the email and returns the user id', async () => {
    const stamp = Date.now();
    const oldEmail = `old-${stamp}@sailscoring.test`;
    const newEmail = `new-${stamp}@sailscoring.test`;
    const id = await makeUser(oldEmail);

    const result = await changeEmail(db, { oldEmail, newEmail });
    expect(result.userId).toBe(id);
    expect(result.previousEmail).toBe(oldEmail);
    expect(result.newEmail).toBe(newEmail);

    const [row] = await db
      .select({ email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.id, id));
    expect(row?.email).toBe(newEmail);
  });

  test('changeEmail lowercases inputs', async () => {
    const stamp = Date.now();
    const oldEmail = `case-${stamp}@sailscoring.test`;
    const id = await makeUser(oldEmail);

    await changeEmail(db, {
      oldEmail: `  CASE-${stamp}@SAILSCORING.TEST  `,
      newEmail: `Mixed-${stamp}@Sailscoring.Test`,
    });

    const [row] = await db
      .select({ email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.id, id));
    expect(row?.email).toBe(`mixed-${stamp}@sailscoring.test`);
  });

  test('changeEmail rejects when the old email is unknown', async () => {
    await expect(
      changeEmail(db, {
        oldEmail: `nobody-${Date.now()}@sailscoring.test`,
        newEmail: `someone@sailscoring.test`,
      }),
    ).rejects.toThrow(/no user with email/);
  });

  test('changeEmail rejects when the new email is already taken', async () => {
    const stamp = Date.now();
    const a = `a-${stamp}@sailscoring.test`;
    const b = `b-${stamp}@sailscoring.test`;
    await makeUser(a);
    await makeUser(b);

    await expect(
      changeEmail(db, { oldEmail: a, newEmail: b }),
    ).rejects.toThrow(/already in use/);
  });

  test('changeEmail rejects when old and new are the same', async () => {
    const stamp = Date.now();
    const email = `same-${stamp}@sailscoring.test`;
    await makeUser(email);
    await expect(
      changeEmail(db, { oldEmail: email, newEmail: email.toUpperCase() }),
    ).rejects.toThrow(/same/);
  });
});
