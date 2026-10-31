import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, enableFeatures } from './helpers';

/**
 * Custom scoring codes (#717): the escape hatch from the RRS codes. A series
 * adds a code of its own from the Scoring card's Scoring codes dialog — an
 * opening screen first, then the table, then the editor, whose sentence
 * restates the rule — and the card says what changed.
 */
test('a series adds a code of its own through the Scoring codes dialog', async ({ page, signedInEmail }) => {
  await createSeriesQuick(page, { name: 'Frostbites Codes' });
  await enableFeatures(page, signedInEmail, ['custom-scoring-codes']);

  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  const card = page.locator('div', { has: page.getByRole('heading', { name: 'Scoring', exact: true }) }).last();
  await card.getByRole('button', { name: 'Edit ▸' }).click();
  await expect(page.getByTestId('scoring-codes-line')).toContainText('Scoring codes: as RRS Appendix A');

  await page.getByRole('button', { name: 'Change scoring codes…' }).click();
  const dialog = page.getByTestId('scoring-codes-dialog');
  await expect(dialog.getByTestId('scoring-codes-intro')).toContainText('Change this only when your notice of race or sailing instructions do');
  await dialog.getByRole('button', { name: 'Change scoring codes' }).click();

  // The changeable codes, as the RRS scores them.
  await expect(dialog.getByTestId('code-row-DNF')).toContainText('series entries + 1');
  await expect(dialog.getByTestId('code-row-DNS')).toContainText('as DNF');
  await expect(dialog.getByTestId('code-row-SCP')).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Add a code' }).click();
  const editor = dialog.getByTestId('scoring-code-editor');
  await editor.getByLabel('Code').fill('TLE');
  await editor.getByLabel('Description').fill('Time limit expired (SI 16.1)');
  // A new code starts as the place after the finishers + 1, capped at DNF.
  await expect(editor.getByTestId('code-sentence')).toHaveText(
    'A boat scored TLE gets points for the finishing place one more than the number of boats that finished in her fleet, but never more than a DNF. It can be discarded.',
  );
  await editor.getByRole('button', { name: 'Save' }).click();

  await expect(dialog.getByTestId('code-row-TLE')).toContainText('finishers + 1, at most DNF');
  await expect(dialog.getByTestId('code-row-TLE')).toContainText('Series');

  // A changed built-in shows the rule it replaced.
  await dialog.getByTestId('code-row-BFD').click();
  await editor.getByLabel('Can be discarded').uncheck();
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByTestId('code-row-BFD')).toContainText('as DNF · not discardable (RRS: as DNF)');

  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('scoring-codes-line')).toContainText('1 added, 1 changed from the RRS (TLE added, BFD changed)');
});

/** Add a code of the series' own through the Scoring codes dialog, which is
 *  open on its table. */
async function addCode(
  page: import('@playwright/test').Page,
  code: { code: string; description: string; adds?: { points: string } },
) {
  const dialog = page.getByTestId('scoring-codes-dialog');
  await dialog.getByRole('button', { name: 'Add a code' }).click();
  const editor = dialog.getByTestId('scoring-code-editor');
  await editor.getByLabel('Code').fill(code.code);
  await editor.getByLabel('Description').fill(code.description);
  if (code.adds) {
    await editor.getByLabel('Adds points to her finishing place').check();
    await editor.getByLabel('Points to add').fill(code.adds.points);
  }
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByTestId(`code-row-${code.code}`)).toBeVisible();
}

test('the series’ own codes are offered on the finish sheet and score as the series says', async ({ page, signedInEmail }) => {
  await createSeriesQuick(page, { name: 'Frostbites Sheet' });
  await enableFeatures(page, signedInEmail, ['custom-scoring-codes']);

  for (const c of [
    { sailNumber: '101', name: 'Alice' },
    { sailNumber: '202', name: 'Bob' },
    { sailNumber: '303', name: 'Carol' },
    { sailNumber: '404', name: 'Dave' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sailNumber })).toBeVisible();
  }

  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  const card = page.locator('div', { has: page.getByRole('heading', { name: 'Scoring', exact: true }) }).last();
  await card.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Change scoring codes…' }).click();
  await page.getByTestId('scoring-codes-dialog').getByRole('button', { name: 'Change scoring codes' }).click();
  await addCode(page, { code: 'TLE', description: 'Time limit expired (SI 16.1)' });
  await addCode(page, { code: 'SOP', description: 'Failed to sign out (SI 19.1)', adds: { points: '2' } });
  await page.getByTestId('scoring-codes-dialog').getByRole('button', { name: 'Done' }).click();

  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByTestId('non-finisher-404')).toBeVisible();
  for (const sail of ['101', '202']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }

  // Carol finished outside the window: TLE, from the series' own codes.
  await page.getByTestId('non-finisher-303').getByRole('combobox').click();
  await expect(page.getByRole('group').getByText('This series')).toBeVisible();
  await page.getByRole('option', { name: 'TLE' }).click();

  // Alice didn't sign out: SOP, which carries its points.
  await page.getByRole('button', { name: 'Row actions for 101' }).click();
  await page.getByRole('menuitem', { name: 'Set scoring penalty' }).click();
  await page.getByRole('combobox').click();
  await page.getByRole('option', { name: /SOP/ }).click();
  await expect(page.getByTestId('penalty-code-rule')).toContainText('has 2 points added to her score');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // Two finished: TLE scores the place after them, 3. Alice's 1 + 2 is 3,
  // and Bob keeps his 2 (A6.2). Dave never came: 4 entries + 1.
  await page.getByRole('navigation').getByRole('link', { name: 'Standings' }).click();
  const row = (sail: string) => page.getByRole('row').filter({ has: page.getByRole('cell', { name: sail, exact: true }) });
  await expect(row('303')).toContainText('3 TLE');
  await expect(row('101')).toContainText('SOP');
  await expect(row('101').getByRole('cell').last()).toHaveText('3');
  await expect(row('202').getByRole('cell').last()).toHaveText('2');
  await expect(row('404')).toContainText('5 DNC');
});
