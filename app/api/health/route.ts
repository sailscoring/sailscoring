import { sql } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ status: 'ok' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return Response.json(
      { status: 'error', error: message },
      { status: 503 },
    );
  }
}
