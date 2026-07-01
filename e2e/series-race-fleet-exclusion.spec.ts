import { signedInTest as test, expect } from './fixtures';
import { addCompetitor, createFleets, createSeriesQuick } from './helpers';

/**
 * E2E for series-scoped per-fleet race exclusions (#246): a scorer strikes a
 * race for one fleet directly from the standings column header.
 *
 * Two fleets (Blue, Red), two boats each, two races. Blue finishes in the same
 * order both races (BLU1, BLU2), so before any exclusion BLU1 = 2, BLU2 = 4.
 * Striking R2 for Blue from the column header drops it to BLU1 = 1, BLU2 = 2,
 * while Red — which keeps both races — is untouched. The strike persists across
 * a reload.
 */

const blue = [
  { sailNumber: 'BLU1', name: 'Blue One', fleet: 'Blue' },
  { sailNumber: 'BLU2', name: 'Blue Two', fleet: 'Blue' },
];
const red = [
  { sailNumber: 'RED1', name: 'Red One', fleet: 'Red' },
  { sailNumber: 'RED2', name: 'Red Two', fleet: 'Red' },
];

async function addRaceResults(page: import('@playwright/test').Page, raceName: string, order: string[]) {
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText(raceName, { exact: true }).click();
  await expect(page.getByText(`${raceName} — results`)).toBeVisible();
  for (const sail of order) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: sail })).toBeVisible();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
}

test('exclude a race for one fleet from the standings column header', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Exclusion Cup' });
  await createFleets(page, ['Blue', 'Red']);

  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const c of [...blue, ...red]) await addCompetitor(page, c);

  // Both races: Blue finishes BLU1 then BLU2; Red finishes RED1 then RED2.
  await addRaceResults(page, 'Race 1', ['BLU1', 'BLU2', 'RED1', 'RED2']);
  await addRaceResults(page, 'Race 2', ['BLU1', 'BLU2', 'RED1', 'RED2']);

  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);

  // Scope to each fleet's own table by a boat it contains.
  const blueTable = page.getByRole('table').filter({ has: page.getByText('BLU1') });
  const redTable = page.getByRole('table').filter({ has: page.getByText('RED1') });
  const blu2Total = () => blueTable.getByRole('row').filter({ hasText: 'BLU2' }).getByRole('cell').last();
  const red2Total = () => redTable.getByRole('row').filter({ hasText: 'RED2' }).getByRole('cell').last();

  // Before exclusion: BLU2 = 2 + 2 = 4; RED2 = 2 + 2 = 4.
  await expect(blu2Total()).toHaveText('4');
  await expect(red2Total()).toHaveText('4');

  // Strike R2 for the Blue fleet from its column header.
  await blueTable.getByRole('button', { name: 'R2', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Exclude R2 from this fleet' }).click();

  // Blue R2 no longer counts: BLU2 drops to 2, BLU1 to 1. Red is untouched.
  await expect(blu2Total()).toHaveText('2');
  await expect(blueTable.getByRole('row').filter({ hasText: 'BLU1' }).getByRole('cell').last()).toHaveText('1');
  await expect(red2Total()).toHaveText('4');

  // The struck column is marked; the menu now offers the inverse action.
  await expect(blueTable.getByRole('columnheader').filter({ hasText: 'R2' })).toHaveClass(/line-through/);
  await blueTable.getByRole('button', { name: 'R2', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Include R2 for this fleet' })).toBeVisible();
  await page.keyboard.press('Escape');

  // The exclusion persists across a reload.
  await page.reload();
  await expect(blu2Total()).toHaveText('2');
  await expect(red2Total()).toHaveText('4');
  await expect(blueTable.getByRole('columnheader').filter({ hasText: 'R2' })).toHaveClass(/line-through/);
});
