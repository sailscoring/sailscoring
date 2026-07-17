import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, enableFeatures } from './helpers';

/**
 * Results lifecycle (Provisional vs Final): record a manual last-finisher
 * time on an untimed race, configure the SI protest time limit, mark the
 * series final through the checklist dialog, verify the read-only state, and
 * reopen it as provisional.
 *
 * Time-of-day-dependent text (the "Nh Nm ago" ticker, limit passed/pending)
 * is deliberately not asserted — only the recorded times themselves.
 */

const competitors = [
  { sailNumber: '11', name: 'Grace Malone' },
  { sailNumber: '22', name: 'Hugh Keane' },
];

test('results status: last finisher, finalise checklist, read-only, reopen', async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['results-status']);

  // ── 1. Series, two boats, one race finishing in sail order (untimed) ─────
  await createSeriesQuick(page, { name: 'Autumn League 2026', venue: 'HYC' });
  for (const c of competitors) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('row', { name: new RegExp(c.name) })).toBeVisible();
  }
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  for (const c of competitors) {
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // Pin the race date to the *local* today: the add-race default is the UTC
  // date, and the recency strip below compares against the local one — which
  // differ in the hour after local midnight outside UTC.
  const now = new Date();
  const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  await page.getByRole('button', { name: 'Edit date for Race 1' }).click();
  await page.getByLabel('Date for Race 1').fill(localToday);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Edit date for Race 1' })).toContainText(localToday);

  // ── 2. Record the last-finisher time by hand (no timed finishes) ─────────
  await page.getByRole('button', { name: /Edit last finisher time/ }).click();
  await page.getByLabel('Last finisher time for Race 1').fill('15:42:00');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('last-finisher')).toHaveText(/Last finisher 15:42:00/);

  // The Races tab strip picks it up (the race defaults to today's date).
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page.getByTestId('last-finisher-strip')).toContainText(
    'Last finisher (Race 1): 15:42:00',
  );

  // ── 3. Configure the SIs' protest time limit ─────────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const limitCard = page.locator('h2', { hasText: 'Protest time limit' }).locator('..').locator('..');
  await expect(page.locator('h2', { hasText: 'Protest time limit' })).toBeVisible();
  await limitCard.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('radio', { name: 'Time limit after the last finisher' }).check();
  await expect(page.getByLabel('Minutes')).toHaveValue('120');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(limitCard.getByText('120 minutes after the last finisher of each race')).toBeVisible();

  // ── 4. Mark as final through the checklist ───────────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByTestId('results-status-chip')).toHaveText('Provisional');
  await page.getByRole('button', { name: 'Mark as final' }).click();
  const dialog = page.getByRole('dialog', { name: 'Mark results as final' });
  await expect(dialog).toContainText('last finisher: 15:42:00');
  await expect(dialog).toContainText('Protest time limit');
  // Confirm stays disabled until every assertion is ticked.
  const confirmButton = dialog.getByRole('button', { name: 'Mark as final' });
  await expect(confirmButton).toBeDisabled();
  for (const checkbox of await dialog.getByRole('checkbox').all()) {
    await checkbox.check();
  }
  await confirmButton.click();
  await expect(dialog).not.toBeVisible();

  // ── 5. Final: badge, banner, chip; the series is read-only ───────────────
  await expect(page.getByTestId('final-badge')).toBeVisible();
  await expect(page.getByTestId('final-banner')).toContainText('These results are final');
  await expect(page.getByTestId('results-status-chip')).toHaveText('Final results');
  await expect(page.getByRole('button', { name: 'Mark as final' })).toHaveCount(0);
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page.getByTestId('final-banner')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add race' })).toHaveCount(0);
  await page.getByRole('navigation').getByRole('link', { name: 'Competitors' }).click();
  await expect(page.getByRole('button', { name: 'Add competitor' })).toHaveCount(0);

  // ── 6. Reopen as provisional; editing comes back ─────────────────────────
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Reopen as provisional' }).click();
  await expect(page.getByTestId('final-banner')).toHaveCount(0);
  await expect(page.getByTestId('final-badge')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add competitor' })).toBeVisible();
});
