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
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
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
      // Turn the feedback feature on for e2e. The `.test` TLD makes
      // `lib/feedback/email.ts` route to `tests/.feedback.log`
      // instead of Resend, even if RESEND_API_KEY is set.
      FEEDBACK_TO: 'feedback@sailscoring.test',
    },
  },
});
