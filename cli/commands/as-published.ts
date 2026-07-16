import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { ApiError, SailscoringClient } from '../client';
import { resolveConfig } from '../config';

/**
 * `sailscoring as-published …` — the archive-repo side of ADR-010 (#283).
 * What a class archive's CI runs after a push: upload the generated ingest
 * documents (idempotent — unchanged documents are no-ops server-side), then
 * apply the identity manifest. A pure `/api/v1` client like the rest of the
 * CLI; the credential is the workspace's `archivist` key.
 *
 *   as-published push <dir> [--convert] [--force]
 *       <dir>/series/*.json ingest documents + optional <dir>/identities.json
 *   as-published push-series <file…> [--convert] [--force]
 *   as-published identities <manifest.json>
 *   as-published delete <seriesId…>
 */

function makeClient(flags: Record<string, string>): SailscoringClient | null {
  const cfg = resolveConfig({ baseUrl: flags['base-url'] });
  if (!cfg.token) {
    console.error(
      'not logged in — run `sailscoring auth login` (or set SAILSCORING_TOKEN)',
    );
    return null;
  }
  return new SailscoringClient({
    baseUrl: cfg.baseUrl,
    token: cfg.token,
    workspace:
      flags.workspace && flags.workspace !== 'true' ? flags.workspace : undefined,
  });
}

interface SeriesDocFile {
  path: string;
  doc: { series?: { id?: string; name?: string } };
}

function readDocFile(path: string): SeriesDocFile {
  const doc = JSON.parse(readFileSync(path, 'utf8')) as SeriesDocFile['doc'];
  return { path, doc };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run a request, riding out 429s: sleep the server's retry-after (or 10s)
 *  and try again, up to five times. A bulk push over a plain-rate-limit key
 *  must degrade to slower, never to half-ingested. */
async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const retryAfter =
        err instanceof ApiError && err.status === 429
          ? ((err.body as { retryAfter?: number } | undefined)?.retryAfter ?? 10)
          : null;
      if (retryAfter === null || attempt >= 5) throw err;
      console.error(`  … rate-limited, retrying in ${retryAfter}s`);
      await sleep(retryAfter * 1000);
    }
  }
}

async function pushDocs(
  client: SailscoringClient,
  files: SeriesDocFile[],
  opts: { convert: boolean; force: boolean },
): Promise<number> {
  let applied = 0;
  let unchanged = 0;
  let failed = 0;
  for (const file of files) {
    const id = file.doc.series?.id;
    const name = file.doc.series?.name ?? file.path;
    if (!id) {
      console.error(`  ✗ ${file.path}: no series.id in document`);
      failed++;
      continue;
    }
    try {
      const result = await withRateLimitRetry(() =>
        client.putArchiveSeries(id, file.doc, opts),
      );
      if (result.unchanged) {
        unchanged++;
      } else {
        applied++;
        const pages = result.published?.pages.length ?? 0;
        console.log(`  ✓ ${name} (${pages} page${pages === 1 ? '' : 's'})`);
      }
    } catch (err) {
      failed++;
      const detail =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${name}: ${detail}`);
    }
  }
  console.log(
    `\n${applied} applied, ${unchanged} unchanged, ${failed} failed (${files.length} total)`,
  );
  return failed > 0 ? 1 : 0;
}

async function pushIdentities(
  client: SailscoringClient,
  manifestPath: string,
): Promise<number> {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  try {
    const r = await withRateLimitRetry(() =>
      client.applyArchiveIdentities(manifest),
    );
    console.log(
      `identities: ${r.manifest.identitiesWritten} from the manifest (${r.manifest.competitorsLinked} rows linked), ${r.autoPass.identitiesCreated} drafted (${r.autoPass.competitorsLinked} rows linked), ${r.orphansRemoved} orphaned removed`,
    );
    if (r.manifest.unresolvedMembers > 0) {
      console.error(
        `  ⚠ ${r.manifest.unresolvedMembers} manifest member rows did not resolve`,
      );
    }
    if (r.manifest.duplicateSlugs.length > 0) {
      console.error(
        `  ⚠ duplicate manifest slugs: ${r.manifest.duplicateSlugs.join(', ')}`,
      );
    }
    return 0;
  } catch (err) {
    console.error(
      `identities failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
}

async function pushRankingDocs(
  client: SailscoringClient,
  paths: string[],
  opts: { force: boolean },
): Promise<number> {
  let applied = 0;
  let unchanged = 0;
  let failed = 0;
  for (const path of paths) {
    const doc = JSON.parse(readFileSync(path, 'utf8')) as {
      ranking?: { id?: string; name?: string };
    };
    const id = doc.ranking?.id;
    const name = doc.ranking?.name ?? path;
    if (!id) {
      console.error(`  \u2717 ${path}: no ranking.id in document`);
      failed++;
      continue;
    }
    try {
      const result = await withRateLimitRetry(() =>
        client.putArchiveRanking(id, doc, opts),
      );
      if (result.unchanged) {
        unchanged++;
      } else {
        applied++;
        console.log(
          `  \u2713 ${name} (${result.rankedCount} ranked, ${result.linkedRows} linked)`,
        );
      }
    } catch (err) {
      failed++;
      const detail =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
      console.error(`  \u2717 ${name}: ${detail}`);
    }
  }
  console.log(
    `\n${applied} applied, ${unchanged} unchanged, ${failed} failed (${paths.length} total)`,
  );
  return failed > 0 ? 1 : 0;
}

export async function asPublishedCommand(
  rest: string[],
): Promise<number> {
  const [verb, ...r] = rest;
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < r.length; i++) {
    const arg = r[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = r[i + 1];
      if (next === undefined || next.startsWith('--')) flags[key] = 'true';
      else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(arg);
    }
  }
  const opts = {
    convert: flags.convert === 'true',
    force: flags.force === 'true',
  };

  const client = makeClient(flags);
  if (!client) return 1;

  switch (verb) {
    case 'push': {
      const dir = positional[0];
      if (!dir) {
        console.error('as-published push: a directory is required');
        return 1;
      }
      const seriesDir = join(dir, 'series');
      let entries: string[];
      try {
        entries = readdirSync(seriesDir)
          .filter((f) => f.endsWith('.json'))
          .sort()
          .map((f) => join(seriesDir, f));
      } catch {
        console.error(`as-published push: no series/ directory under ${dir}`);
        return 1;
      }
      const files = entries.map(readDocFile);
      console.log(`pushing ${files.length} series documents from ${seriesDir}`);
      const pushExit = await pushDocs(client, files, opts);

      const manifestPath = join(dir, 'identities.json');
      let hasManifest = false;
      try {
        hasManifest = statSync(manifestPath).isFile();
      } catch {
        hasManifest = false;
      }
      let idExit = 0;
      if (hasManifest) idExit = await pushIdentities(client, manifestPath);

      // Season rankings (#309): optional rankings/ subdir of ranking
      // ingest documents, pushed after identities so slugs referenced by
      // rows already exist (order isn't load-bearing — ids are
      // deterministic — but the summary reads better).
      const rankingsDir = join(dir, 'rankings');
      let rankingEntries: string[] = [];
      try {
        rankingEntries = readdirSync(rankingsDir)
          .filter((f) => f.endsWith('.json'))
          .sort()
          .map((f) => join(rankingsDir, f));
      } catch {
        rankingEntries = [];
      }
      let rankExit = 0;
      if (rankingEntries.length > 0) {
        console.log(`pushing ${rankingEntries.length} ranking documents from ${rankingsDir}`);
        rankExit = await pushRankingDocs(client, rankingEntries, opts);
      }
      return pushExit || idExit || rankExit;
    }
    case 'push-ranking': {
      if (positional.length === 0) {
        console.error('as-published push-ranking: at least one file is required');
        return 1;
      }
      return pushRankingDocs(client, positional, opts);
    }
    case 'delete-ranking': {
      if (positional.length === 0) {
        console.error('as-published delete-ranking: at least one rankingId is required');
        return 1;
      }
      let failed = 0;
      for (const id of positional) {
        try {
          await client.deleteArchiveRanking(id);
          console.log(`  \u2713 ${id}`);
        } catch (err) {
          failed++;
          console.error(
            `  \u2717 ${id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      return failed > 0 ? 1 : 0;
    }
    case 'push-series': {
      if (positional.length === 0) {
        console.error('as-published push-series: at least one file is required');
        return 1;
      }
      return pushDocs(client, positional.map(readDocFile), opts);
    }
    case 'identities': {
      const file = positional[0];
      if (!file) {
        console.error('as-published identities: a manifest file is required');
        return 1;
      }
      return pushIdentities(client, file);
    }
    case 'delete': {
      if (positional.length === 0) {
        console.error('as-published delete: at least one seriesId is required');
        return 1;
      }
      let failed = 0;
      for (const id of positional) {
        try {
          await client.deleteArchiveSeries(id);
          console.log(`  ✓ ${id}`);
        } catch (err) {
          failed++;
          console.error(
            `  ✗ ${id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      return failed > 0 ? 1 : 0;
    }
    default:
      console.error(
        `as-published: unknown verb \`${verb ?? ''}\` (expected push|push-series|identities|delete)`,
      );
      return 1;
  }
}
