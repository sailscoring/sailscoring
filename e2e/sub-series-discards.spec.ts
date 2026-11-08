import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, enableFeatures } from './helpers';

/**
 * A sub-series with its own discard rule: ISORA's coastal series count their
 * best 3 inside a season counting its best 5. A five-race Coastal sub-series
 * set to count its best 3 discards two of each boat's races; switched to no
 * discards, every race counts.
 *
 *   Races 1–3: Alice 1st, Bob 2nd. Races 4–5: Bob 1st, Alice 2nd.
 *   Best 3: Alice 1+1+1 = 3, Bob 2+1+1 = 4.   Every race: Alice 7, Bob 8.
 */

test('a sub-series counts its own best 3, then every race', async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['sub-series', 'proportional-discards']);
  await createSeriesQuick(page, { name: 'Coastal Discards' });
  for (const c of [{ sailNumber: '1001', name: 'Alice Murphy' }, { sailNumber: '1002', name: 'Bob Kelly' }]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sailNumber })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  for (let n = 1; n <= 5; n++) {
    await page.getByRole('button', { name: 'Add race' }).click();
    await expect(page.getByText(`Race ${n}`)).toBeVisible();
  }
  for (let n = 1; n <= 5; n++) {
    await page.getByText(`Race ${n}`, { exact: true }).click();
    await expect(page.getByLabel('Sail number')).toBeVisible();
    for (const sail of n <= 3 ? ['1001', '1002'] : ['1002', '1001']) {
      await page.getByLabel('Sail number').fill(sail);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
    }
    await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
    await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
    await expect(page).toHaveURL(/\/races$/);
  }

  // ── Coastal: all five races, counting its best 3 ─────────────────────────
  await page.getByRole('button', { name: 'New sub-series' }).click();
  const dialog = page.getByRole('dialog', { name: 'New sub-series' });
  await dialog.getByLabel('Name', { exact: true }).fill('Coastal');
  for (let n = 1; n <= 5; n++) {
    await dialog.getByRole('checkbox', { name: new RegExp(`Race ${n}\\b`) }).check();
  }
  const discards = dialog.getByTestId('sub-series-discards');
  await expect(discards.getByRole('radio', { name: /^As the series/ })).toBeChecked();
  await discards.getByRole('radio', { name: 'Count the best races' }).check();
  await discards.getByLabel('Races that count').fill('3');
  await expect(discards.getByText('With 5 races: 2 discards, 3 count.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Create sub-series' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('5 races · Best 3 count')).toBeVisible();

  // ── Its standings discard two races a boat ───────────────────────────────
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);
  await expect(page.getByText('5 races · Low Point · Best 3 of 5 count')).toBeVisible();
  const rows = page.getByRole('row');
  await expect(rows.filter({ hasText: 'Alice Murphy' }).getByRole('cell').first()).toHaveText('1');
  await expect(rows.filter({ hasText: 'Alice Murphy' }).getByRole('cell').last()).toHaveText('3');
  await expect(rows.filter({ hasText: 'Bob Kelly' }).getByRole('cell').last()).toHaveText('4');

  // ── Switched to no discards, every race counts ───────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);
  await page.getByRole('button', { name: 'Edit sub-series Coastal' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit sub-series' });
  await expect(edit.getByLabel('Races that count')).toHaveValue('3');
  await edit.getByRole('radio', { name: /^No discards/ }).check();
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByText('5 races · No discards')).toBeVisible();

  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);
  await expect(page.getByText('5 races · Low Point · No discards')).toBeVisible();
  await expect(rows.filter({ hasText: 'Alice Murphy' }).getByRole('cell').last()).toHaveText('7');
  await expect(rows.filter({ hasText: 'Bob Kelly' }).getByRole('cell').last()).toHaveText('8');
});
