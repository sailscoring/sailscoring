import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, enableFeatures } from './helpers';

/**
 * Prizes happy path (#240), modelled on a one-design event whose NoR awards
 * 1st/2nd/3rd overall in each of the Gold and Silver Divisions: set up a
 * Division subdivision axis, add prizes with an axis condition on the Prizes
 * tab, watch recipients allocate live from the standings, and publish the
 * prize sheet as its own page beside the standings page.
 *
 * Series: "GP14 Ulsters 2026", 6 boats, 1 race finishing in sail order.
 *   Gold:   1 (rank 1), 3 (rank 3), 5 (rank 5)  → Gold podium  1, 3, 5
 *   Silver: 2 (rank 2), 4 (rank 4), 6 (rank 6)  → Silver podium 2, 4, 6
 */

const competitors = [
  { sailNumber: '1', name: 'Aoife Byrne', division: 'Gold' },
  { sailNumber: '2', name: 'Brian Doyle', division: 'Silver' },
  { sailNumber: '3', name: 'Clodagh Nolan', division: 'Gold' },
  { sailNumber: '4', name: 'Dara Hughes', division: 'Silver' },
  { sailNumber: '5', name: 'Emer Lynch', division: 'Gold' },
  { sailNumber: '6', name: 'Finn Casey', division: 'Silver' },
];

test('prizes: division podiums allocate live and publish as a prize sheet', async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['prizes']);

  // ── 1. Series with a Division axis ────────────────────────────────────────
  await createSeriesQuick(page, { name: 'GP14 Ulsters 2026', venue: 'Sligo YC' });
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Competitor fields' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('checkbox', { name: 'Division' }).check();
  await expect(page.getByLabel('Axis 1 label')).toHaveValue('Division');
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 2. Competitors with Division values ──────────────────────────────────
  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const c of competitors) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByLabel('Division', { exact: true }).fill(c.division);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('row', { name: new RegExp(c.name) })).toBeVisible();
  }

  // ── 3. One race, finishing in sail order ─────────────────────────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  for (const c of competitors) {
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // ── 4. Prizes tab: two division podiums, recipients allocate live ────────
  await page.getByRole('navigation').getByRole('link', { name: 'Prizes' }).click();
  await expect(page).toHaveURL(/\/prizes$/);

  const addPrize = async (name: string, divisionValue: string, viaOther = false) => {
    await page.getByRole('button', { name: /Add (prize|the first prize)/ }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add prize' });
    await dialog.getByLabel('Name').fill(name);
    // Places awarded defaults to 3 — exactly the NoR's podium.
    await expect(dialog.getByLabel('Places awarded')).toHaveValue('3');
    await dialog.getByRole('button', { name: 'Add condition' }).click();
    // The condition field defaults to the first subdivision axis (Division).
    await expect(dialog.getByLabel('Condition field')).toContainText('Division');
    if (viaOther) {
      // The free-entry escape, for a value no competitor carries yet (#275).
      await dialog.getByLabel('Axis value').click();
      await page.getByRole('option', { name: 'Other…' }).click();
      await dialog.getByLabel('Axis value').fill(divisionValue);
    } else {
      // Recorded values are a dropdown (#275).
      await dialog.getByLabel('Axis value').click();
      await page.getByRole('option', { name: divisionValue }).click();
    }
    await dialog.getByRole('button', { name: 'Add prize' }).click();
    await expect(dialog).toBeHidden();
  };

  await addPrize('Gold Fleet 1st, 2nd, 3rd', 'Gold');
  await expect(page.getByRole('heading', { name: 'Gold Fleet 1st, 2nd, 3rd' })).toBeVisible();
  await expect(page.getByText('Division is Gold · top 3')).toBeVisible();
  const goldRows = page.getByRole('row');
  await expect(goldRows.filter({ hasText: 'Aoife Byrne' })).toContainText('1st');
  await expect(goldRows.filter({ hasText: 'Clodagh Nolan' })).toContainText('2nd');
  await expect(goldRows.filter({ hasText: 'Emer Lynch' })).toContainText('3rd');
  // Silver boats aren't in the Gold prize.
  await expect(goldRows.filter({ hasText: 'Brian Doyle' })).toHaveCount(0);

  await addPrize('Silver Fleet 1st, 2nd, 3rd', 'Silver', true);
  await expect(page.getByRole('heading', { name: 'Silver Fleet 1st, 2nd, 3rd' })).toBeVisible();
  const silverRows = page.getByRole('row').filter({ hasText: 'Brian Doyle' });
  await expect(silverRows).toContainText('1st');

  // ── 5. Publish: the prize sheet is one more page ─────────────────────────
  await page.getByRole('link', { name: 'Standings' }).click();
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await expect(dialog).toBeVisible();
  // Single-fleet series: the lone results page plus the optional Prizes row,
  // ticked by default on first publish with its editable `prizes` sub-path.
  await expect(dialog.getByRole('checkbox', { name: 'Publish Prizes' })).toBeChecked();
  await expect(dialog.getByLabel('URL for Prizes')).toHaveValue('prizes');
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();

  const link = dialog.getByRole('link', { name: /standings$/ });
  await expect(link).toBeVisible();
  const standingsPath = new URL((await link.getAttribute('href')) ?? '').pathname;
  const indexPath = standingsPath.replace(/\/standings$/, '');

  // The series index lists the standings page and the prize sheet.
  await page.goto(indexPath);
  await expect(page.getByRole('link', { name: 'Standings' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Prizes' })).toBeVisible();

  // The published prize sheet: every prize, its eligibility line, recipients.
  await page.goto(`${indexPath}/prizes`);
  await expect(page.getByRole('heading', { name: 'Prizes' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Gold Fleet 1st, 2nd, 3rd' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Silver Fleet 1st, 2nd, 3rd' })).toBeVisible();
  await expect(page.getByText('Division is Gold')).toBeVisible();
  await expect(page.getByText('Aoife Byrne')).toBeVisible();
  await expect(page.getByText('Finn Casey')).toBeVisible();
});
