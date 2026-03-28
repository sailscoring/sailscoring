import { test, expect } from './fixtures';

function csvBuffer(content: string) {
  return { name: 'competitors.csv', mimeType: 'text/csv', buffer: Buffer.from(content) };
}

async function uploadCsv(page: import('@playwright/test').Page, content: string) {
  await page.locator('input[type=file][accept=".csv,text/csv"]').setInputFiles(csvBuffer(content));
}

test('import competitors from CSV', async ({ page }) => {
  // ── 1. Create a series ────────────────────────────────────────────────────
  await page.goto('/');
  await page.getByRole('link', { name: 'New series' }).click();
  await page.getByLabel('Name').fill('Import Test Series');
  await page.getByRole('button', { name: 'Create series' }).click();
  await expect(page).toHaveURL(/\/series\/[0-9a-f-]{36}\/competitors$/);

  // ── 2. Add one competitor manually so we can test overwrite & unchanged ───
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('IRL100');
  await page.getByLabel('Helm name').fill('Original Name');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'IRL100', exact: true })).toBeVisible();

  // ── 3. Upload a CSV ───────────────────────────────────────────────────────
  const csv = [
    'Sail,Helm,Club',
    'IRL100,Updated Name,HYC',   // exists — should update
    'IRL200,Jane Doe,RCYC',      // new
    ',No Sail Number,HYC',       // missing sail — should be skipped
  ].join('\n');

  await uploadCsv(page, csv);

  // ── 4. Mapping dialog appears ─────────────────────────────────────────────
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: /map columns/i })).toBeVisible();

  // ── 5. Import button shows correct row count ──────────────────────────────
  await expect(page.getByRole('button', { name: /Import 3 rows/i })).toBeVisible();

  // ── 6. Run the import ─────────────────────────────────────────────────────
  await page.getByRole('button', { name: /Import 3 rows/i }).click();

  // ── 7. Done dialog shows correct counts ──────────────────────────────────
  await expect(page.getByRole('heading', { name: /import complete/i })).toBeVisible();
  await expect(page.getByText(/1 competitor.* added/i)).toBeVisible();
  await expect(page.getByText(/1 updated/i)).toBeVisible();
  await expect(page.getByText(/1 row.* skipped/i)).toBeVisible();
  await expect(page.getByText(/Row 4: missing sail number/i)).toBeVisible();

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  // ── 8. Competitors table reflects the import ──────────────────────────────
  const irl100Row = page.getByRole('row', { name: /IRL100/ });
  await expect(irl100Row).toContainText('Updated Name');
  await expect(irl100Row).toContainText('HYC');
  await expect(page.getByRole('cell', { name: 'IRL200', exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /IRL200/ })).toContainText('Jane Doe');
  // The skipped row must not have been added
  await expect(page.getByText('No Sail Number')).not.toBeVisible();

  // ── 9. Re-import the same CSV — all matched rows should be unchanged ───────
  await uploadCsv(page, csv);
  await expect(page.getByRole('button', { name: /Import 3 rows/i })).toBeVisible();
  await page.getByRole('button', { name: /Import 3 rows/i }).click();
  await expect(page.getByRole('heading', { name: /import complete/i })).toBeVisible();
  await expect(page.getByText(/0 competitor.* added/i)).toBeVisible();
  await expect(page.getByText(/0 updated/i)).toBeVisible();
  await expect(page.getByText(/2 unchanged/i)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 10. Cancel mid-flow leaves data untouched ────────────────────────────
  await uploadCsv(page, 'Sail,Helm\nIRL999,Should Not Appear\n');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('cell', { name: 'IRL999', exact: true })).not.toBeVisible();
});
