import { signedInTest as test, expect } from './fixtures';
import { addCompetitor, createSeriesQuick } from './helpers';

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
