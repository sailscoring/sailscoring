import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick, enableFeatures } from './helpers';

/**
 * A boat out of a fleet for one race: ISORA's Two-Handed division, which a
 * boat leaves for a race it sails crewed. Three boats in Overall and
 * Two-Handed, two races, Alpha first, Bravo second and Charlie third in both.
 * Alpha sails race 1 crewed.
 *
 *   Overall:    Alpha 1 + 1 = 2, Bravo 2 + 2 = 4, Charlie 3 + 3 = 6.
 *   Two-Handed: race 1 is Bravo 1st, Charlie 2nd; Alpha scores it as not
 *               sailed there — three entries, so 4.
 *               Alpha 4 + 1 = 5, Bravo 1 + 2 = 3, Charlie 2 + 3 = 5.
 *
 * Then Charlie is re-classed out of Two-Handed from race 2 on, from the
 * competitor dialog: Charlie 2 + 4 = 6, the others unchanged.
 */

const boats = [
  { sailNumber: '1001', name: 'Alpha' },
  { sailNumber: '1002', name: 'Bravo' },
  { sailNumber: '1003', name: 'Charlie' },
];

test('a boat out of Two-Handed for one race', async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['race-fleet-membership']);
  await createSeriesQuick(page, { name: 'Two-Handed Division' });
  await createFleets(page, ['Overall', 'Two-Handed']);

  await page.getByRole('navigation').getByRole('link', { name: 'Competitors' }).click();
  for (const b of boats) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number *').fill(b.sailNumber);
    await page.getByLabel('Competitor name').fill(b.name);
    await page.getByRole('checkbox', { name: 'Overall' }).check();
    await page.getByRole('checkbox', { name: 'Two-Handed' }).check();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: b.sailNumber })).toBeVisible();
  }

  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  for (let n = 1; n <= 2; n++) {
    await page.getByRole('button', { name: 'Add race' }).click();
    await expect(page.getByText(`Race ${n}`)).toBeVisible();
  }
  for (let n = 1; n <= 2; n++) {
    await page.getByText(`Race ${n}`, { exact: true }).click();
    await expect(page.getByLabel('Sail number')).toBeVisible();
    for (const b of boats) {
      await page.getByLabel('Sail number').fill(b.sailNumber);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
    }
    await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

    if (n === 1) {
      // ── Alpha sails race 1 crewed ─────────────────────────────────────────
      await page.getByRole('button', { name: 'Fleets', exact: true }).click();
      const fleetsInRace = page.getByTestId('race-fleets');
      await fleetsInRace.getByRole('checkbox', { name: '1001 racing in Two-Handed' }).uncheck();
      await expect(fleetsInRace.getByText('Two-Handed in this race: 2 of 3 boats')).toBeVisible();

      // The finish sheet strikes the fleet through; its row menu puts it back
      // and takes it out again.
      await page.getByRole('button', { name: 'Finish entry' }).click();
      await expect(page.getByTitle('Not in Two-Handed this race')).toBeVisible();
      await page.getByRole('button', { name: 'Row actions for 1001' }).click();
      await page.getByRole('menuitem', { name: 'Back in Two-Handed this race' }).click();
      await expect(page.getByTitle('Not in Two-Handed this race')).toBeHidden();
      await page.getByRole('button', { name: 'Row actions for 1001' }).click();
      await page.getByRole('menuitem', { name: 'Not in Two-Handed this race' }).click();
      await expect(page.getByTitle('Not in Two-Handed this race')).toBeVisible();
      await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
    }

    await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
    await expect(page).toHaveURL(/\/races$/);
  }

  // ── Each fleet's standings ─────────────────────────────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);
  const fleet = (name: string) =>
    page.getByTestId('fleet-standings').filter({ has: page.getByRole('heading', { name, exact: true }) });
  const row = (fleetName: string, sail: string) => fleet(fleetName).getByRole('row').filter({ hasText: sail });

  await expect(row('Overall', '1001').getByRole('cell').last()).toHaveText('2');
  await expect(row('Overall', '1002').getByRole('cell').last()).toHaveText('4');

  await expect(row('Two-Handed', '1002').getByRole('cell').first()).toHaveText('1');
  await expect(row('Two-Handed', '1002').getByRole('cell').last()).toHaveText('3');
  await expect(row('Two-Handed', '1001').getByRole('cell').last()).toHaveText('5');
  await expect(row('Two-Handed', '1001').getByTitle('Did not race in this fleet')).toHaveText('4 —');
  await expect(row('Two-Handed', '1001').getByTestId('fleet-part-marker')).toHaveAttribute(
    'title',
    'Two-Handed in 1 of 2 races',
  );
  await expect(fleet('Two-Handed').getByTestId('not-in-fleet-legend')).toBeVisible();
  await expect(fleet('Overall').getByTestId('not-in-fleet-legend')).toHaveCount(0);

  // ── Charlie out of Two-Handed from race 2 on, from the competitor dialog ──
  await page.getByRole('navigation').getByRole('link', { name: 'Competitors' }).click();
  await expect(page).toHaveURL(/\/competitors$/);
  await page.getByRole('row').filter({ has: page.getByRole('cell', { name: '1003', exact: true }) }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit competitor' });
  await dialog.getByRole('button', { name: /^Changes by race/ }).click();
  const byRace = dialog.getByTestId('competitor-race-fleets');
  await byRace.getByLabel('From race').selectOption({ label: 'R2' });
  await byRace.getByLabel('Out of fleet').selectOption({ label: 'Two-Handed' });
  await byRace.getByRole('button', { name: 'Apply' }).click();
  await expect(byRace.getByRole('checkbox', { name: '1003 in Two-Handed for race 2' })).not.toBeChecked();
  await expect(byRace.getByRole('checkbox', { name: '1003 in Two-Handed for race 1' })).toBeChecked();
  await expect(byRace.getByText('(1 race differ)')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('navigation').getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);
  await expect(row('Two-Handed', '1003').getByRole('cell').last()).toHaveText('6');
  await expect(row('Two-Handed', '1003').getByTestId('fleet-part-marker')).toHaveAttribute(
    'title',
    'Two-Handed in 1 of 2 races',
  );
  await expect(row('Overall', '1003').getByRole('cell').last()).toHaveText('6');
});
