import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick, setScoringMode } from './helpers';

/**
 * A finish time typed before the boat's gun — 12:15:30 for a 12:17:00 start,
 * as Dark Side's was in RCYC's Autumn League — is a data error, not a win.
 * The sheet flags the row as soon as the time is in, and the standings score
 * the boat DNF and name her and the race until the time is put right.
 */
test('a finish before the start is flagged, not scored', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Autumn League' });

  await createFleets(page, ['Spin 1']);
  await setScoringMode(page, 'handicap');
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'PY' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const c of [
    { sail: '3639', name: 'Colbert', py: '1026' },
    { sail: '1888', name: 'Mary', py: '1034' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sail);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sail })).toBeVisible();

    const row = page.getByRole('row').filter({ hasText: c.sail });
    await row.click();
    await page.getByLabel('PY number', { exact: true }).fill(c.py);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sail })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByLabel('Gun time').fill('12:17:00');
  await page.getByRole('checkbox', { name: 'Spin 1' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('12:17:00')).toBeVisible();

  const timePrompt = page.getByRole('textbox', { name: 'Finish time', exact: true });
  for (const { sail, time } of [
    { sail: '1888', time: '12:15:30' },
    { sail: '3639', time: '12:58:30' },
  ]) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await timePrompt.fill(time);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByTestId(`finish-time-${sail}`)).toHaveValue(time);
  }

  await expect(page.getByTestId('before-start-1888')).toBeVisible();
  await expect(page.getByTestId('before-start-3639')).toHaveCount(0);

  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);

  const warning = page.getByTestId('scoring-rejections-warning');
  await expect(warning).toContainText('at or before the start');
  await expect(warning).toContainText('1888 (Mary) in race 1');

  const rows = page.getByRole('row');
  await expect(rows.filter({ hasText: 'Colbert' })).toContainText('1');
  await expect(rows.filter({ hasText: 'Mary' })).toContainText('DNF');
});
