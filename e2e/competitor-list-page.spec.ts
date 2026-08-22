import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, enableFeatures } from './helpers';

/**
 * The published competitor list (#423). The point of the page is the window it
 * covers: before race one, when there are no standings to publish but the
 * entry list is exactly what competitors are looking for. So the test runs a
 * series with competitors and no races at all, and checks the page reaches the
 * public URL carrying the roster and none of the results furniture.
 */

const entries = [
  { sailNumber: 'IRL 215', name: 'Mark McLoughlin', tally: 'T0001' },
  { sailNumber: 'GBR 41', name: 'Hannah Mills', tally: 'T0002' },
];

test('the competitor list publishes before any race is sailed', async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['entry-list']);

  await createSeriesQuick(page, { name: 'ILCA 7 Worlds 2026', venue: 'Dun Laoghaire' });

  // ── 1. Enable the tally field, so the list carries more than the basics ──
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page
    .getByRole('heading', { name: 'Competitor fields' })
    .locator('..')
    .getByRole('button', { name: 'Edit ▸' })
    .click();
  await page.getByRole('checkbox', { name: 'Tally number' }).check();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 2. A roster, and deliberately no races ───────────────────────────────
  await page.getByRole('link', { name: 'Competitors' }).click();
  await expect(page.getByRole('button', { name: 'Add competitor' })).toBeVisible();
  for (const c of entries) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByLabel('Tally number').fill(c.tally);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sailNumber })).toBeVisible();
  }

  // ── 3. Standings has nothing to show, but says the list can go up ────────
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByText('The competitor list can be published now.')).toBeVisible();

  // ── 4. Publish it ────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('URL for Entries')).toHaveValue('entries');
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();

  // The only live page is the entry list, so it gets exactly one row: the
  // dialog's lone-results-page line is left out when there are no results.
  const link = dialog.getByRole('link', { name: /\/entries$/ });
  await expect(link).toHaveCount(1);
  await expect(link).toBeVisible();
  const entriesPath = new URL((await link.getAttribute('href')) ?? '').pathname;

  // ── 5. The public page: the roster, and nothing derived from racing ──────
  await page.goto(entriesPath);
  await expect(page.getByRole('columnheader', { name: 'Sail Number' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Tally' })).toBeVisible();
  await expect(page.getByText('Entries: 2')).toBeVisible();
  for (const c of entries) {
    await expect(page.getByRole('cell', { name: c.sailNumber })).toBeVisible();
    await expect(page.getByRole('cell', { name: c.tally })).toBeVisible();
  }
  await expect(page.getByRole('columnheader', { name: 'Rank' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Total' })).toHaveCount(0);

  // ── 6. And it is listed on the event index ───────────────────────────────
  await page.goto(entriesPath.replace(/\/entries$/, ''));
  await expect(page.getByRole('link', { name: 'Entries' })).toBeVisible();
});
