/**
 * Keep the production Vercel Firewall configuration in the repo.
 *
 * `vercel-firewall.json` at the repo root is the whole project firewall: the
 * managed rulesets (Bot Protection, AI bots), the OWASP core ruleset, IP
 * blocks, and the custom rules in priority order. The Vercel CLI only edits
 * the firewall a rule at a time; this script compares the file with the live
 * configuration and, on `apply`, replaces the live configuration with it.
 *
 *   pnpm firewall:diff           # readonly: live config vs the file
 *   pnpm firewall:apply          # show the diff, confirm, then PUT the file
 *   pnpm firewall:apply --yes    # no prompt (required when stdin is not a terminal)
 *
 * Talks to the API through `vercel api`, so it runs as whoever `vercel login`
 * signed in. The file carries no rule ids: a replace removes every rule and
 * inserts it afresh under a new id, so rules are known by name, which must be
 * unique. The OWASP core ruleset (`crs`) is inactive on this plan; a replace
 * stores its categories as off whatever the file says, so the file says off.
 *
 * `apply` refuses while the dashboard holds unpublished draft changes: a PUT
 * would silently discard them. Publish or discard the draft first.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

const PROJECT_ID = 'prj_REAB4vxYwPR0SCHN3RDGA9hpD7ck';
const TEAM_ID = 'team_ugw6yzyXFDtcN0BSeF0slZjP';
const CONFIG_FILE = join(__dirname, '..', 'vercel-firewall.json');

/** Top-level settings the file owns; anything else the API returns
 *  (`id`, `version`, `changes`, …) is server bookkeeping. */
const SETTINGS = [
  'firewallEnabled',
  'managedRules',
  'crs',
  'ips',
  'rules',
  'botIdEnabled',
  'logHeaders',
  'rulesets',
];
/** Server-assigned fields, wherever they appear. */
const BOOKKEEPING = new Set(['id', 'updatedAt', 'valid', 'validationErrors']);

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Config = Record<string, Json>;
type Rule = { name: string } & Record<string, Json>;

function usage(): never {
  console.error('usage: vercel-firewall diff\n       vercel-firewall apply [--yes]');
  process.exit(2);
}

function vercelApi(path: string, args: string[] = []): unknown {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${path}${sep}projectId=${PROJECT_ID}&teamId=${TEAM_ID}`;
  const out = execFileSync('vercel', ['api', url, '--raw', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return out.trim() ? JSON.parse(out) : null;
}

function fetchConfigs(): { active: Config; draft: { changes?: unknown[] } | null } {
  return vercelApi('/v1/security/firewall/config') as {
    active: Config;
    draft: { changes?: unknown[] } | null;
  };
}

/** Drops nulls, empty objects and server bookkeeping and sorts object keys,
 *  so the API's shape (`redirect: null`, `ruleGroups: {}`, ids) compares
 *  equal to the file's. Array order is kept: rule order is priority. */
function canonical(value: Json): Json {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, Json> = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === null || BOOKKEEPING.has(key)) continue;
    const v = canonical(value[key]);
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) {
      continue;
    }
    out[key] = v;
  }
  return out;
}

function settings(config: Config): Config {
  const out: Config = {};
  for (const key of SETTINGS) if (key in config) out[key] = config[key];
  return canonical(out) as Config;
}

const MAX_DESCRIPTION = 256;

function readConfigFile(): Config {
  const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as Config;
  const names = ((config.rules ?? []) as Rule[]).map((r) => r.name);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  if (dupes.length > 0) {
    throw new Error(`rule names must be unique in vercel-firewall.json: ${dupes.join(', ')}`);
  }
  // Vercel refuses the whole replace over one long description, so say which.
  const long = ((config.rules ?? []) as Rule[]).filter((r) => String(r.description ?? '').length > MAX_DESCRIPTION);
  if (long.length > 0) {
    throw new Error(
      `rule descriptions must be at most ${MAX_DESCRIPTION} characters in vercel-firewall.json: ${long.map((r) => r.name).join(', ')}`,
    );
  }
  return config;
}

/** Prints a unified diff of live vs file; returns whether they differ. */
function printDiff(live: Config, file: Config): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'vercel-firewall-'));
  try {
    const a = join(dir, 'live.json');
    const b = join(dir, 'file.json');
    writeFileSync(a, JSON.stringify(settings(live), null, 2) + '\n');
    writeFileSync(b, JSON.stringify(settings(file), null, 2) + '\n');
    const result = spawnSync(
      'diff',
      ['-u', '--label', 'live', '--label', 'vercel-firewall.json', a, b],
      { stdio: 'inherit' },
    );
    if (result.status !== 0 && result.status !== 1) throw new Error('diff failed');
    return result.status === 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

async function apply(yes: boolean): Promise<number> {
  const file = readConfigFile();
  const { active, draft } = fetchConfigs();
  if (draft?.changes && draft.changes.length > 0) {
    console.error(
      `The firewall has ${draft.changes.length} unpublished draft change(s); applying would ` +
        'discard them. Review with `vercel firewall diff`, then publish or discard.',
    );
    return 1;
  }
  if (!printDiff(active, file)) {
    console.log('Live firewall already matches vercel-firewall.json.');
    return 0;
  }
  if (!yes) {
    if (!process.stdin.isTTY) {
      console.error('Not a terminal: pass --yes to apply.');
      return 1;
    }
    if (!(await confirm('\nReplace the production firewall configuration with this? [y/N] '))) {
      console.log('Canceled');
      return 0;
    }
  }

  const dir = mkdtempSync(join(tmpdir(), 'vercel-firewall-'));
  try {
    const input = join(dir, 'body.json');
    writeFileSync(input, JSON.stringify(file));
    vercelApi('/v1/security/firewall/config', ['-X', 'PUT', '--input', input]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const after = fetchConfigs().active;
  if (printDiff(after, file)) {
    console.error('\nApplied, but the live configuration still differs from the file (above).');
    return 1;
  }
  console.log(`Applied: live firewall now matches vercel-firewall.json (version ${String(after.version)}).`);
  return 0;
}

export async function runCli(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (command === 'diff' && rest.length === 0) {
      const differs = printDiff(fetchConfigs().active, readConfigFile());
      console.log(
        differs
          ? '\nLive firewall differs from vercel-firewall.json; `pnpm firewall:apply` makes it match.'
          : 'Live firewall matches vercel-firewall.json.',
      );
      return 0;
    }
    if (command === 'apply' && rest.every((a) => a === '--yes')) {
      return await apply(rest.includes('--yes'));
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  usage();
}

const isMain = require.main === module;
if (isMain) {
  void (async () => {
    process.exit(await runCli(process.argv.slice(2)));
  })();
}
