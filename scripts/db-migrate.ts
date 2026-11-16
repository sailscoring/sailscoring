/**
 * Apply Drizzle migrations against DATABASE_URL_UNPOOLED (preferred) or
 * DATABASE_URL. Migrations must use an unpooled connection — PgBouncer
 * transaction-mode pooling breaks DDL.
 *
 * `drizzle-kit migrate` does the same thing, but a hand-rolled runner
 * keeps the production / CI path independent of drizzle-kit (a dev
 * dependency) and lets us log against the migrations table cleanly.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL_UNPOOLED or DATABASE_URL is required');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);

  // The database's own statement and idle-in-transaction timeouts are sized
  // for app requests. A migration's DDL or backfill can legitimately run
  // longer, so this session (max: 1, so every migration runs on it) lifts them.
  await sql`set statement_timeout = 0`;
  await sql`set idle_in_transaction_session_timeout = 0`;

  await migrate(db, { migrationsFolder: 'drizzle' });
  await sql.end();

  console.log('migrations applied');
}

void main();
