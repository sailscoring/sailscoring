/**
 * ADR-009 — `sailscoring` CLI entry point. A pure `/api/v1` client (no
 * `DATABASE_URL`); run locally with `pnpm cli <command>`.
 *
 * Resource grammar (M4): `sailscoring <noun> <verb>`, with `list`/`get` the
 * universal read verbs. The M3 action verbs live under `series`
 * (`series import|publish|categorise|archive`); `import` and `publish` are kept
 * as top-level aliases for the bulk workflow the CLI grew out of.
 */

import { loginCommand } from './commands/login';
import { importCommand } from './commands/import';
import { publishCommand } from './commands/publish';
import { categoriseCommand } from './commands/categorise';
import { archiveCommand } from './commands/archive';
import {
  activityListCommand,
  categoryListCommand,
  competitorListCommand,
  fleetListCommand,
  publishedGetCommand,
  publishedListCommand,
  raceListCommand,
  seriesGetCommand,
  seriesListCommand,
  standingsGetCommand,
  subSeriesListCommand,
  whoamiCommand,
} from './commands/read';
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

Auth
  auth login [--token <token>] [--base-url <url>]
      Save and verify a Bearer token. Omit --token to paste it at a prompt.
      Default base URL: ${DEFAULT_BASE_URL}.
  whoami
      Show the resolved identity and active workspace (role, features).

Series
  series list
  series get <seriesId>
  series import <files…> [--workspace <id>] [--concurrency <n>]
                 [--publish | --publish-slug <slug>] [--subpath f=p,…]
                 [--category <name>] [--archive]
  series publish [--slug <slug>] [--subpath f=p,…] [--fleets a,b] <seriesId…>
  series categorise <seriesId…> --category <name>
  series archive <seriesId…> [--unarchive]
      (import and publish are also available as top-level aliases.)

Reads (all accept --json / --output json; child resources take --series <id>)
  competitor list --series <id>
  race list --series <id>
  fleet list --series <id>
  sub-series list --series <id>
  category list
  published list | published get <seriesId>
  activity list [--series <id>]
  standings get <seriesId> [--fleet <name>]

Env: SAILSCORING_TOKEN and SAILSCORING_BASE_URL override the saved config.`;
}

/** Resources that currently expose only `list`. */
function listOnly(
  noun: string,
  rest: string[],
  command: (flags: Record<string, string>) => Promise<number>,
): Promise<number> {
  const [verb, ...r] = rest;
  if (verb !== 'list') {
    console.error(`${noun}: only \`list\` is supported (got \`${verb ?? ''}\`)`);
    return Promise.resolve(1);
  }
  return command(parseArgs(r).flags);
}

function seriesDispatch(rest: string[]): Promise<number> {
  const [verb, ...r] = rest;
  const { positional, flags } = parseArgs(r);
  switch (verb) {
    case 'list':
      return seriesListCommand(flags);
    case 'get':
      return seriesGetCommand(positional, flags);
    case 'import':
      return importCommand(positional, flags);
    case 'publish':
      return publishCommand(positional, flags);
    case 'categorise':
    case 'categorize':
      return categoriseCommand(positional, flags);
    case 'archive':
      return archiveCommand(positional, flags);
    default:
      console.error(`series: unknown verb \`${verb ?? ''}\``);
      return Promise.resolve(1);
  }
}

function publishedDispatch(rest: string[]): Promise<number> {
  const [verb, ...r] = rest;
  const { positional, flags } = parseArgs(r);
  if (verb === 'list') return publishedListCommand(flags);
  if (verb === 'get') return publishedGetCommand(positional, flags);
  console.error(`published: unknown verb \`${verb ?? ''}\` (expected list|get)`);
  return Promise.resolve(1);
}

function getOnly(
  noun: string,
  rest: string[],
  command: (positional: string[], flags: Record<string, string>) => Promise<number>,
): Promise<number> {
  const [verb, ...r] = rest;
  if (verb !== 'get') {
    console.error(`${noun}: only \`get\` is supported (got \`${verb ?? ''}\`)`);
    return Promise.resolve(1);
  }
  const { positional, flags } = parseArgs(r);
  return command(positional, flags);
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
    case 'whoami':
      return whoamiCommand(parseArgs(rest).flags);
    case 'series':
      return seriesDispatch(rest);
    case 'competitor':
      return listOnly('competitor', rest, competitorListCommand);
    case 'race':
      return listOnly('race', rest, raceListCommand);
    case 'fleet':
      return listOnly('fleet', rest, fleetListCommand);
    case 'sub-series':
      return listOnly('sub-series', rest, subSeriesListCommand);
    case 'category':
      return listOnly('category', rest, categoryListCommand);
    case 'activity':
      return listOnly('activity', rest, activityListCommand);
    case 'published':
      return publishedDispatch(rest);
    case 'standings':
      return getOnly('standings', rest, standingsGetCommand);
    // Top-level aliases for the bulk workflow the CLI grew out of.
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
