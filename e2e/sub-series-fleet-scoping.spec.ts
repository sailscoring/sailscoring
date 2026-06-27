import { signedInTest as test, expect } from './fixtures';
import { addCompetitor, createFleets, createSeriesQuick, enableFeatures } from './helpers';

/**
 * Sub-series fleet-scoping + per-fleet exclusion (#203 / #235): a sub-series
 * scoped to one fleet of a two-fleet series, with one race struck for that
 * fleet. The block scores only its fleet, the struck race scores 0 for it, and
 * the published page carries only the scoped fleet.
 *
 * Two fleets — Cruisers (1, 2) and Whitesails (11, 12) — race twice together.
 * "Cruiser Champ" is scoped to Cruisers over both races, with Race 2 excluded
 * for Cruisers. So a Cruiser keeps only its Race 1 score; Whitesails never
 * appears in the block.
 */

test('sub-series: fleet scoping + per-fleet race exclusion', async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['sub-series']);

  await createSeriesQuick(page, { name: 'Club League 2026', venue: 'HYC' });
  await createFleets(page, ['Cruisers', 'Whitesails']);

  await page.getByRole('link', { name: 'Competitors' }).click();
  await addCompetitor(page, { sailNumber: '1', name: 'Cara Cruiser', fleet: 'Cruisers' });
  await addCompetitor(page, { sailNumber: '2', name: 'Colm Cruiser', fleet: 'Cruisers' });
  await addCompetitor(page, { sailNumber: '11', name: 'Wendy White', fleet: 'Whitesails' });
  await addCompetitor(page, { sailNumber: '12', name: 'Will White', fleet: 'Whitesails' });

  await page.getByRole('link', { name: 'Races' }).click();
  for (let n = 1; n <= 2; n++) {
    await page.getByRole('button', { name: 'Add race' }).click();
    await expect(page.getByText(`Race ${n}`)).toBeVisible();
  }

  // ── Create the fleet-scoped, race-excluding sub-series ───────────────────
  await page.getByRole('button', { name: 'New sub-series' }).click();
  const dialog = page.getByRole('dialog', { name: 'New sub-series' });
  await dialog.getByLabel('Name', { exact: true }).fill('Cruiser Champ');
  await dialog.getByRole('checkbox', { name: /Race 1\b/ }).check();
  await dialog.getByRole('checkbox', { name: /Race 2\b/ }).check();
  // Scope to Cruisers — drop Whitesails.
  await dialog.getByRole('checkbox', { name: 'Whitesails' }).uncheck();
  // Strike Race 2 for Cruisers: open the exclusions disclosure, then tick it.
  await dialog.getByText('Per-fleet race exclusions').click();
  const exclusions = dialog.locator('details', { hasText: 'Per-fleet race exclusions' });
  const race2Block = exclusions.getByText(/^Race 2/).locator('..');
  await race2Block.getByRole('checkbox', { name: 'Exclude Cruisers' }).check();
  await dialog.getByRole('button', { name: 'Create sub-series' }).click();
  await expect(dialog).toBeHidden();

  // ── Finishes: both fleets in both races, Cara then Colm leading Cruisers ──
  const enterRace = async (raceLabel: string, sails: string[]) => {
    await page.getByText(raceLabel, { exact: false }).first().click();
    await expect(page.getByText(`${raceLabel} — results`)).toBeVisible();
    for (const sail of sails) {
      await page.getByLabel('Sail number').fill(sail);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
    }
    await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
    await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
    await expect(page).toHaveURL(/\/races$/);
  };
  await enterRace('Race 1', ['1', '2', '11', '12']);
  await enterRace('Race 2', ['1', '2', '11', '12']);

  // ── Standings: only Cruisers, Race 2 struck (Cara keeps just her R1 win) ──
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);
  await expect(page.getByRole('tab', { name: 'Cruiser Champ' })).toBeVisible();

  const rows = page.getByRole('row');
  // Whitesails boats are not scored in this view.
  await expect(rows.filter({ hasText: 'Wendy White' })).toHaveCount(0);
  await expect(rows.filter({ hasText: 'Will White' })).toHaveCount(0);
  // Cara wins Race 1; Race 2 is excluded, so her net is 1 (not 2).
  const cara = rows.filter({ hasText: 'Cara Cruiser' });
  await expect(cara.getByRole('cell').last()).toContainText('1');

  // ── Publish: the block page carries only the scoped fleet ─────────────────
  await page.getByRole('button', { name: 'Publish' }).click();
  const pub = page.getByRole('dialog', { name: 'Publish results' });
  await expect(pub).toBeVisible();
  await pub.getByRole('button', { name: 'Publish', exact: true }).click();
  const link = pub.getByRole('link', { name: /\/p\// });
  await expect(link).toBeVisible();
  const indexPath = new URL((await link.getAttribute('href')) ?? '').pathname;

  // Multi-fleet series, so the page leaf is the fleet name, not "standings".
  await page.goto(`${indexPath}/cruiser-champ/cruisers`);
  await expect(page.getByText('Club League 2026 — Cruiser Champ').first()).toBeVisible();
  await expect(page.getByText('Cara Cruiser').first()).toBeVisible();
  await expect(page.getByText('Wendy White')).toHaveCount(0);
});
