import { test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * E2E tests for configurable competitor fields (#64) and crew name (#69).
 *
 * Exercises the Settings → Competitor fields card, confirms the Competitors
 * form + table respect the toggles, and checks that crew names render in the
 * exported HTML as "Helm / Crew".
 */

test('crew name toggle shows Crew column and exports "Helm / Crew"', async ({ page }) => {
  // ── 1. Create series ──────────────────────────────────────────────────────
  await createSeriesQuick(page, { name: 'Fireball Frostbite' });

  // ── 2. Switch to Helm-primary and turn off the default Boat column so the
  //     rest of the test exercises the enable path explicitly. ──────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Competitor fields' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('radio', { name: /^Helm/ }).click();
  await page.getByRole('checkbox', { name: 'Boat name' }).uncheck();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('link', { name: 'Competitors' }).click();

  // ── 3. By default (after step 2): Crew column is hidden, Crew field is not in the form ──
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await expect(page.getByLabel('Crew name')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel' }).click();

  // ── 4. Enable crew name in Settings → Competitor fields ──────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Competitor fields' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('checkbox', { name: 'Crew name' }).check();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 5. Add a competitor with helm + crew ────────────────────────────────
  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('14702');
  await page.getByLabel('Helm name').fill('Jane Doe');
  await page.getByLabel('Crew name').fill('Mark Smith');
  await page.getByRole('button', { name: 'Save' }).click();

  // ── 6. Competitors table now has a Crew column ───────────────────────────
  await expect(page.getByRole('columnheader', { name: 'Crew' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Mark Smith' })).toBeVisible();

  // ── 7. Toggling Boat name adds the column ───────────────────────────────
  await expect(page.getByRole('columnheader', { name: 'Boat', exact: true })).toHaveCount(0);
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Competitor fields' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('checkbox', { name: 'Boat name' }).check();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('link', { name: 'Competitors' }).click();
  await expect(page.getByRole('columnheader', { name: 'Boat', exact: true })).toBeVisible();

  // ── 8. Add a race so export is possible ─────────────────────────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await page.getByLabel('Sail number').fill('14702');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // ── 9. Export HTML and verify combined "Helm / Crew" rendering ──────────
  await page.getByRole('link', { name: 'Standings' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export HTML' }).click(),
  ]);
  const path = await download.path();
  const fs = await import('node:fs');
  const html = fs.readFileSync(path, 'utf-8');

  // Header uses the combined label — Helm primary + crew enabled
  expect(html).toContain('<th>Helm / Crew</th>');
  // Row body uses slash form
  expect(html).toContain('Jane Doe / Mark Smith');
  // Boat column is now visible after the enable in step 7
  expect(html).toContain('<th>Boat</th>');
});

test('class field shows Class column and exports in results', async ({ page }) => {
  await createSeriesQuick(page, { name: 'PY Handicap' });

  // Enable Class in Settings → Competitor fields
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Competitor fields' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByLabel('Class', { exact: true }).check();
  await page.getByRole('button', { name: 'Done' }).click();

  // Add a competitor with a class
  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('207112');
  await page.getByLabel('Competitor name').fill('Jane Doe');
  await page.getByLabel('Class', { exact: true }).fill('Laser');
  await page.getByRole('button', { name: 'Save' }).click();

  // Competitors table now has a Class column
  await expect(page.getByRole('columnheader', { name: 'Class', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Laser' })).toBeVisible();

  // Add a race and export HTML
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await page.getByLabel('Sail number').fill('207112');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  await page.getByRole('link', { name: 'Standings' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export HTML' }).click(),
  ]);
  const path = await download.path();
  const fs = await import('node:fs');
  const html = fs.readFileSync(path, 'utf-8');

  expect(html).toContain('<th>Class</th>');
  expect(html).toContain('>Laser<');
});

test('disabling a field preserves its data on re-enable', async ({ page }) => {
  // ── 1. Create series and enable Boat name ────────────────────────────────
  await createSeriesQuick(page, { name: 'Persist Test' });
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Competitor fields' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByLabel('Boat name').check();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('link', { name: 'Competitors' }).click();

  // ── 2. Add a competitor with a boat name ─────────────────────────────────
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('1');
  await page.getByLabel('Competitor name').fill('Alice');
  await page.getByLabel('Boat name').fill('Windchaser');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'Windchaser' })).toBeVisible();

  // ── 3. Disable boat name — the column disappears ─────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Competitor fields' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByLabel('Boat name').uncheck();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('link', { name: 'Competitors' }).click();
  await expect(page.getByRole('cell', { name: 'Windchaser' })).toHaveCount(0);

  // ── 4. Re-enable boat name — the data is still there (hide, don't strip) ─
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Competitor fields' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByLabel('Boat name').check();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('link', { name: 'Competitors' }).click();
  await expect(page.getByRole('cell', { name: 'Windchaser' })).toBeVisible();
});
