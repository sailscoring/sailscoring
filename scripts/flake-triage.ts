/**
 * Flake triage: turn the flaky-e2e population into a tracked queue.
 *
 * Reads the Playwright JSON report (test-results/report.json) and, for every
 * test that flaked — failed then passed on a retry, Playwright status "flaky" —
 * files or updates a GitHub issue labelled `flake`. An idle agent can then work
 * `label:flake` when other development is quiet.
 *
 * Detection uses the JSON per-test status, NOT the presence of a trace file: a
 * trace.zip is written on any retried attempt, so it appears for hard failures
 * too. Hard failures are summarised here but never filed — they're real breaks
 * you fix now, and they already fail the run (non-zero exit) so a push is
 * blocked.
 *
 * Dedup: matched by exact issue title `Flake: <spec> › <full test title>`
 * (stable across line shifts). Open issue → a dated "seen again" comment,
 * capped to one per day. Closed issue → reopened + a "recurred" comment.
 * Otherwise → created. Idempotent, so re-running against the same report is safe.
 *
 * Usage:
 *   pnpm flake:triage              # file/update issues from the last run
 *   pnpm flake:triage --dry-run    # print what it would do, touch nothing
 *
 * Needs the `gh` CLI authenticated. Reads no database.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const REPORT_PATH = resolve(process.cwd(), 'test-results/report.json');
const LABEL = 'flake';
const DRY_RUN = process.argv.includes('--dry-run');
const TODAY = new Date().toISOString().slice(0, 10);

// ── Playwright JSON report (the slice we read) ────────────────────────────────
interface PwError {
  message?: string;
}
interface PwResult {
  status: string; // 'passed' | 'failed' | 'timedOut' | 'interrupted' | 'skipped'
  retry: number;
  error?: PwError;
  errors?: PwError[];
}
interface PwTest {
  status: string; // 'expected' | 'unexpected' | 'flaky' | 'skipped'
  results: PwResult[];
}
interface PwSpec {
  title: string;
  file: string;
  line: number;
  tests: PwTest[];
}
interface PwSuite {
  title?: string;
  file?: string;
  specs?: PwSpec[];
  suites?: PwSuite[];
}
interface PwReport {
  config?: { rootDir?: string };
  suites?: PwSuite[];
}

interface FlakyTest {
  file: string; // repo-relative spec path
  line: number;
  specTitle: string; // the leaf test title, for the -g repro
  fullTitle: string; // describe › … › test, for the issue title
  errorExcerpt: string;
}

const ANSI = /\x1b\[[0-9;]*m/g;
const strip = (s: string): string => s.replace(ANSI, '');

/** Walk the suite tree, collecting flaky and hard-failed leaf tests. */
function collect(report: PwReport): { flaky: FlakyTest[]; hardFailed: string[] } {
  const flaky: FlakyTest[] = [];
  const hardFailed: string[] = [];

  // `spec.file` is relative to the report's rootDir (the e2e/ dir), so resolve
  // against it, then relativise to cwd — yields `e2e/foo.spec.ts`, the path a
  // `pnpm test:e2e <path>` repro actually needs.
  const rootDir = report.config?.rootDir ?? process.cwd();
  const relFile = (file: string): string => relative(process.cwd(), resolve(rootDir, file));

  const walk = (suite: PwSuite, file: string, describePath: string[]): void => {
    for (const spec of suite.specs ?? []) {
      const fullTitle = [...describePath, spec.title].join(' › ');
      for (const test of spec.tests ?? []) {
        if (test.status === 'flaky') {
          const failed = test.results.find((r) => r.status !== 'passed');
          const raw = failed?.error?.message ?? failed?.errors?.[0]?.message ?? '(no error captured)';
          flaky.push({
            file: relFile(spec.file || file),
            line: spec.line,
            specTitle: spec.title,
            fullTitle,
            errorExcerpt: strip(raw).trim().slice(0, 800),
          });
        } else if (test.status === 'unexpected') {
          hardFailed.push(`${relFile(spec.file || file)} › ${fullTitle}`);
        }
      }
    }
    // A file-level suite carries `.file`; nested suites are `describe` blocks.
    for (const child of suite.suites ?? []) {
      const childFile = child.file ?? file;
      const isFileSuite = !!child.file && child.file !== file;
      walk(child, childFile, isFileSuite ? [] : [...describePath, child.title ?? '']);
    }
  };

  for (const top of report.suites ?? []) walk(top, top.file ?? '', []);
  return { flaky, hardFailed };
}

// ── gh helpers ────────────────────────────────────────────────────────────────
function gh(args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

interface IssueRow {
  number: number;
  title: string;
  state: string; // 'OPEN' | 'CLOSED'
}

function ensureLabel(): void {
  // Only needed before creating an issue; a dry-run writes nothing, so skip the
  // gh round-trip entirely (keeps `--dry-run` usable offline).
  if (DRY_RUN) return;
  const names: { name: string }[] = JSON.parse(gh(['label', 'list', '--limit', '200', '--json', 'name']));
  if (names.some((l) => l.name === LABEL)) return;
  gh(['label', 'create', LABEL, '--color', 'D4C5F9', '--description', 'A flaky (load-sensitive) e2e test, auto-filed by flake-triage']);
}

function listFlakeIssues(): Map<string, IssueRow> {
  const rows: IssueRow[] = JSON.parse(
    gh(['issue', 'list', '--label', LABEL, '--state', 'all', '--limit', '300', '--json', 'number,title,state']),
  );
  return new Map(rows.map((r) => [r.title, r]));
}

/** Already left a recurrence note today? Keeps the cap at ~one comment/day. */
function commentedToday(issueNumber: number): boolean {
  const { comments } = JSON.parse(gh(['issue', 'view', String(issueNumber), '--json', 'comments'])) as {
    comments: { body: string; createdAt: string }[];
  };
  return comments.some((c) => c.createdAt.slice(0, 10) === TODAY && c.body.includes('Seen again'));
}

function issueBody(f: FlakyTest): string {
  return [
    `Auto-filed by \`pnpm test:e2e:triage\` — this test **failed then passed on retry** (Playwright status: \`flaky\`), so the run was green but the test is load-sensitive.`,
    ``,
    `**Test:** \`${f.file}:${f.line}\` › ${f.fullTitle}`,
    ``,
    `**Error on the failed attempt:**`,
    '```',
    f.errorExcerpt,
    '```',
    ``,
    `**Reproduce** (retries are off here so you get the honest failure, and a trace is retained):`,
    '```',
    `pnpm test:e2e ${f.file} -g ${JSON.stringify(f.specTitle)} --repeat-each=20 --workers=4 --retries=0 --trace retain-on-failure`,
    '```',
    ``,
    `Under load the whole suite runs at 4 workers; a single spec rarely reproduces alone, so also try running the spec's neighbours together, or oversubscribe workers.`,
    ``,
    `First seen ${TODAY}.`,
  ].join('\n');
}

/**
 * A recurrence comment carries the failed attempt's error excerpt: the issue
 * body holds only the FIRST sighting's error, and a recurrence that failed at
 * a different assertion is the key diagnostic signal — without it, a sighting
 * whose report has since been overwritten leaves nothing to work from.
 */
function recurrenceNote(heading: string, f: FlakyTest): string {
  return [heading, '', '```', f.errorExcerpt, '```'].join('\n');
}

function main(): number {
  if (!existsSync(REPORT_PATH)) {
    console.error(
      `No Playwright report at ${REPORT_PATH}.\n` +
        `Run \`pnpm test:e2e:triage\` (which runs the suite then this), or \`pnpm test:e2e\` first.`,
    );
    return 1;
  }

  const report: PwReport = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
  const { flaky, hardFailed } = collect(report);

  if (hardFailed.length > 0) {
    console.log(`\n${hardFailed.length} hard failure(s) — NOT filed (fix these; they block the push):`);
    for (const t of hardFailed) console.log(`  ✗ ${t}`);
  }

  if (flaky.length === 0) {
    console.log(hardFailed.length ? '\nNo flaky tests to triage.' : '\nNo flaky tests — clean run.');
    return 0;
  }

  console.log(`\n${flaky.length} flaky test(s) to triage${DRY_RUN ? ' (dry-run)' : ''}:`);
  ensureLabel();
  const existing = DRY_RUN && !hasGh() ? new Map<string, IssueRow>() : listFlakeIssues();

  let created = 0;
  let commented = 0;
  let reopened = 0;
  let skipped = 0;

  for (const f of flaky) {
    const title = `Flake: ${f.file} › ${f.fullTitle}`;
    const found = existing.get(title);

    if (!found) {
      if (DRY_RUN) console.log(`  + would CREATE  ${title}`);
      else {
        const url = gh(['issue', 'create', '--label', LABEL, '--title', title, '--body', issueBody(f)]).trim();
        console.log(`  + created  ${url}`);
      }
      created++;
      continue;
    }

    if (found.state === 'CLOSED') {
      if (DRY_RUN) console.log(`  ↻ would REOPEN  #${found.number}  ${title}`);
      else {
        gh(['issue', 'reopen', String(found.number)]);
        gh(['issue', 'comment', String(found.number), '--body', recurrenceNote(`Recurred after being closed — seen again on ${TODAY}.`, f)]);
        console.log(`  ↻ reopened #${found.number}`);
      }
      reopened++;
      continue;
    }

    // Open issue → cap recurrence notes at one per day.
    if (!DRY_RUN && commentedToday(found.number)) {
      console.log(`  · skip #${found.number} (already noted today)`);
      skipped++;
      continue;
    }
    if (DRY_RUN) console.log(`  ~ would COMMENT #${found.number}  ${title}`);
    else {
      gh(['issue', 'comment', String(found.number), '--body', recurrenceNote(`Seen again on ${TODAY} via \`pnpm test:e2e:triage\`.`, f)]);
      console.log(`  ~ commented #${found.number}`);
    }
    commented++;
  }

  console.log(
    `\nDone: ${created} created, ${reopened} reopened, ${commented} commented, ${skipped} skipped${DRY_RUN ? ' (dry-run — nothing written)' : ''}.`,
  );
  return 0;
}

function hasGh(): boolean {
  try {
    gh(['--version']);
    return true;
  } catch {
    return false;
  }
}

const isMain = require.main === module;
if (isMain) {
  try {
    process.exit(main());
  } catch (err) {
    console.error('flake-triage failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
