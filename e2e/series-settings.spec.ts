import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * E2E tests for the series settings page (issue #39).
 *
 * Covers: Basics card (venue, start/end date, logo URLs, website URLs), tab
 * rename to "Settings", and logo/website URLs wired through to HTML export
 * (clickable header logos + footer website links).
 */

test('settings basics card saves venue, dates, and logo URLs', async ({ page }) => {
  // ── 1. Create series ──────────────────────────────────────────────────────
  await createSeriesQuick(page, { name: 'Dún Laoghaire Regatta 2025' });

  // ── 2. Navigate to Settings tab (formerly "File") ─────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);

  // ── 3. Fill in the Basics card ────────────────────────────────────────────
  await page.getByRole('heading', { name: 'Basic' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByLabel('Venue', { exact: true }).fill('Dún Laoghaire Harbour');
  await page.getByLabel('Start date').fill('2025-07-11');
  await page.getByLabel('End date').fill('2025-07-13');
  await page.getByLabel('Venue logo URL').fill('https://example.com/venue-logo.png');
  await page.getByLabel('Event logo URL').fill('https://example.com/event-logo.png');
  await page.getByLabel('Venue website URL').fill('https://venue.example.com');
  await page.getByLabel('Event website URL').fill('https://event.example.com');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  // ── 4. Verify the series header subtitle reflects the new venue and date ──
  await expect(page.getByText('Dún Laoghaire Harbour').first()).toBeVisible();
  await expect(page.getByText(/2025-07-11/).first()).toBeVisible();

  // ── 5. Navigate away and back to confirm persistence ─────────────────────
  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Basic' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await expect(page.getByLabel('Venue', { exact: true })).toHaveValue('Dún Laoghaire Harbour');
  await expect(page.getByLabel('Start date')).toHaveValue('2025-07-11');
  await expect(page.getByLabel('End date')).toHaveValue('2025-07-13');
  await expect(page.getByLabel('Venue logo URL')).toHaveValue('https://example.com/venue-logo.png');
  await expect(page.getByLabel('Event logo URL')).toHaveValue('https://example.com/event-logo.png');
  await expect(page.getByLabel('Venue website URL')).toHaveValue('https://venue.example.com');
  await expect(page.getByLabel('Event website URL')).toHaveValue('https://event.example.com');
});

test('logo and website URLs produce clickable logos and footer links in exported HTML', async ({ page }) => {
  // ── 1. Create series ──────────────────────────────────────────────────────
  await createSeriesQuick(page, { name: 'Logo Test Series' });

  // ── 2. Set venue, logo URLs, and website URLs in Settings ────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Basic' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByLabel('Venue', { exact: true }).fill('Test Venue');
  await page.getByLabel('Venue logo URL').fill('https://example.com/venue.png');
  await page.getByLabel('Event logo URL').fill('https://example.com/event.png');
  await page.getByLabel('Venue website URL').fill('https://venue.example.com');
  await page.getByLabel('Event website URL').fill('https://event.example.com');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  // ── 3. Add a competitor and race so export is possible ───────────────────
  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('1');
  await page.getByLabel('Competitor name').fill('Test Helm');
  await page.getByLabel('Club').fill('TC');
  await page.getByRole('button', { name: 'Save' }).click();

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await page.getByLabel('Sail number').fill('1');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // ── 4. Export HTML and verify logo img tags ───────────────────────────────
  await page.getByRole('link', { name: 'Standings' }).click();
  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export HTML' }).click(),
  ]).then(([dl]) => dl);

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const html = Buffer.concat(chunks).toString('utf-8');

  expect(html).toContain('src="https://example.com/venue.png"');
  expect(html).toContain('src="https://example.com/event.png"');
  expect(html).toContain('alt="venue logo"');
  expect(html).toContain('alt="event logo"');

  // Header logos are wrapped in links to the website URLs.
  expect(html).toContain('<a href="https://venue.example.com" target="_top" rel="noopener"><img');
  expect(html).toContain('<a href="https://event.example.com" target="_top" rel="noopener"><img');

  // Footer carries the venue (by name) and event (by series name) website links.
  expect(html).toContain('<p class="hardleft"><a href="https://venue.example.com" target="_top" rel="noopener">Test Venue</a></p>');
  expect(html).toContain('<p class="hardright"><a href="https://event.example.com" target="_top" rel="noopener">Logo Test Series</a></p>');
});
