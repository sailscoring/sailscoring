import { signedInTest as test, expect } from './fixtures';
import { addCompetitor, createSeriesQuick } from './helpers';

/**
 * Excluded competitors: a boat on the list that is not an entrant.
 *
 * Four boats are added; the fourth is excluded from the Competitors tab. It
 * must then be missing from the standings and from the DNC count — three
 * entered boats, so an absent boat scores 3 + 1 = 4, not 5. On the finish
 * sheet the excluded boat sits in its own group rather than among the
 * non-finishers, and typing its sail number offers to include it, after
 * which it scores like anyone else and the DNC count moves to 5.
 */

const boats = [
  { sailNumber: '1001', name: 'Alice Murphy' },
  { sailNumber: '1002', name: 'Bob Kelly' },
  { sailNumber: '1003', name: 'Carol Ryan' },
  { sailNumber: '1004', name: 'Dave Walsh' },
];

test('an excluded boat leaves the standings and the DNC count, and comes back from the finish sheet', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Roster Series 2026', venue: 'HYC' });
  for (const b of boats) await addCompetitor(page, b);
  await expect(page.getByText('4 competitors')).toBeVisible();

  // ── 1. Exclude Dave from the list ─────────────────────────────────────────
  const daveRow = page.getByRole('row', { name: /1004/ });
  await daveRow.getByRole('checkbox', { name: 'Excluded from the series' }).check();
  await expect(page.getByText('4 competitors · 1 excluded')).toBeVisible();
  await expect(daveRow).toHaveAttribute('data-excluded', 'true');

  // Hide excluded takes him out of the table without losing him.
  await page.getByRole('checkbox', { name: 'Hide excluded' }).check();
  await expect(page.getByRole('cell', { name: '1004' })).toHaveCount(0);
  await expect(page.getByText('3 of 4 competitors · 1 excluded')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Hide excluded' }).uncheck();
  await expect(page.getByRole('cell', { name: '1004' })).toBeVisible();

  // ── 2. One race: Alice and Bob finish, Carol is absent ────────────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByLabel('Sail number')).toBeVisible();

  // Dave is not a non-finisher; he is in the collapsed Excluded group.
  await expect(page.getByTestId('non-finisher-1003')).toBeVisible();
  await expect(page.getByTestId('non-finisher-1004')).toHaveCount(0);
  await page.getByRole('button', { name: /Excluded \(1\)/ }).click();
  await expect(page.getByTestId('excluded-1004')).toBeVisible();

  for (const sail of ['1001', '1002']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // ── 3. Standings: three entrants, Carol's DNC = 4, Dave absent ────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByText(/3 competitors/)).toBeVisible();
  await expect(page.getByRole('cell', { name: '1004' })).toHaveCount(0);
  const carol = page.getByRole('row', { name: /1003/ });
  await expect(carol.getByRole('cell', { name: /DNC/ })).toHaveText(/4/);

  // ── 4. Back on the sheet, Dave turns up: typing his number includes him ──
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByLabel('Sail number')).toBeVisible();
  await page.getByLabel('Sail number').fill('1004');
  await page.getByLabel('Sail number').press('Enter');
  const prompt = page.getByTestId('pending-excluded');
  await expect(prompt).toContainText('is excluded from this series');
  await prompt.getByRole('button', { name: 'Include and record finish' }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await expect(page.getByText('3 finishers', { exact: false })).toBeVisible();

  // ── 5. Now he is an entrant: four boats, Carol's DNC = 5 ──────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByText(/4 competitors/)).toBeVisible();
  await expect(page.getByRole('cell', { name: '1004' })).toBeVisible();
  await expect(carol.getByRole('cell', { name: /DNC/ })).toHaveText(/5/);

  // And the Competitors tab agrees.
  await page.getByRole('navigation').getByRole('link', { name: 'Competitors' }).click();
  await expect(page.getByRole('button', { name: 'Add competitor' })).toBeVisible();
  await expect(page.getByText('4 competitors', { exact: true })).toBeVisible();
});

test('the Set field dialog excludes a selection in one go', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Roster Bulk 2026' });
  for (const b of boats) await addCompetitor(page, b);

  const filter = page.getByLabel('Filter competitors');
  await filter.fill('100');
  await page.getByRole('checkbox', { name: 'Select all shown competitors' }).check();
  await filter.press('Escape');
  await expect(page.getByText('4 selected')).toBeVisible();

  await page.getByRole('button', { name: /Set field/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Field').click();
  await page.getByRole('option', { name: 'Excluded' }).click();
  await dialog.getByRole('button', { name: 'Exclude 4 competitors' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Excluded 4 competitors from the series.');
  await expect(page.getByText('4 competitors · 4 excluded')).toBeVisible();

  // Bring two back with the form's own checkbox.
  await page.getByRole('row', { name: /1001/ }).getByRole('cell', { name: '1001' }).click();
  const form = page.getByRole('dialog');
  await form.getByRole('checkbox', { name: /Excluded from the series/ }).uncheck();
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).not.toBeVisible();
  await expect(page.getByText('4 competitors · 3 excluded')).toBeVisible();
});
