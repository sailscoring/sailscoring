import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright runs in two project modes (ADR-008 Phase 4), exposed as
 * mutually-exclusive invocations:
 *
 * - Default (`pnpm test:e2e`): the legacy local-first build. No
 *   `DATABASE_URL`, no auth. Specs tagged `@auth` or `@server` are
 *   filtered out. This is what `e2e-tests.yml` runs.
 *
 * - `E2E_SERVER_MODE=1 DATABASE_URL=… pnpm test:e2e`: the full-stack
 *   build with `USE_SERVER_DATA=true`. Each spec must sign in via the
 *   magic-link helpers in `e2e/helpers.ts`. Only specs tagged `@auth`
 *   or `@server` are run. This is what `db-tests.yml` runs.
 *
 * Mutual exclusion means both modes share the same port and `.next`
 * directory; only one webServer ever runs at a time. Each invocation
 * sets its own runtime env (notably `USE_SERVER_DATA`, which Next.js
 * reads at build time inside the static evaluation of `lib/flags.ts`).
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
    command: 'pnpm build && pnpm start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: SERVER_MODE ? { USE_SERVER_DATA: 'true' } : {},
  },
});
