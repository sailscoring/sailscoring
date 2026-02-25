# Notes: Playwright E2E Testing for Next.js + Dexie Apps

Practical notes from bilge-client's single e2e test, which found and confirmed
the fix for a real navigation bug before it reached production. Preserved here
for reuse when Sail Scoring adds its own e2e tests.

---

## Why bother

Unit tests couldn't have caught the bug that prompted this work. The failure mode
was: click a link, the URL changes, but the page content stays on the home page.
That involves the Next.js App Router, RSC partial navigation, Vercel rewrites, and
IndexedDB — all working together. Only a browser-level test exercises that stack.

The test found the bug in five seconds. Manually retesting the same scenario after
each fix attempt — navigating to the deployed preview, creating a bundle, clicking
it — cost minutes every round and still left uncertainty about whether the fix
would hold. Having the test meant we knew the moment something regressed.

---

## Setup

```sh
pnpm add -D @playwright/test
pnpm exec playwright install chromium   # just chromium is enough for most apps
```

`playwright.config.ts` in the `client/` directory:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
```

`package.json` scripts:

```json
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui"
```

---

## Seeding IndexedDB (Dexie) from a test

Playwright's `page.evaluate()` runs code inside the browser. Use it to write
directly to IndexedDB before the app code runs, bypassing Dexie entirely:

```ts
async function seedBundle(page: Page, bundle: Bundle) {
  await page.evaluate((b) => {
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('bilge-client');  // must match Dexie db name
      req.onsuccess = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        const tx = db.transaction('bundles', 'readwrite');
        tx.objectStore('bundles').put(b);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, bundle);
}
```

**Seed before the app opens the database.** If you seed after `page.goto('/')`,
Dexie has already opened the DB and `useLiveQuery` may not see the new row until
a page reload. The reliable sequence is:

```ts
await page.goto('/');
await expect(page.getByText('No bundles yet.')).toBeVisible(); // wait for Dexie ready
await seedBundle(page, testBundle);
await page.reload();
await expect(page.getByRole('link', { name: testBundle.name })).toBeVisible();
```

The empty-state message (`'No bundles yet.'`) is a useful synchronisation point:
it confirms the initial live query has completed and Dexie has opened.

---

## Writing assertions

Prefer role-based locators over CSS selectors or text. They mirror what users
actually see and survive layout changes:

```ts
// Good — targets semantic meaning
page.getByRole('heading', { name: 'HYC Autumn League 2026' })
page.getByRole('link', { name: testBundle.name })
page.getByRole('button', { name: 'Delete' })

// Fragile — couples to markup
page.locator('h1.text-2xl')
page.locator('[data-testid="bundle-name"]')
```

For navigation, assert both the URL and meaningful page content. The URL alone
is not enough — this bug kept the URL changing while the content stayed wrong:

```ts
await expect(page).toHaveURL(`/bundles/${testBundle.id}`);
await expect(page.getByRole('heading', { name: testBundle.name })).toBeVisible();
await expect(page.getByRole('heading', { name: 'Publishing bundles' })).not.toBeVisible();
```

The negative assertion on the old page's heading is the sharpest signal that
navigation actually completed — it's what would catch the exact bug we fixed.

---

## Debugging a failing test

**The error context file is your first stop.** When a test fails, Playwright
writes a page snapshot to:

```
test-results/<test-name>/error-context.md
```

It's a YAML accessibility tree of everything on screen at the moment of failure.
It immediately shows whether you're seeing the right page, loading state, error
message, or something else entirely — without needing to run `--headed`.

**If the test was passing and suddenly isn't:**

```sh
pkill -f "next dev"
rm -rf client/.next
pnpm run test:e2e
```

`reuseExistingServer: true` means Playwright reuses whatever dev server is on
port 3000. If that server compiled an older version of the route structure, it
can produce test failures that look like code bugs but aren't.

---

## What e2e tests are for (and aren't for)

Write an e2e test when:
- The feature involves navigation or routing (the most common source of bugs in
  Next.js static-export apps).
- The feature crosses multiple layers: e.g., "create a record, navigate away,
  navigate back, confirm it persists."
- You've just fixed a real bug and want to prevent regression.

Stick to unit tests (Vitest/Jest) when:
- You're testing pure functions, data transformations, or validation logic.
- The component has no meaningful interaction with routing or storage.

Don't write e2e tests for happy-path CRUD in isolation; write them for the
journeys that would break silently.
