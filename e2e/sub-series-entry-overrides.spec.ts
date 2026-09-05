import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, enableFeatures } from './helpers';

/**
 * Per-sub-series entry overrides (#502). Spring ranks only boats that took
 * part, so two boats are off its table and listed under "Not shown". Including
 * one keeps it on the table with DNC and counts it; excluding another from the
 * sub-series through the sail-number menu drops it from Spring alone — Winter
 * still scores it. The sub-series editor lists both overrides and can remove
 * one.
 *
 *   R1 (Winter): 1001, 1002, 1003, 1004     R2 (Winter): 1001, 1002, 1003
 *   R3 (Spring): 1003, 1001 — Spring has "rank only boats that took part".
 */

const competitors = [
  { sailNumber: '1001', name: 'Alice Murphy' },
  { sailNumber: '1002', name: 'Bob Kelly' },
  { sailNumber: '1003', name: 'Carol Ryan' },
  { sailNumber: '1004', name: 'Dave Walsh' },
];

test('include and exclude a boat in one sub-series from the standings', async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['sub-series']);

  await createSeriesQuick(page, { name: 'Overrides 2026', venue: 'HYC' });
  for (const c of competitors) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sailNumber })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  for (let n = 1; n <= 3; n++) {
    await page.getByRole('button', { name: 'Add race' }).click();
    await expect(page.getByText(`Race ${n}`)).toBeVisible();
  }

  const newSubSeries = async (name: string, raceNumbers: number[], excludeDnc = false) => {
    await page.getByRole('button', { name: 'New sub-series' }).click();
    const dialog = page.getByRole('dialog', { name: 'New sub-series' });
    await dialog.getByLabel('Name', { exact: true }).fill(name);
    for (const n of raceNumbers) {
      await dialog.getByRole('checkbox', { name: new RegExp(`Race ${n}\\b`) }).check();
    }
    if (excludeDnc) await dialog.getByRole('checkbox', { name: /Rank only boats that took part/ }).check();
    await dialog.getByRole('button', { name: 'Create sub-series' }).click();
    await expect(dialog).toBeHidden();
  };
  await newSubSeries('Winter', [1, 2]);
  await newSubSeries('Spring', [3], true);

  const enterRace = async (raceLabel: string, sails: string[]) => {
    await page.getByText(raceLabel, { exact: false }).first().click();
    await expect(page.getByLabel('Sail number')).toBeVisible();
    for (const sail of sails) {
      await page.getByLabel('Sail number').fill(sail);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
    }
    await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
    await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
    await expect(page).toHaveURL(/\/races$/);
  };
  await enterRace('Race 1', ['1001', '1002', '1003', '1004']);
  await enterRace('Race 2', ['1001', '1002', '1003']);
  await enterRace('Race 3', ['1003', '1001']);

  // ── Spring: two entrants; Bob and Dave sit under "Not shown" ─────────────
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByRole('tab', { name: 'Spring' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('1 race · Low Point · No discards · 2 entrants')).toBeVisible();
  const notShown = page.getByTestId('not-shown');
  await expect(notShown.locator('summary')).toContainText('Not shown (2)');
  await notShown.locator('summary').click();
  await expect(page.getByTestId('not-shown-1002')).toContainText('No results');
  await expect(page.getByTestId('not-shown-1004')).toContainText('No results');

  // ── Include Dave: he entered, so he counts — DNC = 3 + 1 ─────────────────
  await page.getByTestId('not-shown-1004').getByRole('button', { name: 'Include' }).click();
  await expect(page.getByText('1 race · Low Point · No discards · 3 entrants')).toBeVisible();
  const rows = page.getByRole('row');
  const dave = rows.filter({ hasText: 'Dave Walsh' });
  await expect(dave).toContainText('DNC');
  await expect(dave.getByRole('cell').last()).toContainText('4');
  await expect(notShown.locator('summary')).toContainText('Not shown (1)');

  // ── Exclude Alice from Spring alone through her sail-number menu ─────────
  await page.getByRole('table').getByRole('button', { name: '1001', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Exclude from this sub-series' }).click();
  await expect(rows.filter({ hasText: 'Alice Murphy' })).toHaveCount(0);
  await expect(page.getByText('1 race · Low Point · No discards · 2 entrants')).toBeVisible();
  await expect(notShown.locator('summary')).toContainText('Not shown (2)');
  await expect(page.getByTestId('not-shown-1001')).toContainText('Excluded from this sub-series');
  // Two entrants now: Dave's DNC falls to 3.
  await expect(dave.getByRole('cell').last()).toContainText('3');

  // Winter is untouched: Alice scores there, all four entered.
  await page.getByRole('tab', { name: 'Winter' }).click();
  await expect(page.getByText('2 races · Low Point · No discards · 4 entrants')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Alice Murphy' })).toBeVisible();

  // ── The editor lists both overrides; removing Alice's restores her ───────
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);
  await page.getByRole('button', { name: 'Edit sub-series Spring' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit sub-series' });
  await expect(editor.getByText('included in this sub-series')).toBeVisible();
  const excludedRow = editor.getByRole('listitem').filter({ hasText: 'excluded from this sub-series' });
  await expect(excludedRow).toContainText('1001');
  await excludedRow.getByRole('button', { name: 'Remove' }).click();
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeHidden();

  await page.getByRole('navigation').getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByRole('tab', { name: 'Spring' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('tab', { name: 'Spring' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Alice Murphy' })).toBeVisible();
  await expect(page.getByText('1 race · Low Point · No discards · 3 entrants')).toBeVisible();
});
