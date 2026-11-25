/**
 * Operator purge of the public `/p` pages from Vercel's CDN.
 *
 * The CDN keeps a `/p` page until something purges its workspace's tag.
 * Every write the app makes on a request purges for itself. This command is
 * for the writes that happen outside a request, where there's no CDN to
 * reach: `provision-org`'s rename, feature toggles and delete, `republish`,
 * the publication backfills, a migration, anything run through `db:psql`.
 * Those scripts print the command to run when they've written.
 *
 *   pnpm public-cache:purge:prod <workspace-id>…   # those workspaces' pages and the directory
 *   pnpm public-cache:purge:prod --directory       # the directory (/p, /p/index.json) alone
 *   pnpm public-cache:purge:prod --dry-run <id>…   # print the command without running it
 *
 * Takes workspace ids, not slugs, so it needs no database: it runs under
 * `vercel-env.sh` alone, and works for a workspace that has just been
 * deleted. A change spanning every workspace (a migration) is better served
 * by `pnpm vercel cache purge`, which empties the project's whole CDN.
 *
 * Deletes rather than invalidates, for the reason `lib/published-cache.ts`
 * gives: the next reader gets the new page, not the stale one.
 */

import { spawnSync } from 'node:child_process';

import { DIRECTORY_CACHE_TAG, publishedCacheTag } from '@/lib/published-cache';

export interface PurgeRequest {
  tags: string[];
  dryRun: boolean;
}

/** Workspace ids are Better Auth's own tokens: no spaces, and no commas,
 *  which would split a tag in the CLI's comma-separated list. */
const WORKSPACE_ID_RE = /^[A-Za-z0-9_-]+$/;

export function parsePurgeArgs(argv: string[]): PurgeRequest {
  let dryRun = false;
  let directory = false;
  const ids: string[] = [];
  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--directory') directory = true;
    else if (arg.startsWith('-')) throw new Error(`unknown option ${arg}`);
    else if (!WORKSPACE_ID_RE.test(arg)) throw new Error(`not a workspace id: "${arg}"`);
    else ids.push(arg);
  }
  if (ids.length === 0 && !directory) {
    throw new Error('name at least one workspace id, or --directory');
  }
  // A workspace's publications feed the directory, so its purge drops the
  // directory too, as the app's own purge does.
  return { tags: [...ids.map(publishedCacheTag), DIRECTORY_CACHE_TAG], dryRun };
}

function main(): number {
  let request: PurgeRequest;
  try {
    request = parsePurgeArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`purge-public-cache: ${(err as Error).message}`);
    console.error('usage: public-cache:purge:prod [--dry-run] <workspace-id>… | --directory');
    return 2;
  }
  const args = ['cache', 'dangerously-delete', '--tag', request.tags.join(','), '--yes'];
  if (request.dryRun) {
    console.log(['vercel', ...args].join(' '));
    return 0;
  }
  const result = spawnSync('vercel', args, { stdio: 'inherit' });
  if (result.error) {
    console.error(`purge-public-cache: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

if (require.main === module) process.exit(main());
