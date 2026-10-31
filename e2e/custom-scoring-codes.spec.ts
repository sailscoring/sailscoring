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
