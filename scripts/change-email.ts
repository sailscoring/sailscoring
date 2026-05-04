/**
 * Manual admin script for changing a user's login email address.
 *
 * Better Auth's data model has exactly one email per user (see
 * `lib/db/schema/auth.ts:14` — `email` is `unique notNull`). Magic-link
 * is the only configured sign-in method, so a user who loses access to
 * the email they signed up with also loses access to their account
 * unless someone with database access reassigns it.
 *
 * Self-service email change lands later (see ADR-008 Phase 10). Until
 * then this CLI is the supported path. It writes directly to the
 * `user` table — same approach as `scripts/provision-org.ts`, for the
 * same reason: Better Auth's HTTP endpoints want a session and that's
 * awkward from a one-shot admin script.
 *
 * Sessions, organization memberships, and all workspace data are keyed
 * by `user.id`, so they survive the rename untouched.
 *
 * Usage:
 *   pnpm change-email <old-email> <new-email>
 */

import { eq } from 'drizzle-orm';

import { getDb, getDbClient, type SailScoringDb } from '@/lib/db/client';
import { user } from '@/lib/db/schema/auth';

export interface ChangeEmailResult {
  userId: string;
  previousEmail: string;
  newEmail: string;
}

export async function changeEmail(
  db: SailScoringDb,
  args: { oldEmail: string; newEmail: string },
): Promise<ChangeEmailResult> {
  const oldEmail = args.oldEmail.trim().toLowerCase();
  const newEmail = args.newEmail.trim().toLowerCase();
  if (!oldEmail) throw new Error('old email is required');
  if (!newEmail) throw new Error('new email is required');
  if (oldEmail === newEmail) {
    throw new Error('old and new email are the same');
  }

  const [target] = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(eq(user.email, oldEmail))
    .limit(1);
  if (!target) {
    throw new Error(`no user with email "${oldEmail}"`);
  }

  const [collision] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, newEmail))
    .limit(1);
  if (collision) {
    throw new Error(
      `email "${newEmail}" is already in use by another user (id: ${collision.id})`,
    );
  }

  await db.update(user).set({ email: newEmail }).where(eq(user.id, target.id));
  return { userId: target.id, previousEmail: target.email, newEmail };
}

// ─── CLI dispatcher ──────────────────────────────────────────────────────────

function usage(): string {
  return `change-email — admin: reassign a user's login email

  pnpm change-email <old-email> <new-email>

The user's id, sessions, and organization memberships are unchanged;
only the email used for magic-link sign-in is rewritten. Reads
DATABASE_URL.`;
}

export async function runCli(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    console.log(usage());
    return argv.length === 0 ? 1 : 0;
  }
  if (argv.length !== 2) {
    console.error('expected exactly two arguments: <old-email> <new-email>\n');
    console.error(usage());
    return 1;
  }
  const [oldEmail, newEmail] = argv;
  const db = getDb();
  try {
    const result = await changeEmail(db, { oldEmail, newEmail });
    console.log(
      `changed email for user ${result.userId}: ${result.previousEmail} → ${result.newEmail}`,
    );
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const code = await runCli(process.argv.slice(2));
  await getDbClient().end();
  process.exit(code);
}
