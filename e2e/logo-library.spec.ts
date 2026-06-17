import { signedInTest as test, expect } from './fixtures';
import {
  addCompetitor,
  addMemberByEmail,
  createOrgWorkspace,
  createSeriesQuick,
  downloadFleetHtml,
  enableFeatures,
  seedLogo,
} from './helpers';

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

test('workspace logo shows in the switcher and seeds a new series venue', async ({ page }) => {
  // Give the workspace its own logo (a built-in one), with no explicit default.
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Choose workspace logo' }).click();
  await page.getByRole('dialog').getByLabel('Search logos').fill('Howth');
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/workspace') &&
        r.request().method() === 'PATCH' &&
        r.ok(),
    ),
    page.getByRole('dialog').getByRole('button', { name: 'Use Howth Yacht Club' }).click(),
  ]);

  // It appears in the workspace switcher.
  await expect(page.getByTestId('workspace-switcher').locator('img')).toBeVisible();

  // And a new series' venue slot defaults to it (the default-default), with no
  // explicit default venue logo set.
  await createSeriesQuick(page, { name: 'Club League 2026' });
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.locator('h2', { hasText: 'Basic' }).locator('..').getByRole('button', { name: /Edit/ }).click();
  await expect(page.getByRole('textbox', { name: 'Venue logo' })).toHaveValue(
    /\/canonical-logos\/hyc\.png$/,
  );
  await expect(page.getByRole('textbox', { name: 'Event logo' })).toHaveValue('');
});

test('a built-in canonical logo can be the workspace default, copied into a new series', async ({ page }) => {
  // Set a canonical (built-in) logo as the default venue logo — no need to have
  // uploaded it to the workspace first.
  await page.goto('/workspace');
  await page
    .getByRole('button', { name: 'Choose Default venue logo' })
    .click();
  await page.getByRole('dialog').getByLabel('Search logos').fill('Howth');
  // Wait for the default to persist before moving on.
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/logos/defaults') &&
        r.request().method() === 'PUT' &&
        r.ok(),
    ),
    page.getByRole('dialog').getByRole('button', { name: 'Use Howth Yacht Club' }).click(),
  ]);

  // A newly-created series inherits the canonical default into its venue slot.
  await createSeriesQuick(page, { name: 'Spring League 2026' });
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.locator('h2', { hasText: 'Basic' }).locator('..').getByRole('button', { name: /Edit/ }).click();
  await expect(page.getByRole('textbox', { name: 'Venue logo' })).toHaveValue(
    /\/canonical-logos\/hyc\.png$/,
  );
  await expect(page.getByRole('textbox', { name: 'Event logo' })).toHaveValue('');
});

test('pick a built-in canonical logo for a series', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Autumn League 2026', venue: 'Howth' });
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.locator('h2', { hasText: 'Basic' }).locator('..').getByRole('button', { name: /Edit/ }).click();

  await page.getByRole('button', { name: 'Choose Event logo from library' }).click();
  await page.getByRole('dialog').getByLabel('Search logos').fill('AIB');
  await page.getByRole('dialog').getByRole('button', { name: 'Use AIB' }).click();

  const eventLogo = page.getByRole('textbox', { name: 'Event logo' });
  await expect(eventLogo).toHaveValue(/\/canonical-logos\/aib\.png$/);
  const url = await eventLogo.inputValue();

  await page.getByRole('button', { name: 'Save', exact: true }).click();

  // The synced canonical asset is served from the app's public path.
  const res = await page.request.get(url);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('image');
});

test('picking a canonical logo defaults the website slot and links it on the exported page', async ({ page }) => {
  // A series with one finisher so the standings/preview have content to render.
  await createSeriesQuick(page, { name: 'IODAI Nationals 2026', venue: 'Howth' });
  await addCompetitor(page, { sailNumber: '42', name: 'Alice' });
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await page.getByLabel('Sail number').fill('42');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // Pick the IODAI canonical logo for the event slot.
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.locator('h2', { hasText: 'Basic' }).locator('..').getByRole('button', { name: /Edit/ }).click();
  await page.getByRole('button', { name: 'Choose Event logo from library' }).click();
  await page.getByRole('dialog').getByLabel('Search logos').fill('IODAI');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Use Irish Optimist Dinghy Association (IODAI)' })
    .click();

  // The logo slot holds the canonical reference, and the companion website slot
  // defaults to the logo's official homepage — no manual entry.
  await expect(page.getByRole('textbox', { name: 'Event logo' })).toHaveValue(
    /\/canonical-logos\/iodai\.png$/,
  );
  await expect(page.getByRole('textbox', { name: 'Event website URL' })).toHaveValue(
    'https://iodai.com',
  );

  await page.getByRole('button', { name: 'Save', exact: true }).click();

  // The exported results page makes the event logo + name clickable to iodai.com.
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);
  const download = await downloadFleetHtml(page);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const html = Buffer.concat(chunks).toString('utf-8');
  expect(html).toContain('href="https://iodai.com"');
});

test('picking a canonical logo does not overwrite a website URL already typed', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Custom URL Series', venue: 'Howth' });
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.locator('h2', { hasText: 'Basic' }).locator('..').getByRole('button', { name: /Edit/ }).click();

  // A hand-typed venue website URL must survive a later logo pick.
  await page
    .getByRole('textbox', { name: 'Venue website URL' })
    .fill('https://example.com/my-club');

  await page.getByRole('button', { name: 'Choose Venue logo from library' }).click();
  await page.getByRole('dialog').getByLabel('Search logos').fill('Howth Yacht');
  await page.getByRole('dialog').getByRole('button', { name: 'Use Howth Yacht Club' }).click();

  await expect(page.getByRole('textbox', { name: 'Venue logo' })).toHaveValue(
    /\/canonical-logos\/hyc\.png$/,
  );
  // The companion URL is left untouched — defaulting only fills an empty slot.
  await expect(page.getByRole('textbox', { name: 'Venue website URL' })).toHaveValue(
    'https://example.com/my-club',
  );
});

test('copy a logo from another workspace into this one', async ({ page, signedInEmail }) => {
  // A second workspace the user belongs to, with a logo seeded directly.
  const orgName = `Source Club ${Date.now()}`;
  const org = await createOrgWorkspace(orgName);
  await addMemberByEmail(org.id, signedInEmail, 'owner');
  await seedLogo(org.id, 'Shared Burgee');

  // Active workspace stays personal; copy the logo across into it.
  await page.goto('/workspace');
  await expect(page.getByText('No logos yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Copy from workspace…' }).click();

  await page.getByTestId('copy-source-workspace').click();
  await page.getByRole('option').filter({ hasText: /Source Club/i }).click();

  await page.getByRole('button', { name: 'Copy Shared Burgee' }).click();
  await expect(page.getByRole('button', { name: 'Copy Shared Burgee' })).toHaveText('Copied');

  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // The copy now lives in this workspace's library.
  await expect(page.locator('main').getByText('Shared Burgee', { exact: true })).toBeVisible();
});
