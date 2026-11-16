// @vitest-environment node

/**
 * The database carries its own statement and idle-in-transaction timeouts,
 * so a stalled query or an abandoned transaction ends in an error rather
 * than holding a request until the platform kills the function. They are
 * database defaults, not connection settings, because the app connects
 * through a transaction-mode pooler that doesn't carry session settings.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import postgres, { type Sql } from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

describe.skipIf(skip)('database timeouts', () => {
  let sql!: Sql;

  beforeAll(() => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
  });

  afterAll(async () => {
    await sql?.end();
  });

  test('a new session gets both timeouts without asking', async () => {
    const [st] = await sql`show statement_timeout`;
    const [idle] = await sql`show idle_in_transaction_session_timeout`;
    expect(st.statement_timeout).toBe('1min');
    expect(idle.idle_in_transaction_session_timeout).toBe('1min');
  });

});
