import { signedInTest as test, expect } from './fixtures';
import { addCompetitor, createSeriesQuick } from './helpers';

test('filter, multi-select and bulk delete competitors', async ({ page }) => {
  // ── 1. Create a series with four competitors ──────────────────────────────
  await createSeriesQuick(page, { name: 'Bulk Delete Series' });

  await addCompetitor(page, { sailNumber: 'IRL101', name: 'Blue Heron' });
  await addCompetitor(page, { sailNumber: 'IRL102', name: 'Blue Jay' });
  await addCompetitor(page, { sailNumber: 'IRL201', name: 'Red Rover' });
  await addCompetitor(page, { sailNumber: 'IRL202', name: 'Red Setter' });
  await expect(page.getByText('4 competitors')).toBeVisible();

  // ── 2. Filter narrows the table ───────────────────────────────────────────
  const filter = page.getByLabel('Filter competitors');
  await filter.fill('blue');
  await expect(page.getByText('2 of 4 competitors')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'IRL101' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'IRL201' })).not.toBeVisible();

  // ── 3. Header checkbox selects everything currently shown ────────────────
  await page.getByRole('checkbox', { name: 'Select all shown competitors' }).check();
  await expect(page.getByText('2 selected')).toBeVisible();

  // ── 4. Selection survives a filter change; add one more row to it ────────
  await filter.fill('rover');
  await expect(page.getByText('1 of 4 competitors')).toBeVisible();
  await page.getByRole('row', { name: /IRL201/ }).getByRole('checkbox', { name: 'Select row' }).check();
  await expect(page.getByText('3 selected')).toBeVisible();

  // ── 5. Clearing the filter shows all rows; selection is unchanged ────────
  await filter.press('Escape');
  await expect(page.getByText('4 competitors')).toBeVisible();
  await expect(page.getByText('3 selected')).toBeVisible();

  // ── 6. Cancel leaves everything in place ─────────────────────────────────
  await page.getByRole('button', { name: 'Delete selected' }).click();
  await expect(page.getByRole('heading', { name: 'Delete 3 competitors?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('4 competitors')).toBeVisible();

  // ── 7. Confirm deletes the selection in one go ────────────────────────────
  await page.getByRole('button', { name: 'Delete selected' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('1 competitor', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'IRL202' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'IRL101' })).not.toBeVisible();
  await expect(page.getByRole('cell', { name: 'IRL102' })).not.toBeVisible();
  await expect(page.getByRole('cell', { name: 'IRL201' })).not.toBeVisible();

  // ── 8. Deselecting one row after select-all keeps the keeper ─────────────
  // (the exact-duplicate cleanup gesture: select all, untick the one to keep)
  await addCompetitor(page, { sailNumber: 'IRL301', name: 'Green Gull' });
  await page.getByRole('checkbox', { name: 'Select all shown competitors' }).check();
  await expect(page.getByText('2 selected')).toBeVisible();
  await page.getByRole('row', { name: /IRL202/ }).getByRole('checkbox', { name: 'Select row' }).uncheck();
  await expect(page.getByText('1 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Delete selected' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('cell', { name: 'IRL202' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'IRL301' })).not.toBeVisible();
});
