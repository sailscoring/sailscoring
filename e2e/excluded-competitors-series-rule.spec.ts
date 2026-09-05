import { signedInTest as test, expect } from './fixtures';
import { addCompetitor, createSeriesQuick } from './helpers';

/**
 * The series-level rule (#504): "Rank only boats that took part" on the
 * Scoring card treats a boat with no result other than DNC as not entered.
 * Carol and Dave never sail, so both leave the standings and the entry count
 * — two entrants — and the Competitors tab marks them "auto". Dave is still
 * an ordinary candidate on the finish sheet; the moment he finishes a race he
 * is entered, and Carol alone stays off the table.
 */

const boats = [
  { sailNumber: '1001', name: 'Alice Murphy' },
  { sailNumber: '1002', name: 'Bob Kelly' },
  { sailNumber: '1003', name: 'Carol Ryan' },
  { sailNumber: '1004', name: 'Dave Walsh' },
];

test('a boat with no results is not an entrant while the series ranks only boats that took part', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Rule Series 2026', venue: 'HYC' });
  for (const b of boats) await addCompetitor(page, b);

  // ── 1. One race: Alice and Bob finish; Carol and Dave absent ─────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByLabel('Sail number')).toBeVisible();
  for (const sail of ['1001', '1002']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // Without the rule: four entrants, DNC = 5 for both absentees.
  await page.getByRole('navigation').getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByText(/4 competitors/)).toBeVisible();
  const carol = page.getByRole('row', { name: /1003/ });
  await expect(carol.getByRole('cell', { name: /DNC/ })).toHaveText(/5/);

  // ── 2. Turn the rule on ───────────────────────────────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Scoring', exact: true }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('checkbox', { name: /Rank only boats that took part/ }).check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/Rank only boats that took part/)).toBeVisible();

  // ── 3. Standings: both absentees are all-DNC, so both are out ─────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByText(/2 competitors/)).toBeVisible();
  await expect(page.getByRole('cell', { name: '1004' })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: '1003' })).toHaveCount(0);
  const notShown = page.getByTestId('not-shown');
  await expect(notShown.locator('summary')).toContainText('Not shown (2)');
  await notShown.locator('summary').click();
  await expect(page.getByTestId('not-shown-1004')).toContainText('No results');
  // The rule, not a scorer, dropped them: nothing to include by hand.
  await expect(page.getByTestId('not-shown-1004').getByRole('button', { name: 'Include' })).toHaveCount(0);
  const alice = page.getByRole('row', { name: /1001/ });
  await expect(alice.getByRole('cell').last()).toHaveText('1');

  // ── 4. Competitors tab marks them auto; the boxes stay free ──────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Competitors' }).click();
  await expect(page.getByRole('button', { name: 'Add competitor' })).toBeVisible();
  await expect(page.getByText('4 competitors · 2 excluded')).toBeVisible();
  await expect(page.getByRole('row', { name: /1004/ })).toHaveAttribute('data-excluded', 'auto');
  await expect(page.getByRole('row', { name: /1004/ }).getByRole('checkbox', { name: 'Excluded from the series' })).not.toBeChecked();

  // ── 5. Dave finishes race 1 late in the day: an ordinary candidate ───────
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByLabel('Sail number')).toBeVisible();
  await expect(page.getByTestId('non-finisher-1004')).toBeVisible();
  await page.getByLabel('Sail number').fill('1004');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // ── 6. He is entered now: three entrants; Carol alone is not shown ───────
  await page.getByRole('navigation').getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByText(/3 competitors/)).toBeVisible();
  await expect(page.getByRole('cell', { name: '1004' })).toBeVisible();
  await expect(notShown.locator('summary')).toContainText('Not shown (1)');
  await notShown.locator('summary').click();
  await expect(page.getByTestId('not-shown-1003')).toBeVisible();
});
