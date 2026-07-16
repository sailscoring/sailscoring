import { defineConfig, devices } from '@playwright/test';

/**
 * Server-mode Playwright suite. Every spec runs against the full
 * Postgres + Better Auth backend.
 *
 * `webServer.command` is `pnpm start:test`, a small bash wrapper
 * (scripts/start-test.sh) that sources .env.test for BETTER_AUTH_SECRET,
 * BETTER_AUTH_URL, NEXT_PUBLIC_APP_URL, defaults DATABASE_URL to the
 * local Postgres URL, then runs `pnpm build && pnpm start`. See
 * docs/local-dev-scripts.md.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Retries everywhere, including locally: a test that fails then passes is
  // reported "flaky" and the run still exits 0 (good enough to push). The
  // flaky ones are triaged into `flake`-labelled issues by `pnpm
  // test:e2e:triage` (scripts/flake-triage.ts) so they're tracked, not hidden.
  // When actively debugging a test and you want the fast honest failure,
  // override per-run with `--retries=0`.
  retries: 2,
  // `list` for humans; `json` so the triage step can read per-test flaky status
  // (test-results/ is gitignored). A raw trace file appears on any retried
  // attempt — flaky *and* hard-failed — so the JSON status is the real signal.
  reporter: [['list'], ['json', { outputFile: 'test-results/report.json' }]],
  // The whole suite runs 4 workers against one `next start` + Postgres on one
  // machine, so a single save→refetch→render round-trip can exceed the 5s
  // default under load. 15s only slows assertions that were going to fail;
  // passing runs are unaffected.
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://localhost:3000',
    // Now fires locally too (retries > 0): every flaky test leaves a trace on
    // its retry, and the repro command in each filed issue captures a fresh one.
    trace: 'on-first-retry',
    // Unbounded actions (the Playwright default) turn a swallowed click or a
    // dialog that never opened into an anonymous "test timeout exceeded" with
    // no locator in the report. Bounding them keeps the failure attached to
    // the action that actually hung.
    actionTimeout: 20_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm start:test',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Disable Better Auth rate limiting — many parallel sign-ins
      // from one IP would otherwise trip the 3-req/10-s default.
      E2E_DISABLE_RATE_LIMIT: '1',
      // Don't seed new workspaces with the sample series — the suite
      // asserts an empty baseline on a fresh sign-in.
      E2E_DISABLE_SAMPLE_SEED: '1',
      // Turn the feedback feature on for e2e. The `.test` TLD makes
      // `lib/feedback/email.ts` route to `tests/.feedback.log`
      // instead of Resend, even if RESEND_API_KEY is set.
      FEEDBACK_TO: 'feedback@sailscoring.test',
    },
  },
});
