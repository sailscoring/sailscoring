import { signedInTest as test, expect } from './fixtures';
import { addCompetitor, createSeriesQuick } from './helpers';

/**
 * Placeholder standings: a series with entrants and no race sailed can
 * publish its standings page, so the results link goes live with the event.
 * The page lists the entrants, unranked, and says nothing has been sailed.
 */
test('standings publish as a placeholder before any race is sailed', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Placeholder League 2026' });
  await addCompetitor(page, { sailNumber: '201', name: 'Bernard' });
  await addCompetitor(page, { sailNumber: '15', name: 'Aoife' });

  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByText(/placeholder standings/)).toBeVisible();

  // ── Preview shows the placeholder ────────────────────────────────────────
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Preview results' });
  await expect(preview).toBeVisible();
  const frame = page.frameLocator('iframe[title="Results preview"]');
  await expect(frame.getByText('No races have been sailed yet.')).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Publish' })).toBeVisible();
  await preview.getByRole('button', { name: 'Publish' }).click();

  // ── Published ────────────────────────────────────────────────────────────
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const link = dialog.getByRole('link', { name: /\/p\// }).first();
  await expect(link).toBeVisible();
  const path = new URL((await link.getAttribute('href')) ?? '').pathname;

  // ── Read with no account: entrants in sail-number order, nothing ranked ──
  await page.goto(path);
  await expect(page.getByText('No races have been sailed yet.')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Rank' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Total' })).toHaveCount(0);
  const rows = page.locator('table.summarytable tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Aoife');
  await expect(rows.nth(1)).toContainText('Bernard');
});
