/**
 * Apply Drizzle migrations against DATABASE_URL.
 *
 * `drizzle-kit migrate` does the same thing, but a hand-rolled runner
 * keeps the production / CI path independent of drizzle-kit (a dev
 * dependency) and lets us log against the migrations table cleanly.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(sql);

await migrate(db, { migrationsFolder: 'drizzle' });
await sql.end();

console.log('migrations applied');
