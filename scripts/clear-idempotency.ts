/**
 * Clear Idempotency-Key replay records for a workspace.
 *
 * Idempotency rows (`idempotency_keys`, keyed by workspace + Idempotency-Key)
 * outlive the resources they describe: deleting a series does not remove the
 * import row that returned its id, so re-importing the byte-identical file
 * *replays* the old response and hands back a now-dead series id (publish then
 * 404s). Clearing the workspace's rows forces the next identical request to run
 * fresh. Safe to run when no other client is mid-write against the workspace.
 *
 * Usage (production: against the production DATABASE_URL):
 *   pnpm clear-idempotency <workspace-slug-or-id>
 *   pnpm clear-idempotency <workspace-slug-or-id> --key <idempotency-key>   # one key
 */

import { and, eq } from 'drizzle-orm';

import { getDb, getDbClient, type SailScoringDb } from '@/lib/db/client';
import { organization } from '@/lib/db/schema/auth';
import { idempotencyKeys } from '@/lib/db/schema/series';

async function resolveWorkspaceId(
  db: SailScoringDb,
  slugOrId: string,
): Promise<string> {
  const [row] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(
      slugOrId.startsWith('org_')
        ? eq(organization.id, slugOrId)
        : eq(organization.slug, slugOrId),
    )
    .limit(1);
  if (!row) throw new Error(`workspace "${slugOrId}" not found`);
  return row.id;
}

export async function clearIdempotency(
  db: SailScoringDb,
  args: { workspaceSlugOrId: string; key?: string },
): Promise<{ workspaceId: string; cleared: number }> {
  const workspaceId = await resolveWorkspaceId(db, args.workspaceSlugOrId);
  const where = args.key
    ? and(eq(idempotencyKeys.workspaceId, workspaceId), eq(idempotencyKeys.key, args.key))
    : eq(idempotencyKeys.workspaceId, workspaceId);
  const deleted = await db.delete(idempotencyKeys).where(where).returning({ key: idempotencyKeys.key });
  return { workspaceId, cleared: deleted.length };
}

export async function runCli(argv: string[]): Promise<number> {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[arg.slice(2)] = 'true';
      else (flags[arg.slice(2)] = next), i++;
    } else positional.push(arg);
  }

  const [workspaceSlugOrId] = positional;
  if (!workspaceSlugOrId || workspaceSlugOrId === '--help' || workspaceSlugOrId === '-h') {
    console.log(
      'clear-idempotency <workspace-slug-or-id> [--key <idempotency-key>]\n\n' +
        'Deletes Idempotency-Key replay rows for a workspace (or one key), so the\n' +
        'next identical request runs fresh. Reads DATABASE_URL.',
    );
    return workspaceSlugOrId ? 0 : 1;
  }

  const db = getDb();
  try {
    const key = flags.key && flags.key !== 'true' ? flags.key : undefined;
    const { workspaceId, cleared } = await clearIdempotency(db, { workspaceSlugOrId, key });
    console.log(
      `cleared ${cleared} idempotency row(s) for workspace ${workspaceSlugOrId} (${workspaceId})`,
    );
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

const isMain = require.main === module;
if (isMain) {
  void (async () => {
    const code = await runCli(process.argv.slice(2));
    await getDbClient().end();
    process.exit(code);
  })();
}
