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
