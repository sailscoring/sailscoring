import { signedInTest as test, expect } from './fixtures';
import { addCompetitor, createSeriesQuick } from './helpers';

test('find duplicates pre-selects the extra copies for review', async ({ page }) => {
  // ── 1. A series with two distinct boats ───────────────────────────────────
  await createSeriesQuick(page, { name: 'Duplicate Finder Series' });
  await addCompetitor(page, { sailNumber: 'IRL100', name: 'Original Entry', club: 'HYC' });
  await addCompetitor(page, { sailNumber: 'IRL200', name: 'Unrelated Boat' });

  // ── 2. Seed an exact duplicate via the API — the add form deliberately
  //       blocks creating one by hand ─────────────────────────────────────────
  const seriesId = page.url().match(/\/series\/([0-9a-f-]+)/)![1];
  const listRes = await page.request.get(`/api/v1/series/${seriesId}/competitors`);
  const competitors: Array<{ sailNumber: string; fleetIds: string[] }> = await listRes.json();
  const original = competitors.find((c) => c.sailNumber === 'IRL100')!;

  const seedRes = await page.request.post(`/api/v1/series/${seriesId}/competitors`, {
    data: {
      competitors: [
        {
          id: crypto.randomUUID(),
          seriesId,
          fleetIds: original.fleetIds,
          sailNumber: 'IRL100',
          name: 'Duplicate Entry',
          club: '',
          gender: '',
          age: null,
          createdAt: Date.now(),
        },
      ],
    },
  });
  expect(seedRes.ok()).toBeTruthy();

  await page.reload();
  await expect(page.getByText('3 competitors')).toBeVisible();

  // ── 3. The finder selects the extra copy, not the keeper ─────────────────
  await page.getByRole('button', { name: 'Find duplicates' }).click();
  await expect(page.getByText(/1 duplicate group found/)).toBeVisible();
  await expect(page.getByText('1 selected')).toBeVisible();
  await expect(
    page.getByRole('row', { name: /Duplicate Entry/ }).getByRole('checkbox'),
  ).toBeChecked();
  await expect(
    page.getByRole('row', { name: /Original Entry/ }).getByRole('checkbox'),
  ).not.toBeChecked();
  await expect(
    page.getByRole('row', { name: /Unrelated Boat/ }).getByRole('checkbox'),
  ).not.toBeChecked();

  // ── 4. Deleting the pre-selection keeps the original ─────────────────────
  await page.getByRole('button', { name: 'Delete selected' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('2 competitors')).toBeVisible();
  await expect(page.getByText('Original Entry')).toBeVisible();
  await expect(page.getByText('Duplicate Entry')).not.toBeVisible();

  // ── 5. A clean list reports no duplicates ────────────────────────────────
  await page.getByRole('button', { name: 'Find duplicates' }).click();
  await expect(page.getByText('No duplicates found.')).toBeVisible();
});

test('possible duplicates: merge keeps the results under the newest sail number', async ({ page }) => {
  // ── 1. A boat renumbered between imports, plus a conflicting pair ────────
  await createSeriesQuick(page, { name: 'Merge Duplicates Series' });
  await addCompetitor(page, { sailNumber: 'IRL100', name: 'J. Bloggs', club: 'HYC' });
  await addCompetitor(page, { sailNumber: 'IRL150', name: 'J. Bloggs' });
  await addCompetitor(page, { sailNumber: 'IRL300', name: 'C. Onflict' });
  await addCompetitor(page, { sailNumber: 'IRL350', name: 'C. Onflict' });
  await addCompetitor(page, { sailNumber: 'IRL200', name: 'A. Nother' });

  // ── 2. One race: IRL100 has a result; IRL300 and IRL350 both do (conflict) ─
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  for (const sail of ['IRL100', 'IRL300', 'IRL350', 'IRL200']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // ── 3. Find duplicates opens the possible-duplicates review ──────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Competitors' }).click();
  await expect(page.getByText('5 competitors')).toBeVisible();
  await page.getByRole('button', { name: 'Find duplicates' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Possible duplicates' })).toBeVisible();

  // The renumbered pair is mergeable into the newest number; the pair with a
  // finish apiece in the same race is flagged instead of offered a merge.
  await expect(dialog.getByRole('button', { name: 'Merge into IRL150' })).toBeVisible();
  await expect(dialog.getByText(/both have a finish in the same race/)).toBeVisible();

  // ── 4. Merge — one entry remains, holding the result and the new number ──
  await dialog.getByRole('button', { name: 'Merge into IRL150' }).click();
  await expect(page.getByText('Merged 2 entries into IRL150.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  await expect(page.getByText('4 competitors')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'IRL150', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'IRL100', exact: true })).not.toBeVisible();
  // The survivor kept the keeper's details where the newer row had none.
  await expect(page.getByRole('row', { name: /IRL150/ })).toContainText('HYC');

  // ── 5. The finish moved to the survivor ──────────────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('IRL150')).toBeVisible();
  await expect(page.getByText('IRL100')).not.toBeVisible();
});
