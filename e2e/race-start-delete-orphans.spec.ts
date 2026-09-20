import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick } from './helpers';

/**
 * #614 — deleting a race's start for a fleet used to leave that fleet's
 * results behind, still scored but no longer visible.
 *
 * The case, from a real race day: classes 1-3 sailed both races, classes 4
 * and 5 sailed only race 1. Race 2 was set up with all five starts, a class 4
 * boat was marked DNF in it by mistake, and the class 4 and 5 starts were then
 * deleted. Deleting a start is a start-row delete — the result rows behind it
 * are untouched — and the two readers of those rows then disagreed about who
 * was in the race: the finish sheet scopes itself to the fleets that have a
 * start, so the stale DNF was invisible there, while scoring selected finishes
 * by fleet membership alone and kept scoring it. The race counted as held
 * (the other classes finished it) and the fleet counted as having come to the
 * start (that one non-DNC row), so race 2 counted for class 4: the stale boat
 * took its DNF and every other class 4 boat took a DNC.
 *
 * The invariant: a fleet with no start in a race contributes nothing to that
 * race and takes no DNCs for it.
 */
test('deleting a start leaves nothing of that fleet scored in the race', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Start Delete Orphans 2026' });
  await createFleets(page, ['Class 1', 'Class 4']);

  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const [sail, name, fleet] of [
    ['101', 'Alice', 'Class 1'],
    ['102', 'Bob', 'Class 1'],
    ['401', 'Carol', 'Class 4'],
    ['402', 'Dave', 'Class 4'],
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(sail);
    await page.getByLabel('Competitor name').fill(name);
    await page.getByRole('checkbox', { name: fleet }).check();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: sail })).toBeVisible();
  }

  // Two races. Race 1 is sailed by both classes.
  await page.getByRole('link', { name: 'Races' }).click();
  for (const _ of [1, 2]) {
    await page.getByRole('button', { name: 'Add race' }).click();
  }
  await expect(page.getByText('Race 2')).toBeVisible();

  await page.getByText('Race 1').click();
  await expect(page.getByTestId('race-switcher')).toHaveText(/Race 1/);
  for (const sail of ['101', '102', '401', '402']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // Race 2: a start per class, the two Class 1 boats finish, and a Class 4
  // boat is marked DNF by mistake — Class 4 was not racing.
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await page.getByText('Race 2').click();
  await expect(page.getByTestId('race-switcher')).toHaveText(/Race 2/);
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  for (const fleet of ['Class 1', 'Class 4']) {
    await page.getByRole('button', { name: 'Add start' }).click();
    await page.getByRole('checkbox', { name: fleet }).check();
    await page.getByRole('button', { name: 'Save' }).click();
  }
  await expect(page.getByTestId('race-start-row')).toHaveCount(2);

  for (const sail of ['101', '102']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await page.getByTestId('non-finisher-401').getByRole('combobox').click();
  await page.getByRole('option', { name: 'DNF' }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // Class 4 did not in fact race: its start is deleted. The DNF row stays in
  // the database, and the sheet — scoped to the fleets that have a start —
  // stops showing it, so there is no way to reach it from here.
  // By the fleet it names, not by position: neither start has a gun time, so
  // which of them sorts last is not something to lean on.
  await page.getByTestId('race-start-row').filter({ hasText: 'Class 4' })
    .getByRole('button', { name: 'Delete start' }).click();
  await expect(page.getByTestId('race-start-row')).toHaveCount(1);
  await expect(page.getByTestId('race-start-row')).toContainText('Class 1');
  await expect(page.getByTestId('non-finisher-401')).toHaveCount(0);

  // Standings: race 2 is struck for Class 4 — no points for the stale DNF,
  // and no DNC for the boat that never sailed it.
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);
  const class4 = page.getByRole('table').filter({ hasText: '401' });
  for (const sail of ['401', '402']) {
    const row = class4.getByRole('row').filter({ hasText: sail });
    // rank, sail, boat, name, club, R1, R2 — R2 is the struck column.
    await expect(row.getByRole('cell').nth(6)).toHaveText('—');
  }
  await expect(class4).not.toContainText('DNC');
  await expect(class4).not.toContainText('DNF');

  // Class 1 still scores both races.
  const class1 = page.getByRole('table').filter({ hasText: '101' });
  await expect(class1.getByRole('row').filter({ hasText: '101' }).getByRole('cell').nth(6))
    .not.toHaveText('—');
});
