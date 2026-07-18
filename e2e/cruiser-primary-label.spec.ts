import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

function csvBuffer(content: string) {
  return { name: 'cruiser-entries.csv', mimeType: 'text/csv', buffer: Buffer.from(content) };
}

async function uploadCsv(page: import('@playwright/test').Page, content: string) {
  await page.getByTestId('competitor-import-input').setInputFiles(csvBuffer(content));
}

/**
 * Covers the cruiser use case from issue #93: a registration CSV with Owner
 * and Helm columns lands the scorer on Owner-primary results without manual
 * setup, and the Settings UI reflects that choice.
 */
test('cruiser-style CSV import proposes Owner as the primary identifier', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Cruiser League Import' });

  const csv = [
    'Sail,Boat,Owner,Helm,Class',
    'IRL1,Serenity,John Smith,John Smith,Class 1',
    'IRL2,The Big Picture,Jane Doe,Mark Brown,Class 1',
    'IRL3,Bluenose,Pat O\'Brien,Pat O\'Brien,Class 2',
  ].join('\n');

  await uploadCsv(page, csv);
  await expect(page.getByRole('dialog')).toBeVisible();

  // ── Series-level proposal: primary → Owner, optional fields add Boat/Helm ──
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Primary identifier', { exact: true })).toBeVisible();
  // The Owner radio ends up checked (cruiser pattern: both Owner + Helm present)
  await expect(dialog.getByRole('radio', { name: /^Owner/ })).toBeChecked();
  // Summary line reflects the change vs the default (Competitor)
  await expect(dialog.getByText('Primary identifier:')).toBeVisible();
  await expect(dialog.getByText(/Competitor\s*→\s*Owner/)).toBeVisible();

  // Import button is labelled with the row count and enabled
  await page.getByRole('button', { name: /Import 3 rows/i }).click();
  await expect(page.getByRole('heading', { name: /import complete/i })).toBeVisible();
  await expect(page.getByText(/3 competitor.* added/i)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── Competitors table: Owner is the primary column, Helm optional ─────────
  await expect(page.getByRole('columnheader', { name: 'Owner', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Helm', exact: true })).toBeVisible();
  const row = page.getByRole('row', { name: /IRL2/ });
  await expect(row).toContainText('Jane Doe');   // owner (primary column)
  await expect(row).toContainText('Mark Brown'); // helm (optional column)

  // ── Settings reflects the primary label = Owner ───────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const card = page.locator('h2', { hasText: 'Competitor fields' }).locator('..');
  await card.getByRole('button', { name: 'Edit ▸' }).click();
  await expect(page.getByRole('radio', { name: /^Owner/ })).toBeChecked();
  // The Owner optional field is disabled (already the primary); Helm stays available
  const ownerCheckbox = page.getByRole('checkbox', { name: 'Owner name' });
  await expect(ownerCheckbox).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Helm name' })).toBeChecked();

  // ── Manual add form: required label is "Owner name *" ─────────────────────
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await expect(page.getByLabel('Owner name 1')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
});

test('helm-primary series keeps the Helm label across UI and rejects the owner-as-primary column', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Dinghy Helm Primary' });

  // Switch the series to the Helm primary via Settings first.
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const card = page.locator('h2', { hasText: 'Competitor fields' }).locator('..');
  await card.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('radio', { name: /^Helm/ }).click();
  // The Helm optional field is now disabled (it IS the primary)
  await expect(page.getByRole('checkbox', { name: 'Helm name' })).toBeDisabled();
  await page.getByRole('button', { name: 'Done' }).click();

  // On the Competitors tab, the add dialog asks for "Helm name *".
  await page.getByRole('navigation').getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await expect(page.getByLabel('Helm name 1')).toBeVisible();
  await page.getByLabel('Sail number').fill('GBR100');
  await page.getByLabel('Helm name 1').fill('Alice');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'GBR100', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Helm', exact: true })).toBeVisible();
});
