import { signedInTest as test, expect } from './fixtures';
import { addCompetitor, createSplitFleetSeries, enableFeatures } from './helpers';

/**
 * Crew, club and class on a championship's standings.
 *
 * The championship table is its own renderer, so the optional competitor
 * fields every other standings table carries had to be taught to it one at a
 * time — and these three were never taught. A keelboat championship then
 * published a table with no crew and no club, with Club enabled by default.
 * This covers the scorer's view; the published page is covered by the
 * split-fleets renderer tests.
 */
test('the championship standings carry crew, club and class', async ({ page, signedInEmail }) => {
  test.setTimeout(240_000);
  await enableFeatures(page, signedInEmail, ['split-fleets']);

  await createSplitFleetSeries(page, {
    name: 'Crewed Worlds Demo',
    venue: 'Howth',
    fleetCount: 1,
  });

  // Crew and class are off by default; club is on.
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page
    .getByRole('heading', { name: 'Competitor fields' })
    .locator('..')
    .getByRole('button', { name: 'Edit ▸' })
    .click();
  await page.getByRole('checkbox', { name: 'Crew', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Class', exact: true }).check();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('navigation').getByRole('link', { name: 'Competitors' }).click();
  const boats = [
    { sailNumber: '210001', name: 'Jane Doe', boatClass: 'J/109', crew: 'Mark Smith', club: 'Howth Yacht Club' },
    { sailNumber: '210002', name: 'Pat Ryan', boatClass: 'Sigma 33', crew: 'Ann Boyle', club: 'Royal Cork' },
    { sailNumber: '210003', name: 'Sam Nolan', boatClass: 'J/109', crew: 'Eve Casey', club: 'Royal St George' },
  ];
  for (const boat of boats) await addCompetitor(page, boat);

  // One race, sailed — the standings table only exists once a race
  // has been scored.
  await page.getByRole('navigation').getByRole('link', { name: 'Split Fleets' }).click();
  // One fleet is everyone, so the first race needs no assignment.
  await page.getByRole('button', { name: 'Add race Q1' }).click();

  await page
    .getByTestId('logical-race-qualifying-1')
    .getByRole('link', { name: /enter finishes/ })
    .click();
  await expect(page).toHaveURL(/\/races\//);
  for (const boat of boats) {
    await page.getByLabel('Sail number').fill(boat.sailNumber);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.goBack();

  const standings = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Standings', exact: true }) });
  await expect(standings.getByRole('columnheader', { name: 'Name / Crew' })).toBeVisible();
  await expect(standings.getByRole('columnheader', { name: 'Club' })).toBeVisible();
  await expect(standings.getByRole('columnheader', { name: 'Class' })).toBeVisible();
  await expect(standings.getByText('Mark Smith')).toBeVisible();
  await expect(standings.getByText('Howth Yacht Club')).toBeVisible();
  await expect(standings.getByText('Sigma 33')).toBeVisible();
});
