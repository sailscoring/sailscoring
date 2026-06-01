/**
 * Admin script: print basic per-user stats from the production DB.
 *
 * For each user, reports:
 *   - whether they've ever logged in (Better Auth flips emailVerified true
 *     on first successful magic-link sign-in)
 *   - session count and most recent session createdAt (proxy for last login)
 *   - workspace memberships (counts the personal workspace too)
 *   - series, races, competitors, finishes across all their workspaces
 *
 * Usage:
 *   pnpm user-stats                    # text table
 *   pnpm user-stats --json             # JSON for piping
 *   pnpm user-stats --sort last_login  # sort by column (default: email)
 *
 * Reads DATABASE_URL. Read-only — no writes.
 */

import { eq, sql } from 'drizzle-orm';

import { getDb, getDbClient, type SailScoringDb } from '@/lib/db/client';
import { member, session, user } from '@/lib/db/schema/auth';
import { competitors, finishes, races, series } from '@/lib/db/schema/series';

export interface UserStatsRow {
  userId: string;
  email: string;
  name: string;
  createdAt: Date;
  emailVerified: boolean;
  sessionCount: number;
  lastSessionAt: Date | null;
  workspaceCount: number;
  seriesCount: number;
  raceCount: number;
  competitorCount: number;
  finishCount: number;
}

export async function collectUserStats(db: SailScoringDb): Promise<UserStatsRow[]> {
  const users = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
      emailVerified: user.emailVerified,
    })
    .from(user)
    .orderBy(user.email);

  // One aggregate query per dimension. Each is grouped by user; we stitch
  // them together client-side. Joining competitors + races + finishes in a
  // single SQL aggregate would Cartesian-multiply the row counts, so we
  // keep them separate.
  // `sql<>` casts are TS hints only; the postgres-js driver returns
  // timestamp aggregates as ISO strings, so normalise to Date here.
  const sessionStatsRaw = await db
    .select({
      userId: session.userId,
      sessionCount: sql<number>`count(*)::int`.as('session_count'),
      lastSessionAt: sql<string | null>`max(${session.createdAt})`.as('last_session_at'),
    })
    .from(session)
    .groupBy(session.userId);
  const sessionStats = sessionStatsRaw.map((r) => ({
    userId: r.userId,
    sessionCount: r.sessionCount,
    lastSessionAt: r.lastSessionAt ? new Date(r.lastSessionAt) : null,
  }));

  const workspaceStats = await db
    .select({
      userId: member.userId,
      workspaceCount: sql<number>`count(distinct ${member.organizationId})::int`.as('workspace_count'),
    })
    .from(member)
    .groupBy(member.userId);

  const seriesStats = await db
    .select({
      userId: member.userId,
      seriesCount: sql<number>`count(distinct ${series.id})::int`.as('series_count'),
    })
    .from(member)
    .leftJoin(series, eq(series.workspaceId, member.organizationId))
    .groupBy(member.userId);

  const raceStats = await db
    .select({
      userId: member.userId,
      raceCount: sql<number>`count(distinct ${races.id})::int`.as('race_count'),
    })
    .from(member)
    .leftJoin(races, eq(races.workspaceId, member.organizationId))
    .groupBy(member.userId);

  const competitorStats = await db
    .select({
      userId: member.userId,
      competitorCount: sql<number>`count(distinct ${competitors.id})::int`.as('competitor_count'),
    })
    .from(member)
    .leftJoin(competitors, eq(competitors.workspaceId, member.organizationId))
    .groupBy(member.userId);

  // Finishes don't carry workspace_id (see schema note in series.ts) — reach
  // them via their parent race.
  const finishStats = await db
    .select({
      userId: member.userId,
      finishCount: sql<number>`count(distinct ${finishes.id})::int`.as('finish_count'),
    })
    .from(member)
    .leftJoin(races, eq(races.workspaceId, member.organizationId))
    .leftJoin(finishes, eq(finishes.raceId, races.id))
    .groupBy(member.userId);

  const byUser = <T extends { userId: string }>(rows: T[]): Map<string, T> =>
    new Map(rows.map((r) => [r.userId, r]));

  const sessionByUser = byUser(sessionStats);
  const workspaceByUser = byUser(workspaceStats);
  const seriesByUser = byUser(seriesStats);
  const raceByUser = byUser(raceStats);
  const competitorByUser = byUser(competitorStats);
  const finishByUser = byUser(finishStats);

  return users.map((u) => ({
    userId: u.id,
    email: u.email,
    name: u.name,
    createdAt: u.createdAt,
    emailVerified: u.emailVerified,
    sessionCount: sessionByUser.get(u.id)?.sessionCount ?? 0,
    lastSessionAt: sessionByUser.get(u.id)?.lastSessionAt ?? null,
    workspaceCount: workspaceByUser.get(u.id)?.workspaceCount ?? 0,
    seriesCount: seriesByUser.get(u.id)?.seriesCount ?? 0,
    raceCount: raceByUser.get(u.id)?.raceCount ?? 0,
    competitorCount: competitorByUser.get(u.id)?.competitorCount ?? 0,
    finishCount: finishByUser.get(u.id)?.finishCount ?? 0,
  }));
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

type SortKey =
  | 'email'
  | 'name'
  | 'created'
  | 'last_login'
  | 'sessions'
  | 'workspaces'
  | 'series'
  | 'races'
  | 'competitors'
  | 'finishes';

const SORT_KEYS: SortKey[] = [
  'email',
  'name',
  'created',
  'last_login',
  'sessions',
  'workspaces',
  'series',
  'races',
  'competitors',
  'finishes',
];

function isSortKey(value: string): value is SortKey {
  return (SORT_KEYS as string[]).includes(value);
}

function sortRows(rows: UserStatsRow[], key: SortKey): UserStatsRow[] {
  const copy = [...rows];
  const cmp = (a: UserStatsRow, b: UserStatsRow): number => {
    switch (key) {
      case 'email':
        return a.email.localeCompare(b.email);
      case 'name':
        return a.name.localeCompare(b.name);
      case 'created':
        return a.createdAt.getTime() - b.createdAt.getTime();
      case 'last_login': {
        const av = a.lastSessionAt?.getTime() ?? 0;
        const bv = b.lastSessionAt?.getTime() ?? 0;
        return bv - av; // most recent first
      }
      case 'sessions':
        return b.sessionCount - a.sessionCount;
      case 'workspaces':
        return b.workspaceCount - a.workspaceCount;
      case 'series':
        return b.seriesCount - a.seriesCount;
      case 'races':
        return b.raceCount - a.raceCount;
      case 'competitors':
        return b.competitorCount - a.competitorCount;
      case 'finishes':
        return b.finishCount - a.finishCount;
    }
  };
  return copy.sort(cmp);
}

function fmtDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : '—';
}

function renderTable(rows: UserStatsRow[]): string {
  const header = [
    'email',
    'name',
    'created',
    'verified',
    'sessions',
    'last_login',
    'ws',
    'series',
    'races',
    'comps',
    'finishes',
  ];
  const data = rows.map((r) => [
    r.email,
    r.name || '(no name)',
    fmtDate(r.createdAt),
    r.emailVerified ? 'yes' : 'no',
    String(r.sessionCount),
    fmtDate(r.lastSessionAt),
    String(r.workspaceCount),
    String(r.seriesCount),
    String(r.raceCount),
    String(r.competitorCount),
    String(r.finishCount),
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...data.map((row) => row[i].length)),
  );
  const fmtRow = (cells: string[]): string =>
    cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
  return [fmtRow(header), fmtRow(widths.map((w) => '-'.repeat(w))), ...data.map(fmtRow)].join(
    '\n',
  );
}

function renderSummary(rows: UserStatsRow[]): string {
  const total = rows.length;
  const verified = rows.filter((r) => r.emailVerified).length;
  const everLoggedIn = rows.filter((r) => r.sessionCount > 0).length;
  const withSeries = rows.filter((r) => r.seriesCount > 0).length;
  return [
    `users: ${total}`,
    `email verified: ${verified}`,
    `ever had a session: ${everLoggedIn}`,
    `users with ≥1 series: ${withSeries}`,
  ].join('\n');
}

function usage(): string {
  return `user-stats — basic per-user stats from the production DB

  pnpm user-stats [--json] [--sort <key>]

  --json         emit JSON (one row per user, plus dates as ISO strings)
  --sort <key>   sort by one of: ${SORT_KEYS.join(', ')} (default: email)

Reads DATABASE_URL. Read-only.`;
}

interface ParsedFlags {
  json: boolean;
  sort: SortKey;
}

function parseArgs(argv: string[]): ParsedFlags | { error: string } {
  let json = false;
  let sort: SortKey = 'email';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      json = true;
    } else if (arg === '--sort') {
      const next = argv[i + 1];
      if (!next) return { error: '--sort requires a value' };
      if (!isSortKey(next)) {
        return { error: `unknown sort key "${next}" (expected one of: ${SORT_KEYS.join(', ')})` };
      }
      sort = next;
      i++;
    } else if (arg === '--help' || arg === '-h') {
      return { error: 'help' };
    } else {
      return { error: `unexpected argument: ${arg}` };
    }
  }
  return { json, sort };
}

export async function runCli(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if ('error' in parsed) {
    if (parsed.error === 'help') {
      console.log(usage());
      return 0;
    }
    console.error(`${parsed.error}\n`);
    console.error(usage());
    return 1;
  }

  const db = getDb();
  const rows = sortRows(await collectUserStats(db), parsed.sort);

  if (parsed.json) {
    console.log(
      JSON.stringify(
        rows.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
          lastSessionAt: r.lastSessionAt?.toISOString() ?? null,
        })),
        null,
        2,
      ),
    );
  } else {
    console.log(renderTable(rows));
    console.log();
    console.log(renderSummary(rows));
  }
  return 0;
}

const isMain = require.main === module;
if (isMain) {
  void (async () => {
    const code = await runCli(process.argv.slice(2));
    await getDbClient().end();
    process.exit(code);
  })();
}
