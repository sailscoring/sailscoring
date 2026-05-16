import { test as base } from '@playwright/test';

import { signInFreshUser } from './helpers';

/**
 * Console errors triggered by in-flight fetches being aborted when the
 * test page navigates or unmounts. They surface as either a generic
 * "Failed to load resource" line from the browser or a "TypeError:
 * Failed to fetch" thrown by `fetch()` inside a TanStack mutation.
 * Neither indicates an application bug — the server saw the request
 * mid-flight and the browser tore down before reading the response.
 *
 * Filtering these false positives only at the fixture layer means real
 * `console.error(...)` calls from app code still fail the test.
 */
const ABORTED_FETCH_PATTERNS = [
  /Failed to load resource:/i,
  /TypeError: Failed to fetch/i,
];

function isAbortedFetchNoise(text: string): boolean {
  return ABORTED_FETCH_PATTERNS.some((rx) => rx.test(text));
}

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
      if (isAbortedFetchNoise(err.message)) return;
      errors.push(`[pageerror] ${err.message}`);
    });

    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (isAbortedFetchNoise(text)) return;
      errors.push(`[console.error] ${text}`);
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
  // Fixed prefix on purpose: derived prefixes (e.g. testInfo.title) can
  // leak keywords like "publish" or "delete" into the email username,
  // and Playwright's getByRole name matcher is substring-by-default,
  // so the UserMenu button's accessible name (the user's email) would
  // accidentally match locators like getByRole('button', { name: 'Publish' }).
  signedInEmail: [async ({ page }, use) => {
    const email = await signInFreshUser(page, 'e2e');
    await use(email);
  }, { auto: true }],
});

export { expect } from '@playwright/test';
