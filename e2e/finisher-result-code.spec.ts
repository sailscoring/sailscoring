import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * A boat in the finishing order can carry a result code (#485). The live
 * case: a boat coded RET off the jury sheet, reinstated, and entered at her
 * crossing position — the sheet showed her as an ordinary finisher while the
 * standings scored the RET. The sheet must show the code on the row, let the
 * scorer clear it there, and let a finisher be coded OCS, RET, DSQ… without
 * losing her finish.
 */

test('a placed row shows its result code, and the code can be cleared or set from the row', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Coded Finisher Series' });

  for (const c of [
    { sailNumber: '101', name: 'Alice' },
    { sailNumber: '202', name: 'Bob' },
    { sailNumber: '303', name: 'Carol' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sailNumber })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByTestId('non-finisher-303')).toBeVisible();

  // ── 1. The jury sheet comes first: Bob is RET. Then the finish sheet
  //       places Alice and Carol, and — reinstated — Bob at 3rd. ──────────
  await page.getByLabel('Sail number').fill('101');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByTestId('non-finisher-202').getByRole('combobox').click();
  await page.getByRole('option', { name: 'RET', exact: true }).click();
  for (const sail of ['303', '202']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }

  // He is in the order, and the sheet says he still scores the RET.
  await expect(page.getByTestId('non-finisher-202')).toHaveCount(0);
  await expect(page.getByTestId('finisher-code-202')).toHaveText('RET');
  await expect(page.getByTestId('finisher-code-note')).toContainText('202 RET');
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // The standings agree with the chip.
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);
  await page.getByRole('link', { name: 'Standings' }).click();
  const bobRow = page.getByRole('row').filter({ hasText: 'Bob' });
  await expect(bobRow).toContainText('RET');
  await expect(bobRow.getByRole('cell').nth(0)).toContainText('3');

  // ── 2. Clear the code from the chip: Bob is an ordinary 3rd. ─────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByTestId('finisher-code-202')).toHaveText('RET');
  await page.getByRole('button', { name: 'Result code for 202' }).click();
  await page.getByRole('menuitemradio', { name: 'Finished — no code' }).click();
  await expect(page.getByTestId('finisher-code-202')).toHaveCount(0);
  await expect(page.getByTestId('finisher-code-note')).toHaveCount(0);

  // ── 3. Code a finisher from her row: Carol was OCS. She keeps her place
  //       on the sheet and scores the code. ─────────────────────────────────
  await page.getByRole('button', { name: 'Row actions for 303' }).click();
  await page.getByRole('menuitem', { name: 'Result code' }).click();
  await page.getByRole('menuitemradio', { name: 'OCS' }).click();
  await expect(page.getByTestId('finisher-code-303')).toHaveText('OCS');
  await expect(page.getByTestId('finisher-code-note')).toContainText('303 OCS');
  // Still the second row of the sheet — the crossing order is untouched.
  await expect(page.locator('[data-entry-key]').nth(1)).toContainText('303');
  await expect(page.getByTestId('non-finisher-303')).toHaveCount(0);
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);
  await page.getByRole('link', { name: 'Standings' }).click();
  const rows = page.getByRole('row');
  await expect(rows.filter({ hasText: 'Alice' }).getByRole('cell').nth(0)).toContainText('1');
  // Bob moves up to 2nd; Carol scores the OCS (entries + 1 = 4).
  await expect(rows.filter({ hasText: 'Bob' }).getByRole('cell').nth(0)).toContainText('2');
  await expect(rows.filter({ hasText: 'Bob' })).not.toContainText('RET');
  const carolRow = rows.filter({ hasText: 'Carol' });
  await expect(carolRow).toContainText('OCS');
  await expect(carolRow.getByRole('cell').nth(0)).toContainText('3');
});
