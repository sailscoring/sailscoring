import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import * as schema from './schema';

export type SailScoringDb = PostgresJsDatabase<typeof schema>;

let cachedClient: Sql | null = null;
let cachedDb: SailScoringDb | null = null;

function ensureDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required for server-side database access');
  }
  return url;
}

/**
 * Lazily-initialised Drizzle client. Defers connection setup until the
 * first call so `next build` and `next dev` don't require DATABASE_URL
 * during ADR-008 Phase 1 (where the server backend is wired but not yet
 * consumed by the UI).
 */
export function getDb(): SailScoringDb {
  if (!cachedDb) {
    cachedClient = postgres(ensureDatabaseUrl(), { prepare: false });
    cachedDb = drizzle(cachedClient, { schema });
  }
  return cachedDb;
}

export function getDbClient(): Sql {
  if (!cachedClient) {
    cachedClient = postgres(ensureDatabaseUrl(), { prepare: false });
  }
  return cachedClient;
}
