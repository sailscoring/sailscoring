import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright runs in two project modes (ADR-008 Phase 4), exposed as
 * mutually-exclusive invocations:
 *
 * - Default (`pnpm test:e2e`): the legacy local-first build. No
 *   `DATABASE_URL`, no auth. Specs tagged `@auth` or `@server` are
 *   filtered out. This is what `e2e-tests.yml` runs.
 *
 * - `pnpm test:e2e:server`: the full-stack build with
 *   `USE_SERVER_DATA=true` and `E2E_SERVER_MODE=1`. Each spec must
 *   sign in via the magic-link helpers in `e2e/helpers.ts`. Only
 *   specs tagged `@auth` or `@server` are run. This is what
 *   `db-tests.yml` runs. The `pretest:e2e:server` script hook also
 *   ensures the local Postgres container is up via `db-up.sh`.
 *
 * Mutual exclusion means both modes share the same port and `.next`
 * directory; only one webServer ever runs at a time.
 *
 * The webServer command is `pnpm start:test`, which is a small bash
 * wrapper (scripts/start-test.sh) that sources .env.test for
 * BETTER_AUTH_SECRET, BETTER_AUTH_URL, and NEXT_PUBLIC_APP_URL,
 * defaults DATABASE_URL to the local Postgres URL, then runs
 * `pnpm build && pnpm start`. See docs/local-dev-scripts.md.
 */

const SERVER_MODE = process.env.E2E_SERVER_MODE === '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    SERVER_MODE
      ? {
          name: 'chromium-server',
          use: { ...devices['Desktop Chrome'] },
          // Server mode runs only the auth-required and server-paired specs.
          grep: /@auth|@server/,
        }
      : {
          name: 'chromium-local',
          use: { ...devices['Desktop Chrome'] },
          // Local-first build can't run the auth or server-mode specs.
          grepInvert: /@auth|@server/,
        },
  ],
  webServer: {
    command: 'pnpm start:test',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: SERVER_MODE
      ? {
          USE_SERVER_DATA: 'true',
          // Disable Better Auth rate limiting — many parallel sign-ins
          // from one IP would otherwise trip the 3-req/10-s default.
          E2E_DISABLE_RATE_LIMIT: '1',
        }
      : {},
  },
});
