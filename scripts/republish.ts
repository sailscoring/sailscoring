/**
 * Operator re-publish pass: re-run the publish for existing publications so
 * the hosted `/p/` pages catch up with the current renderer.
 *
 * A published page is an immutable stored blob. Nothing re-renders it when the
 * renderer changes, so a page published before a rendering change keeps
 * serving its old HTML until its series is next republished — which, for a
 * finished series, may be never. This pass republishes on the scorer's behalf,
 * under a guard that keeps it from publishing anything they have not:
 *
 *   - Only publications whose series is unchanged since the last publish are
 *     rebuilt (`series.version` still equals `published_version`). Anything
 *     with pending edits is left for the scorer, whose next deliberate publish
 *     brings it up to date anyway.
 *   - Orphaned publications (their series deleted) and as-published archives
 *     are never touched: there is nothing live to render them from.
 *   - The rebuild re-renders exactly the live pages (`rebuildOnly` in the
 *     publish handler): a build that would add or drop a page is refused, and
 *     no revision is pinned.
 *   - The publication's blobs must live in the storage backend this run is
 *     configured for — Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set, the
 *     `published_blobs` table otherwise. A mismatch is a skip, never a
 *     silent migration.
 *
 * Without `--apply` nothing is written: the pass reports what it would do.
 *
 * Usage (against the production DATABASE_URL — see docs/account-admin.md):
 *   pnpm republish                          # report only
 *   pnpm republish --workspace hyc          # one workspace
 *   pnpm republish --series <uuid>          # one series
 *   pnpm republish --apply --limit 3        # rebuild the first three candidates
 *   pnpm republish --apply                  # rebuild everything eligible
 *
 * Reads DATABASE_URL, BLOB_READ_WRITE_TOKEN and NEXT_PUBLIC_APP_URL. The app
 * URL is required to apply: the renderer only replaces the embedded payload
 * with a link to the published data file when it knows where the app is.
 */

import { asc, eq, or } from 'drizzle-orm';

import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import type { WorkspaceRole } from '@/lib/auth/permissions';
import { BadRequestError } from '@/app/api/v1/_lib/handler';
import { publishSeries } from '@/lib/api-handlers/publish';
import { getDb, getDbClient, type SailScoringDb } from '@/lib/db/client';
import { member, organization, user } from '@/lib/db/schema/auth';
import { publishedSeries, series } from '@/lib/db/schema/series';
import { computeEffectiveFeatures } from '@/lib/features';
import { getPublishedBySeries } from '@/lib/published-repository';
import type { PublishedSeriesPage } from '@/lib/types';

/** One publication as the pass sees it: the row joined to its workspace and
 *  (when it still has one) its series. */
export interface PublicationRow {
  id: string;
  slug: string;
  pages: PublishedSeriesPage[];
  dataBlobUrl: string | null;
  contentHash: string;
  publishedVersion: number;
  workspaceId: string;
  workspaceSlug: string;
  seriesId: string | null;
  seriesName: string | null;
  seriesVersion: number | null;
  asPublished: boolean | null;
}

export type Backend = 'db' | 'blob';

/** Which storage backend a publication's blobs live in, from the shape of
 *  their locators (`db:{key}` for the Postgres fallback, a URL for Vercel
 *  Blob). `mixed` should not happen; it is reported rather than guessed at. */
export function publicationBackend(row: PublicationRow): Backend | 'mixed' {
  const locators = [...row.pages.map((p) => p.blobUrl), ...(row.dataBlobUrl ? [row.dataBlobUrl] : [])];
  const inDb = locators.filter((l) => l.startsWith('db:')).length;
  if (inDb === 0) return 'blob';
  if (inDb === locators.length) return 'db';
  return 'mixed';
}

export type Verdict =
  | { kind: 'rebuild' }
  | { kind: 'skip'; reason: string };

/** Whether the pass may rebuild a publication, and if not, why. Pure — the
 *  DB facts come in, the decision goes out — so the guard is testable on its
 *  own. `configured` is the backend this run writes to. */
export function classify(row: PublicationRow, configured: Backend): Verdict {
  if (row.seriesId === null || row.seriesVersion === null) {
    return { kind: 'skip', reason: 'orphaned (its series was deleted)' };
  }
  if (row.asPublished) {
    return { kind: 'skip', reason: 'as-published archive' };
  }
  if (row.seriesVersion !== row.publishedVersion) {
    return {
      kind: 'skip',
      reason: `pending edits (series v${row.seriesVersion}, published v${row.publishedVersion})`,
    };
  }
  const backend = publicationBackend(row);
  if (backend !== configured) {
    return {
      kind: 'skip',
      reason:
        backend === 'mixed'
          ? 'blobs split across storage backends'
          : `blobs are in ${backend === 'db' ? 'the published_blobs table' : 'Vercel Blob'} but this run writes to ${configured === 'db' ? 'the published_blobs table' : 'Vercel Blob'}`,
    };
  }
  return { kind: 'rebuild' };
}

export function configuredBackend(): Backend {
  return process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'db';
}

export async function listPublications(
  db: SailScoringDb,
  filter: { workspace?: string; series?: string } = {},
): Promise<PublicationRow[]> {
  const rows = await db
    .select({
      id: publishedSeries.id,
      slug: publishedSeries.slug,
      pages: publishedSeries.pages,
      dataBlobUrl: publishedSeries.dataBlobUrl,
      contentHash: publishedSeries.contentHash,
      publishedVersion: publishedSeries.publishedVersion,
      workspaceId: publishedSeries.workspaceId,
      workspaceSlug: organization.slug,
      seriesId: publishedSeries.seriesId,
      seriesName: series.name,
      seriesVersion: series.version,
      asPublished: series.asPublished,
    })
    .from(publishedSeries)
    .innerJoin(organization, eq(organization.id, publishedSeries.workspaceId))
    .leftJoin(series, eq(series.id, publishedSeries.seriesId))
    .orderBy(asc(organization.slug), asc(publishedSeries.slug), asc(series.name));
  return rows.filter(
    (r) =>
      (!filter.workspace || r.workspaceSlug === filter.workspace || r.workspaceId === filter.workspace) &&
      (!filter.series || r.seriesId === filter.series),
  );
}

/**
 * The workspace context the publish handler needs, standing in for the
 * request context a scorer's publish would carry. The actor is the
 * workspace's owner (the earliest member failing that): the handler pins no
 * revision on a rebuild, so nothing is attributed to them, but the features
 * that decide which pages a series publishes are computed exactly as they
 * would be for that member — a personal workspace inherits its owner's club
 * features. Null when the workspace has no members left to stand in.
 */
export async function workspaceContextFor(
  db: SailScoringDb,
  workspaceId: string,
  workspaceSlug: string,
): Promise<WorkspaceContext | null> {
  const members = await db
    .select({ userId: member.userId, role: member.role, email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, workspaceId))
    .orderBy(asc(member.createdAt));
  const actor = members.find((m) => m.role === 'owner') ?? members[0];
  if (!actor) return null;
  const memberships = await db
    .select({ slug: organization.slug, metadata: organization.metadata })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, actor.userId));
  return {
    userId: actor.userId,
    email: actor.email,
    workspaceId,
    workspaceSlug,
    role: actor.role as WorkspaceRole,
    features: computeEffectiveFeatures(workspaceSlug, memberships),
  };
}

export type Outcome =
  | { kind: 'rebuilt'; pages: number; dataFile: boolean }
  | { kind: 'unchanged' }
  | { kind: 'skip'; reason: string }
  | { kind: 'failed'; message: string };

/** Rebuild one publication in place. Reports rather than throws: the pass
 *  keeps going past a row that fails. */
export async function rebuildPublication(
  db: SailScoringDb,
  row: PublicationRow,
): Promise<Outcome> {
  const ctx = await workspaceContextFor(db, row.workspaceId, row.workspaceSlug);
  if (!ctx) return { kind: 'skip', reason: 'workspace has no members' };
  try {
    await publishSeries(ctx, row.seriesId!, {}, { rebuildOnly: true });
  } catch (err) {
    if (err instanceof BadRequestError) {
      const issues = (err.issues ?? {}) as { code?: string; added?: string[]; removed?: string[] };
      if (issues.code === 'page-set-changed') {
        const parts = [
          ...(issues.added?.length ? [`would add ${issues.added.join(', ')}`] : []),
          ...(issues.removed?.length ? [`would drop ${issues.removed.join(', ')}`] : []),
        ];
        return { kind: 'skip', reason: `page set changed (${parts.join('; ')})` };
      }
    }
    return { kind: 'failed', message: err instanceof Error ? err.message : String(err) };
  }
  const after = await getPublishedBySeries(row.seriesId!);
  if (!after) return { kind: 'failed', message: 'publication vanished during rebuild' };
  if (after.contentHash === row.contentHash) return { kind: 'unchanged' };
  return { kind: 'rebuilt', pages: after.pages.length, dataFile: Boolean(after.dataBlobUrl) };
}

function describe(row: PublicationRow): string {
  const pages = `${row.pages.length} page${row.pages.length === 1 ? '' : 's'}`;
  const data = row.dataBlobUrl ? 'data file' : 'no data file';
  return `${row.seriesName ?? '(deleted series)'} — ${pages}, ${data}`;
}

function label(row: PublicationRow): string {
  return `${row.workspaceSlug}/${row.slug}`;
}

interface ParsedFlags {
  positional: string[];
  flags: Record<string, string>;
}

function parseArgs(argv: string[]): ParsedFlags {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = 'true';
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function usage(): string {
  return `republish — re-run the publish for existing publications

  pnpm republish [--workspace <slug-or-id>] [--series <id>] [--limit <n>] [--apply]

Rebuilds each publication's live pages with the current renderer, for
series unchanged since they were last published. Skips publications with
pending edits (the scorer's next publish brings those up to date), orphans,
as-published archives, and anything whose blobs live in a different storage
backend from the one this run writes to.

Without --apply, prints what would be rebuilt and why the rest is skipped.
--limit caps how many publications --apply rebuilds, for a trial pass.

Reads DATABASE_URL, BLOB_READ_WRITE_TOKEN (Vercel Blob; unset means the
published_blobs table) and NEXT_PUBLIC_APP_URL (required to apply).`;
}

export async function runCli(argv: string[]): Promise<number> {
  const { positional, flags } = parseArgs(argv);
  if (flags.help || flags.h || positional.length > 0) {
    console.log(usage());
    return positional.length > 0 ? 1 : 0;
  }
  const apply = flags.apply === 'true';
  const limit = flags.limit ? Number.parseInt(flags.limit, 10) : Number.POSITIVE_INFINITY;
  if (Number.isNaN(limit) || limit < 1) {
    console.error('--limit must be a positive integer');
    return 1;
  }

  const configured = configuredBackend();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (apply && !appUrl) {
    console.error(
      'NEXT_PUBLIC_APP_URL is not set. Without it the renderer keeps embedding the series in every page instead of linking the data file — set it to the app origin the pages are served from.',
    );
    return 1;
  }
  console.log(
    `storage: ${configured === 'blob' ? 'Vercel Blob' : 'published_blobs table (no BLOB_READ_WRITE_TOKEN)'}; app url: ${appUrl ?? '(unset)'}; mode: ${apply ? 'apply' : 'report only'}`,
  );

  const db = getDb();
  const rows = await listPublications(db, {
    workspace: flags.workspace,
    series: flags.series,
  });
  if (rows.length === 0) {
    console.log('no publications match');
    return 0;
  }

  const counts = { rebuild: 0, rebuilt: 0, unchanged: 0, skipped: 0, failed: 0 };
  let acted = 0;
  const width = Math.min(60, Math.max(...rows.map((r) => label(r).length)));
  for (const row of rows) {
    const verdict = classify(row, configured);
    const name = label(row).padEnd(width);
    if (verdict.kind === 'skip') {
      counts.skipped++;
      console.log(`${name}  skip       ${verdict.reason}`);
      continue;
    }
    if (!apply) {
      counts.rebuild++;
      console.log(`${name}  rebuild    ${describe(row)}`);
      continue;
    }
    if (acted >= limit) {
      counts.rebuild++;
      console.log(`${name}  deferred   over --limit; ${describe(row)}`);
      continue;
    }
    acted++;
    const outcome = await rebuildPublication(db, row);
    switch (outcome.kind) {
      case 'rebuilt':
        counts.rebuilt++;
        console.log(
          `${name}  rebuilt    ${outcome.pages} page${outcome.pages === 1 ? '' : 's'}, ${outcome.dataFile ? 'data file' : 'no data file'}`,
        );
        break;
      case 'unchanged':
        counts.unchanged++;
        console.log(`${name}  unchanged  already renders identically`);
        break;
      case 'skip':
        counts.skipped++;
        console.log(`${name}  skip       ${outcome.reason}`);
        break;
      case 'failed':
        counts.failed++;
        console.log(`${name}  FAILED     ${outcome.message}`);
        break;
    }
  }

  const summary = apply
    ? `rebuilt ${counts.rebuilt}, unchanged ${counts.unchanged}, skipped ${counts.skipped}, failed ${counts.failed}` +
      (counts.rebuild > 0 ? `, deferred ${counts.rebuild}` : '')
    : `would rebuild ${counts.rebuild}, skip ${counts.skipped}`;
  console.log(`\n${rows.length} publication${rows.length === 1 ? '' : 's'}: ${summary}`);
  return counts.failed > 0 ? 1 : 0;
}

// "main module" check. `tsx scripts/republish.ts` runs this file directly;
// importing it from a test does not.
const isMain = require.main === module;
if (isMain) {
  void (async () => {
    let code = 1;
    try {
      code = await runCli(process.argv.slice(2));
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
    }
    await getDbClient().end();
    process.exit(code);
  })();
}
