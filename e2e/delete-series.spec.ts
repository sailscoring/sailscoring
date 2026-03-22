import { test, expect } from '@playwright/test';

test('delete series with warning dialog', async ({ page }) => {
  // ── 1. Create two series ───────────────────────────────────────────────────
  await page.goto('/');
  await page.getByRole('link', { name: 'New series' }).click();
  await page.getByLabel('Name').fill('Series to Keep');
  await page.getByRole('button', { name: 'Create series' }).click();
  await expect(page).toHaveURL(/\/series\/[0-9a-f-]{36}\/competitors$/);

  await page.goto('/');
  await page.getByRole('link', { name: 'New series' }).click();
  await page.getByLabel('Name').fill('Series to Delete');
  await page.getByRole('button', { name: 'Create series' }).click();
  await expect(page).toHaveURL(/\/series\/[0-9a-f-]{36}\/competitors$/);

  // ── 2. Verify both series appear on home ───────────────────────────────────
  await page.goto('/');
  await expect(page.getByText('Series to Keep')).toBeVisible();
  await expect(page.getByText('Series to Delete')).toBeVisible();

  // ── 3. Click delete on the series to delete ────────────────────────────────
  await page.getByRole('button', { name: 'Delete Series to Delete' }).click();

  // ── 4. Warning dialog must appear with series name and warning text ─────────
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Series to Delete/ })).toBeVisible();
  await expect(page.getByText(/permanently delete/i)).toBeVisible();
  await expect(page.getByText(/cannot be undone/i)).toBeVisible();

  // ── 5. Cancel leaves series intact ────────────────────────────────────────
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('Series to Delete')).toBeVisible();

  // ── 6. Delete for real ─────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Delete Series to Delete' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Delete series' }).click();

  // ── 7. Series is gone; the other one remains ───────────────────────────────
  await expect(page.getByText('Series to Delete')).not.toBeVisible();
  await expect(page.getByText('Series to Keep')).toBeVisible();
});
