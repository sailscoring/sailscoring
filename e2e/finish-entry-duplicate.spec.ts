import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * E2E for duplicate entry on the finish sheet.
 *
 * The paper sheet from the finish boat sometimes records the same boat at two
 * positions, and the scorer discovers that mid-transcription. The app must
 * answer with the existing entry, never with silence: the suggestions dropdown
 * keeps already-finished boats visible as muted "already entered" rows, and
 * Enter on a duplicate shows a notice naming the boat's position instead of
 * adding it again.
 */

test('typing an already-entered number answers with the existing row', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Duplicate Entry 2026', venue: 'HYC' });
  for (const b of [
    { sailNumber: '2411', name: 'Alice' },
    { sailNumber: '2412', name: 'Bob' },
    { sailNumber: '2500', name: 'Carol' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(b.sailNumber);
    await page.getByLabel('Competitor name').fill(b.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: b.sailNumber })).toBeVisible();
  }
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  const input = page.getByLabel('Sail number');
  const orderRows = page.locator('[data-entry-key]');

  await input.fill('2411');
  await input.press('Enter');
  await expect(page.getByTestId('non-finisher-2411')).toHaveCount(0);
  await expect(orderRows).toHaveCount(1);

  // A prefix shared with the finished boat lists both: 2412 as a committable
  // suggestion, 2411 as a muted already-entered row tagged with its position.
  await input.fill('241');
  await expect(page.getByRole('option', { name: '2412' })).toBeVisible();
  const alreadyRow = page.getByTestId('already-entered-2411');
  await expect(alreadyRow).toContainText('already entered — 1st');

  // Activating the already-entered row reveals the existing entry; it never
  // commits a second finish.
  await alreadyRow.click();
  await expect(orderRows).toHaveCount(1);

  // Enter on the full duplicate number refuses the entry and says where the
  // boat already is.
  await input.fill('2411');
  await input.press('Enter');
  await expect(page.getByTestId('already-entered-notice')).toHaveText(
    '2411 is already entered — 1st.',
  );
  await expect(orderRows).toHaveCount(1);

  // The notice is tied to the attempt: it clears on the next keystroke, and
  // entry continues normally.
  await input.fill('2500');
  await expect(page.getByTestId('already-entered-notice')).toHaveCount(0);
  await input.press('Enter');
  await expect(orderRows).toHaveCount(2);
});
