import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, enableFeatures } from './helpers';

/**
 * E2E for the flag locker — the per-workspace logo library (shared logo
 * library, tier 1). Covers adding, renaming, and deleting a logo in workspace
 * settings, and that the uploaded asset renders back as a thumbnail.
 *
 * The library is a gated experimental feature, so each test enables it for the
 * signed-in user's personal workspace first.
 */

// 1×1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

function pngFile(name: string) {
  return { name, mimeType: 'image/png', buffer: PNG };
}

test.beforeEach(async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['logo-library']);
});

test('Logo library: add, rename, delete', async ({ page }) => {
  await page.goto('/workspace');
  await expect(
    page.getByRole('heading', { name: /Workspace settings/ }),
  ).toBeVisible();
  await expect(page.getByText('No logos yet.')).toBeVisible();

  // ── Add ──────────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Add logo' }).click();
  await page.getByLabel('Image').setInputFiles(pngFile('aib-sponsor.png'));
  // Name auto-fills from the filename.
  await expect(page.getByLabel('Name')).toHaveValue('aib-sponsor');
  await page.getByLabel('Name').fill('AIB');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText('No logos yet.')).not.toBeVisible();
  await expect(page.getByText('AIB', { exact: true })).toBeVisible();
  // The thumbnail resolves through the raw route.
  await expect(page.getByRole('img', { name: 'AIB' })).toBeVisible();

  // ── Rename ─────────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Edit AIB' }).click();
  await page.getByLabel('Name').fill('AIB Bank');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('AIB Bank', { exact: true })).toBeVisible();

  // ── Delete ───────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Delete AIB Bank' }).click();
  await expect(page.getByText('No logos yet.')).toBeVisible();
});

test('pick a library logo as a series venue burgee', async ({ page }) => {
  // Seed a logo in the library.
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Add logo' }).click();
  await page.getByLabel('Image').setInputFiles(pngFile('hyc.png'));
  await page.getByLabel('Name').fill('HYC');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('HYC', { exact: true })).toBeVisible();

  // Open a series' Basic settings and pick the logo for the venue slot.
  await createSeriesQuick(page, { name: 'Frostbite 2026', venue: 'Howth' });
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.locator('h2', { hasText: 'Basic' }).locator('..').getByRole('button', { name: /Edit/ }).click();

  await page.getByRole('button', { name: 'Choose Venue logo from library' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /HYC/ }).click();

  // The slot now holds the indirection URL, and the preview resolves it.
  const venueLogo = page.getByRole('textbox', { name: 'Venue logo' });
  await expect(venueLogo).toHaveValue(/\/logos\/[0-9a-f-]{36}$/);
  const url = await venueLogo.inputValue();

  await page.getByRole('button', { name: 'Save', exact: true }).click();

  // The public indirection route serves the bytes, unauthenticated.
  const res = await page.request.get(url);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('image/png');
});
