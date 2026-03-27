import { test as base } from '@playwright/test';

/**
 * Extends the base Playwright test with a beforeEach that fails the test on
 * any browser console error or uncaught page error. This catches things like
 * React's hooks-order violations, which would otherwise only appear in the
 * browser console and not cause the test to fail.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    const errors: string[] = [];

    page.on('pageerror', (err) => {
      errors.push(`[pageerror] ${err.message}`);
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(`[console.error] ${msg.text()}`);
      }
    });

    await use(page);

    if (errors.length > 0) {
      throw new Error(`Browser errors detected:\n${errors.join('\n')}`);
    }
  },
});

export { expect } from '@playwright/test';
