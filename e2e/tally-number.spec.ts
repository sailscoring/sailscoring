import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * E2E for the tally number — the safety token a competitor is issued at
 * registration and hands over when launching. The scorer's copy of it is a
 * roster detail, so the test covers the two things that make it useful: it
 * survives a round trip through the competitor form into its own column, and
 * the filter finds a boat from it, since a note from race management about a
 * tally offence names the tally and nothing else.
 */

test('tally numbers show in the competitor list and can be filtered on', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Tally Number Series' });

  // ── 1. Enable the field ──────────────────────────────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page
    .getByRole('heading', { name: 'Competitor fields' })
    .locator('..')
    .getByRole('button', { name: 'Edit ▸' })
    .click();
  await page.getByRole('checkbox', { name: 'Tally number' }).check();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 2. Two entries carrying tallies ──────────────────────────────────────
  await page.getByRole('link', { name: 'Competitors' }).click();
  // Anchor on a control the Competitors page owns before touching its
  // contents — the previous tab is still mounted for a moment after the click.
  await expect(page.getByRole('button', { name: 'Add competitor' })).toBeVisible();
  for (const c of [
    { sailNumber: 'IRL 215', name: 'Mark McLoughlin', tallyNumber: 'T0042' },
    { sailNumber: 'GBR 41', name: 'Hannah Mills', tallyNumber: 'T0007' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByLabel('Tally number').fill(c.tallyNumber);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sailNumber })).toBeVisible();
  }

  // ── 3. The number lands in its own column, verbatim ──────────────────────
  await expect(page.getByRole('columnheader', { name: 'Tally' })).toBeVisible();
  const row = (sail: string) => page.getByRole('row').filter({ hasText: sail });
  await expect(row('IRL 215').getByRole('cell', { name: 'T0042', exact: true })).toBeVisible();
  await expect(row('GBR 41').getByRole('cell', { name: 'T0007', exact: true })).toBeVisible();

  // ── 4. And the filter finds the boat from it ─────────────────────────────
  await page.getByRole('textbox', { name: /filter/i }).fill('T0042');
  await expect(page.getByRole('cell', { name: 'IRL 215' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'GBR 41' })).toHaveCount(0);
});
