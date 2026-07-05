import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * E2E for partial sail-number entry (issue #263).
 *
 * Enter adds a boat as soon as the typed text can only mean one boat — a full
 * sail or an unambiguous prefix — while an exact match still wins over a longer
 * boat it is a prefix of. Because a short number can be both a valid unknown
 * and a prefix of a registered boat, "record as unknown" is decoupled from the
 * not-found fallback: a dropdown row and Shift+Enter file it directly.
 */

async function addCompetitors(
  page: import('@playwright/test').Page,
  boats: { sailNumber: string; name: string }[],
) {
  for (const b of boats) {
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
}

test('Enter accepts a unique partial and respects exact-match precedence', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Partial Sail 2026', venue: 'HYC' });
  await addCompetitors(page, [
    { sailNumber: '7', name: 'Carol' },
    { sailNumber: '72', name: 'Dave' },
    { sailNumber: '218456', name: 'Alice' },
    { sailNumber: '219789', name: 'Bob' },
  ]);

  const input = page.getByLabel('Sail number');

  // Ambiguous prefix: "21" matches both 218456 and 219789. Enter commits
  // nothing — both stay in the non-finishers panel.
  await input.fill('21');
  await input.press('Enter');
  await expect(page.getByTestId('non-finisher-218456')).toBeVisible();
  await expect(page.getByTestId('non-finisher-219789')).toBeVisible();

  // Unique prefix: "218" can only be 218456 — Enter adds it.
  await input.fill('218');
  await input.press('Enter');
  await expect(page.getByTestId('non-finisher-218456')).toHaveCount(0);
  await expect(page.getByTestId('non-finisher-219789')).toBeVisible();

  // Exact match wins over the longer boat it prefixes: "7" adds 7, not 72.
  await input.fill('7');
  await input.press('Enter');
  await expect(page.getByTestId('non-finisher-7')).toHaveCount(0);
  await expect(page.getByTestId('non-finisher-72')).toBeVisible();

  await input.fill('72');
  await input.press('Enter');
  await expect(page.getByTestId('non-finisher-72')).toHaveCount(0);
});

test('a short number that prefixes a registered boat can still be recorded as unknown', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Unknown Collision 2026', venue: 'HYC' });
  await addCompetitors(page, [{ sailNumber: '12345', name: 'Erin' }]);

  const input = page.getByLabel('Sail number');
  const unknownRow = page.getByRole('listitem').filter({ hasText: 'Unknown — not registered' });

  // Typing "12" offers both the registered boat and the record-as-unknown row.
  await input.fill('12');
  await expect(page.getByRole('option', { name: '12345' })).toBeVisible();
  await expect(page.getByTestId('record-unknown-option')).toBeVisible();

  // Shift+Enter files it as unknown rather than completing to 12345.
  await input.press('Shift+Enter');
  await expect(unknownRow).toBeVisible();
  await expect(page.getByTestId('non-finisher-12345')).toBeVisible();

  // Plain Enter on the same prefix completes to the registered boat.
  await input.fill('12');
  await input.press('Enter');
  await expect(page.getByTestId('non-finisher-12345')).toHaveCount(0);
  // The earlier unknown entry is untouched.
  await expect(unknownRow).toBeVisible();
});
