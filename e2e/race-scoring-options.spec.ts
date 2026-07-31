import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, enableFeatures } from './helpers';

/**
 * Per-race scoring options (#342): the dialog, the races-list badge, and what
 * the standings do with the result.
 *
 * Three boats (N=3), three races, one discard from three races:
 *
 *   R1  Alice 1, Bob 2, Carol 3
 *   R2  Alice 1, Bob 2, Carol 3
 *   R3  Bob 1, Carol 2, Alice 3
 *
 * Alice leads on the plain profile — she discards her 3 in race 3 and nets 2.
 * Marking race 3 "must count" and weighting it ×2 takes that discard away and
 * doubles it: Alice keeps a 6 and nets 7, Bob nets 4 and wins the series.
 *
 * Gated behind race-scoring-options (#155), so enable it first.
 */

const competitors = [
  { sailNumber: '2001', name: 'Alice Murphy' },
  { sailNumber: '2002', name: 'Bob Kelly' },
  { sailNumber: '2003', name: 'Carol Ryan' },
];

test.beforeEach(async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['race-scoring-options']);
});

test('a race can be weighted and protected from discard', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Wave Regatta 2026' });

  for (const c of competitors) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sailNumber })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  for (let i = 1; i <= 3; i++) {
    await page.getByRole('button', { name: 'Add race' }).click();
    await expect(page.getByText(`Race ${i}`)).toBeVisible();
  }

  const finishOrder = [
    ['2001', '2002', '2003'],
    ['2001', '2002', '2003'],
    ['2002', '2003', '2001'],
  ];
  for (let i = 0; i < finishOrder.length; i++) {
    await page.getByText(`Race ${i + 1}`, { exact: false }).first().click();
    await expect(page.getByTestId('race-scoring-options')).toBeVisible();
    for (const sail of finishOrder[i]) {
      await page.getByLabel('Sail number').fill(sail);
      await page.getByRole('button', { name: 'Add' }).click();
    }
    await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
    await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
    await expect(page).toHaveURL(/\/races$/);
  }

  // One discard from three races, so race 3 is Alice's to drop.
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page
    .getByRole('heading', { name: 'Scoring', exact: true })
    .locator('..')
    .getByRole('button', { name: 'Edit ▸' })
    .click();
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByLabel('Rule 1: races sailed').fill('3');
  await page.getByLabel('Rule 1: discards').fill('1');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('1 discard from 3 races ·')).toBeVisible();

  // Alice leads: 1 + 1 + (3 discarded) = 2.
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);
  const rows = page.getByRole('row');
  const aliceRow = rows.filter({ hasText: 'Alice Murphy' });
  const bobRow = rows.filter({ hasText: 'Bob Kelly' });
  await expect(page.getByTestId('race-options-legend')).toHaveCount(0);
  await expect(aliceRow.getByRole('cell').nth(0)).toContainText('1');
  // Columns: rank, sail, boat, name, club, R1, R2, R3, Total, Nett.
  await expect(aliceRow.getByRole('cell').nth(9)).toContainText('2'); // Nett

  // Set race 3 to count double and never be discarded.
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await page.getByText('Race 3', { exact: false }).first().click();
  const chip = page.getByTestId('race-scoring-options');
  await expect(chip).toContainText('Scoring: standard');
  await chip.click();

  const dialog = page.getByTestId('race-scoring-options-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: /Must count/ }).check();
  await dialog.getByLabel('Points multiplier').fill('2');
  await expect(dialog).toContainText('1st scores 2, 2nd 4, 3rd 6');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(chip).toContainText('Scoring: ×2 · must count');

  // The races list carries the same summary, so a stray option is visible
  // when auditing the series.
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);
  await expect(
    page.getByTestId('race-row').filter({ hasText: 'Race 3' }).getByTestId('race-scoring-badge'),
  ).toHaveText('×2 · must count');

  // Bob now wins: Alice keeps a doubled 6 she cannot discard and nets 7.
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);
  await expect(page.getByRole('columnheader', { name: 'R3 ×2 *' })).toBeVisible();
  await expect(page.getByTestId('race-options-legend')).toHaveText(
    'R3 counts double and is never discarded.',
  );
  await expect(bobRow.getByRole('cell').nth(0)).toContainText('1');
  await expect(aliceRow.getByRole('cell').nth(7)).toContainText('6'); // R3
  await expect(aliceRow.getByRole('cell').nth(8)).toContainText('8'); // Total
  await expect(aliceRow.getByRole('cell').nth(9)).toContainText('7'); // Nett
  await expect(bobRow.getByRole('cell').nth(9)).toContainText('4');
});
