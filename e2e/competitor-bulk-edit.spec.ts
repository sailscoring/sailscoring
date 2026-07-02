import { signedInTest as test, expect } from './fixtures';
import { addCompetitor, createFleets, createSeriesQuick } from './helpers';

test('bulk set a field across selected competitors', async ({ page }) => {
  // ── 1. A series with three competitors, two clubs ─────────────────────────
  await createSeriesQuick(page, { name: 'Bulk Edit Series' });

  await addCompetitor(page, { sailNumber: 'IRL101', name: 'Blue Heron', club: 'Old YC' });
  await addCompetitor(page, { sailNumber: 'IRL102', name: 'Blue Jay', club: 'Howth YC' });
  await addCompetitor(page, { sailNumber: 'IRL201', name: 'Red Rover', club: 'Old YC' });
  await expect(page.getByText('3 competitors')).toBeVisible();

  // ── 2. Select the two "Blue" boats via filter + header checkbox ──────────
  const filter = page.getByLabel('Filter competitors');
  await filter.fill('blue');
  await page.getByRole('checkbox', { name: 'Select all shown competitors' }).check();
  await filter.press('Escape');
  await expect(page.getByText('3 competitors')).toBeVisible();
  await expect(page.getByText('2 selected')).toBeVisible();

  // ── 3. Set field → Club → HYC ─────────────────────────────────────────────
  await page.getByRole('button', { name: /Set field/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('heading', { name: 'Set a field on 2 competitors' }),
  ).toBeVisible();
  await dialog.getByLabel('Value').fill('HYC');
  await dialog.getByRole('button', { name: 'Apply to 2 competitors' }).click();
  await expect(dialog).not.toBeVisible();

  // Both selected rows carry the new club; the unselected row is untouched.
  await expect(
    page.getByRole('row', { name: /IRL101/ }).getByRole('cell', { name: 'HYC', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('row', { name: /IRL102/ }).getByRole('cell', { name: 'HYC', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('row', { name: /IRL201/ }).getByRole('cell', { name: 'Old YC', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Set club to "HYC" for 2 competitors.');

  // ── 4. The selection survives the apply, so "s" reopens for a follow-up ──
  await expect(page.getByText('2 selected')).toBeVisible();
  await page.keyboard.press('s');
  await expect(
    dialog.getByRole('heading', { name: 'Set a field on 2 competitors' }),
  ).toBeVisible();

  // ── 5. An empty value clears the field, and the button says so ───────────
  await dialog.getByRole('button', { name: 'Clear for 2 competitors' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('row', { name: /IRL101/ }).getByRole('cell', { name: 'HYC', exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole('row', { name: /IRL201/ }).getByRole('cell', { name: 'Old YC', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Cleared club for 2 competitors.');
});

test('bulk add and remove fleet membership', async ({ page }) => {
  // ── 1. A two-fleet series; all three boats start in White Sail ───────────
  await createSeriesQuick(page, { name: 'Bulk Fleet Series' });
  await createFleets(page, ['White Sail', 'Spinnaker']);
  await page.getByRole('navigation').getByRole('link', { name: 'Competitors' }).click();

  await addCompetitor(page, { sailNumber: 'IRL101', name: 'Blue Heron', fleet: 'White Sail' });
  await addCompetitor(page, { sailNumber: 'IRL102', name: 'Blue Jay', fleet: 'White Sail' });
  await addCompetitor(page, { sailNumber: 'IRL201', name: 'Red Rover', fleet: 'White Sail' });
  await expect(page.getByText('3 competitors')).toBeVisible();

  // ── 2. Add the two "Blue" boats to Spinnaker ──────────────────────────────
  const filter = page.getByLabel('Filter competitors');
  await filter.fill('blue');
  await page.getByRole('checkbox', { name: 'Select all shown competitors' }).check();
  await filter.press('Escape');
  await expect(page.getByText('2 selected')).toBeVisible();

  await page.getByRole('button', { name: /Set field/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Field').click();
  await page.getByRole('option', { name: 'Fleet' }).click();
  await dialog.getByLabel('Fleet', { exact: true }).click();
  await page.getByRole('option', { name: 'Spinnaker' }).click();
  await dialog.getByRole('button', { name: 'Add to Spinnaker' }).click();
  await expect(dialog).not.toBeVisible();

  await expect(
    page.getByRole('row', { name: /IRL101/ }).getByRole('cell', { name: 'White Sail, Spinnaker', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('row', { name: /IRL102/ }).getByRole('cell', { name: 'White Sail, Spinnaker', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('row', { name: /IRL201/ }).getByRole('cell', { name: 'White Sail', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Added 2 competitors to Spinnaker.');

  // ── 3. Remove all three from White Sail: Red Rover's only fleet is White
  //       Sail, so it is kept rather than left fleetless ────────────────────
  await page.getByRole('checkbox', { name: 'Select all shown competitors' }).check();
  await expect(page.getByText('3 selected')).toBeVisible();
  await page.getByRole('button', { name: /Set field/ }).click();
  await expect(
    dialog.getByRole('heading', { name: 'Set a field on 3 competitors' }),
  ).toBeVisible();
  // The dialog remembers Fleet as the field; switch the action to remove.
  await dialog.getByLabel('Action').click();
  await page.getByRole('option', { name: 'Remove from fleet' }).click();
  await dialog.getByLabel('Fleet', { exact: true }).click();
  await page.getByRole('option', { name: 'White Sail' }).click();
  await expect(
    dialog.getByText('1 of the selection will be kept — a competitor must belong to at least one fleet.'),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove from White Sail' }).click();
  await expect(dialog).not.toBeVisible();

  await expect(
    page.getByRole('row', { name: /IRL101/ }).getByRole('cell', { name: 'Spinnaker', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('row', { name: /IRL102/ }).getByRole('cell', { name: 'Spinnaker', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('row', { name: /IRL201/ }).getByRole('cell', { name: 'White Sail', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toHaveText(
    'Removed 2 competitors from White Sail. 1 kept — a competitor must belong to at least one fleet.',
  );
});
