/**
 * ADR-009 M3 — `sailscoring` CLI entry point. A pure `/api/v1` client (no
 * `DATABASE_URL`); run locally with `pnpm cli <subcommand>`.
 *
 *   sailscoring auth login [--token <token>] [--base-url <url>]
 *   sailscoring import <files…> [--workspace <slug-or-id>] [--base-url <url>] [--concurrency <n>]
 */

import { loginCommand } from './commands/login';
import { importCommand } from './commands/import';
import { publishCommand } from './commands/publish';
import { DEFAULT_BASE_URL } from './config';

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
  return `sailscoring — ADR-009 CLI (a /api/v1 client)

  auth login [--token <token>] [--base-url <url>]
      Save and verify a Bearer token. Omit --token to paste it at a prompt.
      Default base URL: ${DEFAULT_BASE_URL}.

  import <files…> [--workspace <slug-or-id>] [--base-url <url>] [--concurrency <n>]
                  [--publish | --publish-slug <slug>] [--subpath f=p,…]
      Bulk-import .sailscoring files into the active workspace. Resumable:
      failures are reported but don't stop the batch, and a re-run replays
      already-imported files. --workspace overrides the token's default.
      --publish-slug co-publishes every imported series under one slug (the
      IODAI case); --publish gives each its own derived slug.

  publish [--slug <slug>] [--subpath f=p,…] [--fleets a,b] [--default-subpath p] <seriesId…>
      Publish series standings. With --slug the series co-publish into one
      shared namespace; without, each gets its own derived slug.

Env: SAILSCORING_TOKEN and SAILSCORING_BASE_URL override the saved config.`;
}

export async function runCli(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (!command || command === '--help' || command === '-h') {
    console.log(usage());
    return command ? 0 : 1;
  }

  switch (command) {
    case 'auth': {
      const [sub, ...authRest] = rest;
      if (sub !== 'login') {
        console.error(`unknown auth subcommand: ${sub ?? '(none)'}\n`);
        console.error(usage());
        return 1;
      }
      return loginCommand(parseArgs(authRest).flags);
    }
    case 'import': {
      const { positional, flags } = parseArgs(rest);
      return importCommand(positional, flags);
    }
    case 'publish': {
      const { positional, flags } = parseArgs(rest);
      return publishCommand(positional, flags);
    }
    default:
      console.error(`unknown command: ${command}\n`);
      console.error(usage());
      return 1;
  }
}

// `tsx cli/index.ts` runs this directly; importing it from a test does not.
const isMain = require.main === module;
if (isMain) {
  void runCli(process.argv.slice(2)).then((code) => process.exit(code));
}
