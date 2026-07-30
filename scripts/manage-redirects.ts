/**
 * Operator maintenance of the static public-URL redirect table (ADR-011):
 * when the publication tree is restructured, the old paths land here and the
 * `/p/` route 301s them. Deliberately no UI surface.
 *
 *   pnpm redirects:test list <workspace-slug>
 *   pnpm redirects:test add <workspace-slug> <from-path> <to-path>
 *   pnpm redirects:test remove <workspace-slug> <from-path>
 *
 * Paths are relative to `/p/{ws}/` (no leading slash), e.g.
 * `add m15 2026-westerns/standings 2026/westerns/standings`. `add` upserts;
 * a redirect only fires when the from-path 404s, so entries can be staged
 * before the content moves.
 */

import { and, asc, eq } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';

const PATH_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

function usage(): never {
  console.error(
    'usage: redirects list <workspace-slug>\n' +
      '       redirects add <workspace-slug> <from-path> <to-path>\n' +
      '       redirects remove <workspace-slug> <from-path>',
  );
  process.exit(2);
}

async function workspaceId(slug: string): Promise<string> {
  const [row] = await getDb()
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(eq(schema.organization.slug, slug))
    .limit(1);
  if (!row) {
    console.error(`no workspace with slug "${slug}"`);
    process.exit(1);
  }
  return row.id;
}

function checkPath(path: string, name: string): string {
  const trimmed = path.replace(/^\/+|\/+$/g, '');
  if (!PATH_RE.test(trimmed)) {
    console.error(`${name} "${path}" is not a /p/ path (lowercase slug segments)`);
    process.exit(1);
  }
  return trimmed;
}

/** The database host in play, so a run against the wrong environment is
 *  visible immediately (credentials masked). */
function targetDescription(): string {
  const url = process.env.DATABASE_URL;
  if (!url) return 'DATABASE_URL is not set';
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`;
  } catch {
    return 'DATABASE_URL is not a parseable URL';
  }
}

async function main(): Promise<void> {
  const [cmd, wsSlug, from, to] = process.argv.slice(2);
  if (!cmd || !wsSlug) usage();
  console.error(`database: ${targetDescription()}`);
  const ws = await workspaceId(wsSlug);

  if (cmd === 'list') {
    const rows = await getDb()
      .select({
        fromPath: schema.publishedRedirects.fromPath,
        toPath: schema.publishedRedirects.toPath,
      })
      .from(schema.publishedRedirects)
      .where(eq(schema.publishedRedirects.workspaceId, ws))
      .orderBy(asc(schema.publishedRedirects.fromPath));
    for (const r of rows) {
      console.log(`/p/${wsSlug}/${r.fromPath} -> /p/${wsSlug}/${r.toPath}`);
    }
    console.log(`${rows.length} redirect${rows.length === 1 ? '' : 's'}`);
    return;
  }

  if (cmd === 'add') {
    if (!from || !to) usage();
    const fromPath = checkPath(from, 'from-path');
    const toPath = checkPath(to, 'to-path');
    if (fromPath === toPath) {
      console.error('from-path and to-path are the same');
      process.exit(1);
    }
    await getDb()
      .insert(schema.publishedRedirects)
      .values({ workspaceId: ws, fromPath, toPath })
      .onConflictDoUpdate({
        target: [
          schema.publishedRedirects.workspaceId,
          schema.publishedRedirects.fromPath,
        ],
        set: { toPath },
      });
    console.log(`/p/${wsSlug}/${fromPath} -> /p/${wsSlug}/${toPath}`);
    return;
  }

  if (cmd === 'remove') {
    if (!from) usage();
    const fromPath = checkPath(from, 'from-path');
    await getDb()
      .delete(schema.publishedRedirects)
      .where(
        and(
          eq(schema.publishedRedirects.workspaceId, ws),
          eq(schema.publishedRedirects.fromPath, fromPath),
        ),
      );
    console.log(`removed /p/${wsSlug}/${fromPath}`);
    return;
  }

  usage();
}

main().then(
  () => process.exit(0),
  (err) => {
    // Drizzle wraps the driver error; the wrapped cause (ECONNREFUSED, SSL,
    // auth, missing relation) is the part that says what actually happened.
    console.error(err);
    for (let cause = (err as Error)?.cause; cause; cause = (cause as Error)?.cause) {
      console.error('caused by:', cause);
    }
    process.exit(1);
  },
);
