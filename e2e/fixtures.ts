import { test as base } from '@playwright/test';

import { signInFreshUser } from './helpers';

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

/**
 * Variant of `test` that signs a fresh user into the app before every
 * test body. Use it for any spec whose first concern is "the user is
 * already signed in" — i.e. almost every functional spec in this suite.
 *
 * Tests that exercise the sign-in flow itself (auth-magic-link) or that
 * need to drive sign-in by hand (server-mode-org-collab) should keep
 * using the plain `test` export.
 */
export const signedInTest = test.extend<{ signedInEmail: string }>({
  signedInEmail: [async ({ page }, use, testInfo) => {
    const slug = testInfo.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'spec';
    const email = await signInFreshUser(page, slug);
    await use(email);
  }, { auto: true }],
});

export { expect } from '@playwright/test';
