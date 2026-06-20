import { signedInTest as test, expect } from './fixtures';
import { addCompetitor, createFleets, createSeriesQuick } from './helpers';

/**
 * E2E for per-race fleet scoping via membership-only starts (#226).
 *
 * A scratch series with two fleets (Blue, Red), two boats each. With no
 * starts recorded, every fleet is in the race, so all four boats appear as
 * implicit DNCs in the non-finisher panel. Adding a fleets-only start (no gun
 * time) for Blue scopes the race to Blue: the Red boats drop out of entry.
 */

const blue = [
  { sailNumber: 'BLU1', name: 'Blue One', fleet: 'Blue' },
  { sailNumber: 'BLU2', name: 'Blue Two', fleet: 'Blue' },
];
const red = [
  { sailNumber: 'RED1', name: 'Red One', fleet: 'Red' },
  { sailNumber: 'RED2', name: 'Red Two', fleet: 'Red' },
];

test('a fleets-only start scopes race entry to that fleet', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Fleet Scoping Test' });
  await createFleets(page, ['Blue', 'Red']);

  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const c of [...blue, ...red]) {
    await addCompetitor(page, c);
  }

  // Add a race and open it.
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  // No starts yet → all fleets implied → all four boats are non-finishers.
  await expect(page.getByTestId('non-finisher-BLU1')).toBeVisible();
  await expect(page.getByTestId('non-finisher-BLU2')).toBeVisible();
  await expect(page.getByTestId('non-finisher-RED1')).toBeVisible();
  await expect(page.getByTestId('non-finisher-RED2')).toBeVisible();

  // Add a membership-only start for Blue: no gun time, just the fleet.
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Add start' })).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'Blue' }).check();
  // Leave the gun time blank — a fleets-only start.
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  // The card records the timeless start against Blue.
  await expect(page.getByText('No gun time')).toBeVisible();

  // Race is now scoped to Blue: Red boats drop out of entry.
  await expect(page.getByTestId('non-finisher-BLU1')).toBeVisible();
  await expect(page.getByTestId('non-finisher-BLU2')).toBeVisible();
  await expect(page.getByTestId('non-finisher-RED1')).toHaveCount(0);
  await expect(page.getByTestId('non-finisher-RED2')).toHaveCount(0);
});
