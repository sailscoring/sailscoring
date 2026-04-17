import { test, expect } from './fixtures';
import { type Page } from '@playwright/test';
import { createSeriesQuick } from './helpers';

/**
 * E2E tests for bilge results publishing (issue #31).
 *
 * Covers:
 *   - Publish dialog opens with auto-populated prefix
 *   - First publish (setup flow): fills email + prefix, POST → 200 → URL shown
 *   - Pending flow: POST → 202 → "check your email" shown, Check status → published
 *   - Re-publish: pre-seeded bundle → manage view shown → Re-publish triggers POST
 *   - Keyboard shortcut p opens the dialog
 *
 * Does not test the real bilge network; all calls are intercepted.
 */

const BILGE_URL = 'https://bilge.sailscoring.ie';

/** Navigate to a new series, add one competitor and race, return seriesId. */
async function createSeriesWithData(page: Page): Promise<string> {
  await createSeriesQuick(page, { name: 'HYC Autumn League 2026' });

  const match = page.url().match(/\/series\/([^/]+)/);
  if (!match) throw new Error(`Not on a series page: ${page.url()}`);
  const seriesId = match[1];

  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('42');
  await page.getByLabel('Helm name').fill('Alice');
  await page.getByRole('button', { name: 'Save' }).click();

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await page.getByLabel('Sail number').fill('42');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByRole('button', { name: 'Save results' }).click();

  await page.getByRole('link', { name: 'Standings' }).click();

  return seriesId;
}

test('Publish dialog: setup flow — prefix auto-populated, first publish → URL shown', async ({ page }) => {
  // Intercept bilge API calls
  await page.route(`${BILGE_URL}/l/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ exists: false }) }),
  );
  await page.route(`${BILGE_URL}/upload`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url: `${BILGE_URL}/r/hyc-autumn-league-2026/standings` }),
    }),
  );

  await createSeriesWithData(page);

  // Open dialog via button
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await expect(dialog).toBeVisible();

  // Prefix should be auto-populated from series name
  const prefixInput = dialog.getByLabel('URL prefix');
  await expect(prefixInput).toHaveValue('hyc-autumn-league-2026');

  // Email is required
  const emailInput = dialog.getByLabel('Your email');
  await expect(emailInput).toBeVisible();

  // Wait for prefix availability check
  await expect(dialog.getByText('✓ Available')).toBeVisible();

  // Fill email and publish
  await emailInput.fill('scorer@example.com');
  await dialog.getByRole('button', { name: 'Publish' }).click();

  // After successful publish, dialog shows published URL and status
  await expect(dialog.getByText('Published', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('link', { name: `${BILGE_URL}/r/hyc-autumn-league-2026/standings` })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Copy' })).toBeVisible();
});

test('Publish dialog: pending flow — POST → 202 → check status → published', async ({ page }) => {
  // First publish returns 202 (pending)
  await page.route(`${BILGE_URL}/l/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ exists: false }) }),
  );
  await page.route(`${BILGE_URL}/upload`, (route) =>
    route.fulfill({ status: 202, body: '' }),
  );

  await createSeriesWithData(page);
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });

  await expect(dialog.getByText('✓ Available')).toBeVisible();
  await dialog.getByLabel('Your email').fill('scorer@example.com');
  await dialog.getByRole('button', { name: 'Publish' }).click();

  // Dialog now shows pending state
  await expect(dialog.getByText('Pending verification')).toBeVisible();
  await expect(dialog.getByText(/Check your email/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Check status' })).toBeVisible();

  // Now intercept HEAD to return 200 (verified)
  const expectedUrl = `${BILGE_URL}/r/hyc-autumn-league-2026/standings`;
  await page.route(`${BILGE_URL}/r/**`, (route) =>
    route.fulfill({ status: 200, body: '' }),
  );
  await dialog.getByRole('button', { name: 'Check status' }).click();

  // After check, status updates to Published with URL
  await expect(dialog.getByText('Published', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('link', { name: expectedUrl })).toBeVisible();
});

test('Publish dialog: re-publish — pre-seeded bundle shows manage view, Re-publish triggers POST', async ({ page }) => {
  const existingUrl = `${BILGE_URL}/r/my-series/standings`;

  // Intercept upload for re-publish
  await page.route(`${BILGE_URL}/upload`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url: existingUrl }),
    }),
  );

  const seriesId = await createSeriesWithData(page);

  // Seed a bilgeBundle into IndexedDB
  await page.evaluate(async ([id, url]) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('sailscoring-v1');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('series', 'readwrite');
        const store = tx.objectStore('series');
        const get = store.get(id);
        get.onsuccess = () => {
          const s = get.result;
          s.bilgeBundle = {
            uuid: 'test-uuid-1234',
            prefix: 'my-series',
            slug: 'my-series/standings',
            status: 'published',
            publishedUrl: url,
            lastPublishedAt: Date.now(),
          };
          const put = store.put(s);
          put.onsuccess = () => resolve();
          put.onerror = () => reject(put.error);
        };
        get.onerror = () => reject(get.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, [seriesId, existingUrl]);

  // Navigate away and back so the seeded data is picked up
  await page.goto('/');
  await page.getByText('HYC Autumn League 2026').click();
  await page.getByRole('link', { name: 'Standings' }).click();
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });

  // Manage view: shows existing URL, no prefix/email form
  await expect(dialog.getByText(existingUrl)).toBeVisible();
  await expect(dialog.getByText('Published', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('URL prefix')).not.toBeVisible();
  await expect(dialog.getByLabel('Your email')).not.toBeVisible();

  // Re-publish button triggers a new upload — wait for the POST to complete
  const uploadResponse = page.waitForResponse(`${BILGE_URL}/upload`);
  await dialog.getByRole('button', { name: 'Re-publish' }).click();
  await uploadResponse;
});

test('Publish dialog: keyboard shortcut p opens the dialog', async ({ page }) => {
  await page.route(`${BILGE_URL}/**`, (route) => route.fulfill({ status: 200, body: '{}' }));
  await createSeriesWithData(page);

  // Wait for standings to be fully rendered, then press shortcut
  await expect(page.getByRole('table')).toBeVisible();
  await page.keyboard.press('p');
  await expect(page.getByRole('dialog', { name: 'Publish results' })).toBeVisible();
});
