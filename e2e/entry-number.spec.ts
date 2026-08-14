import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * E2E for the entry number — the organising authority's own number for an
 * entry, recorded alongside the sail number. Once the series enables the field
 * it has to be visible in the competitor list, and findable from the filter:
 * a scorer working off the OA's entry list has that number and nothing else.
 */

test('entry numbers show in the competitor list and can be filtered on', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Entry Number Series' });

  // ── 1. Enable the field ──────────────────────────────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page
    .getByRole('heading', { name: 'Competitor fields' })
    .locator('..')
    .getByRole('button', { name: 'Edit ▸' })
    .click();
  await page.getByRole('checkbox', { name: 'Entry number' }).check();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 2. Two entries carrying OA numbers ───────────────────────────────────
  await page.getByRole('link', { name: 'Competitors' }).click();
  // Anchor on a control the Competitors page owns before touching its
  // contents — the previous tab is still mounted for a moment after the click.
  await expect(page.getByRole('button', { name: 'Add competitor' })).toBeVisible();
  for (const c of [
    { sailNumber: 'IRL 215', name: 'Mark McLoughlin', entryNumber: '108' },
    { sailNumber: 'GBR 41', name: 'Hannah Mills', entryNumber: '7' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByLabel('Entry number').fill(c.entryNumber);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sailNumber })).toBeVisible();
  }

  // ── 3. The number lands in its own column ────────────────────────────────
  await expect(page.getByRole('columnheader', { name: 'Entry no.' })).toBeVisible();
  const row = (sail: string) => page.getByRole('row').filter({ hasText: sail });
  await expect(row('IRL 215').getByRole('cell', { name: '108', exact: true })).toBeVisible();
  await expect(row('GBR 41').getByRole('cell', { name: '7', exact: true })).toBeVisible();

  // ── 4. And the filter finds the boat from it ─────────────────────────────
  await page.getByRole('textbox', { name: /filter/i }).fill('108');
  await expect(page.getByRole('cell', { name: 'IRL 215' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'GBR 41' })).toHaveCount(0);
});
