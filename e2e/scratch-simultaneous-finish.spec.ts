import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick, setScoringMode, settleFinish } from './helpers';

/**
 * #607 — two boats recorded at the same finish time are tied on scratch.
 *
 * A scratch fleet's finish order is the order of the rows, and the tie used to
 * be read off a per-row flag alone — never off the times. The flag is set from
 * a checkbox the sheet suppresses on a timed row, so on a timed sheet a tie
 * could be neither derived nor marked. The handicap path has always grouped a
 * tie on equal corrected time, so the same race came out tied in a fleet's
 * handicap result and split in its scratch one.
 *
 * The rows are timed for the reason the report describes: a boat also in a
 * handicap fleet with a start time gets a timed row on the scratch sheet too.
 */
test('two boats recorded at the same time share the place (RRS A7)', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Dead Heat 2026', venue: 'HYC' });

  // One class, two fleets over it: PY for the handicap result, order alone for
  // the other. One sheet serves both.
  await createFleets(page, ['Squib HPH', 'Squib Scratch']);
  await setScoringMode(page, 'handicap');
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByTestId('fleet-row').filter({ hasText: 'Squib HPH' })
    .getByRole('combobox').click();
  await page.getByRole('option', { name: 'PY' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  const boats = [
    { sail: 'IRL11', name: 'Alpha', at: '14:58:12' },
    { sail: 'IRL22', name: 'Bravo', at: '15:00:41' },
    // Charlie and Anna crossed together: one time written against both.
    { sail: 'IRL33', name: 'Charlie', at: '15:01:06' },
    { sail: 'IRL44', name: 'Anna', at: '15:01:06' },
    { sail: 'IRL55', name: 'Echo', at: '15:04:20' },
  ];

  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const b of boats) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number *').fill(b.sail);
    await page.getByLabel('Competitor name').fill(b.name);
    await page.getByRole('checkbox', { name: 'Squib HPH' }).check();
    await page.getByRole('checkbox', { name: 'Squib Scratch' }).check();
    await page.getByLabel('PY number', { exact: true }).fill('1050');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: b.sail })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  const startDialog = page.getByRole('dialog');
  await startDialog.getByPlaceholder('14:05', { exact: true }).fill('14:00:00');
  await startDialog.getByRole('checkbox', { name: 'Squib HPH' }).check();
  await startDialog.getByRole('checkbox', { name: 'Squib Scratch' }).check();
  await startDialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('14:00:00')).toBeVisible();

  const timePrompt = page.getByRole('textbox', { name: 'Finish time', exact: true });
  for (const b of boats) {
    await page.getByLabel('Sail number').fill(b.sail);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(timePrompt).toBeVisible();
    await timePrompt.fill(b.at);
    await settleFinish(page, () => page.getByRole('button', { name: 'Add', exact: true }).click());
  }

  // The sheet says so: the second of the two rows carries the tie marker,
  // which the suppressed checkbox could never have shown.
  await expect(page.getByTestId('tie-IRL44')).toBeVisible();
  await expect(page.getByTestId('tie-IRL33')).toHaveCount(0);
  await expect(page.getByTestId('tie-IRL55')).toHaveCount(0);

  // Standings: 3.5 each for the tied pair, and the boat behind them is 5th.
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);
  const scratch = page.getByRole('table').filter({ hasText: 'IRL33' }).last();
  for (const sail of ['IRL33', 'IRL44']) {
    await expect(scratch.getByRole('row').filter({ hasText: sail })).toContainText('3.5');
  }
  await expect(scratch.getByRole('row').filter({ hasText: 'IRL55' })).toContainText('5');

  // The handicap fleet, on the same times, agrees — which is the disagreement
  // that made this visible in the first place.
  const hph = page.getByRole('table').filter({ hasText: 'IRL33' }).first();
  for (const sail of ['IRL33', 'IRL44']) {
    await expect(hph.getByRole('row').filter({ hasText: sail })).toContainText('3.5');
  }
});
