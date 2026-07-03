import { signedInTest as test, expect } from './fixtures';
import { type Page } from '@playwright/test';
import { createFleets, createSeriesQuick, enableFeatures } from './helpers';

/**
 * E2E for combined published pages (#255, gated `combined-pages`): define a
 * publishing group on the Settings tab, publish it from the Publish dialog,
 * and read the combined public page. Covers the two headline layouts —
 * an all-fleets standings-only "Overall" page alongside the fleet pages,
 * and a full-detail page that replaces its members' standalone pages
 * (retracting the previously-published ones).
 */

/** New two-fleet (scratch) series — fleets "IRC" and "Cruiser", one boat each
 *  finishing one race. Leaves the page on the Standings tab. */
async function createTwoFleetSeries(page: Page, name: string): Promise<void> {
  await createSeriesQuick(page, { name });
  await createFleets(page, ['IRC', 'Cruiser']);

  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const c of [
    { sail: '11', name: 'Alice', fleet: 'IRC' },
    { sail: '22', name: 'Bob', fleet: 'Cruiser' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sail);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('checkbox', { name: c.fleet }).check();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sail })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();
  for (const sail of ['11', '22']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByRole('heading', { name: 'IRC' })).toBeVisible();
}

test('Overall page: all fleets, standings only, alongside the fleet pages', async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['combined-pages']);
  await createTwoFleetSeries(page, 'Overall League 2026');

  // Define the combined page: the Add default is exactly the Overall layout
  // (all fleets · standings only · members still published individually).
  await page.getByRole('link', { name: 'Settings' }).click();
  const card = page.getByTestId('combined-pages-card');
  await card.getByRole('button', { name: 'Edit ▸' }).click();
  await card.getByRole('button', { name: '+ Add combined page' }).click();
  const row = card.getByTestId('combined-page-row');
  await expect(row.getByLabel('Combined page name')).toHaveValue('Overall');
  await card.getByRole('button', { name: 'Done' }).click();
  await expect(card.getByText('Overall (all fleets)')).toBeVisible();

  // The Publish dialog reflects it: a combined-page row above the fleets.
  await page.getByRole('link', { name: 'Standings' }).click();
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await expect(dialog.getByText('all fleets · standings only')).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'Publish Overall' })).toBeChecked();
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();

  // Three live pages: the combined page first, then the fleets.
  const overallLink = dialog.getByRole('link', { name: /\/overall$/ });
  await expect(overallLink).toBeVisible();
  await expect(dialog.getByRole('link', { name: /\/irc$/ })).toBeVisible();
  await expect(dialog.getByRole('link', { name: /\/cruiser$/ })).toBeVisible();
  const overallPath = new URL((await overallLink.getAttribute('href')) ?? '').pathname;

  // The public combined page: both fleets' standings sections, no race tables.
  await page.goto(overallPath);
  await expect(page.getByRole('heading', { name: 'Overall', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'IRC', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cruiser', exact: true })).toBeVisible();
  await expect(page.locator('table.summarytable')).toHaveCount(2);
  await expect(page.locator('table.racetable')).toHaveCount(0);
  // Standings-only race headers are plain text, not links to detail tables.
  await expect(page.locator('a.racelink')).toHaveCount(0);
});

test('replace-members page: full detail, standalone fleet pages retracted', async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['combined-pages']);
  await createTwoFleetSeries(page, 'Puppeteer League 2026');
  const seriesUrl = page.url();

  // First publish with no groups: two standalone fleet pages go live.
  await page.getByRole('button', { name: 'Publish' }).click();
  let dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const ircLink = dialog.getByRole('link', { name: /\/irc$/ });
  await expect(ircLink).toBeVisible();
  const ircPath = new URL((await ircLink.getAttribute('href')) ?? '').pathname;
  const cruiserLink = dialog.getByRole('link', { name: /\/cruiser$/ });
  const cruiserPath = new URL((await cruiserLink.getAttribute('href')) ?? '').pathname;
  await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();

  // Define a full-detail combined page that replaces both fleets' pages.
  await page.getByRole('link', { name: 'Settings' }).click();
  const card = page.getByTestId('combined-pages-card');
  await card.getByRole('button', { name: 'Edit ▸' }).click();
  await card.getByRole('button', { name: '+ Add combined page' }).click();
  const row = card.getByTestId('combined-page-row');
  await row.getByLabel('Combined page name').fill('Both Fleets');
  await row.getByLabel('Combined page name').press('Enter');
  // These controls auto-save: each click round-trips through the series
  // PATCH before the checked state lands, so click + poll rather than
  // check()/uncheck() (which assert an immediate flip).
  await row.getByRole('button', { name: 'Choose fleets' }).click();
  await row.getByRole('checkbox', { name: 'IRC' }).click();
  await expect(row.getByRole('checkbox', { name: 'IRC' })).toBeChecked();
  await row.getByRole('checkbox', { name: 'Cruiser' }).click();
  await expect(row.getByRole('checkbox', { name: 'Cruiser' })).toBeChecked();
  await row.getByRole('radio', { name: 'Full per-race detail' }).click();
  await expect(row.getByRole('radio', { name: 'Full per-race detail' })).toBeChecked();
  // The single series-level toggle: publish only the combined pages.
  await card.getByRole('checkbox', { name: 'Publish individual per-fleet pages' }).click();
  await expect(
    card.getByRole('checkbox', { name: 'Publish individual per-fleet pages' }),
  ).not.toBeChecked();
  await card.getByRole('button', { name: 'Done' }).click();
  await expect(card.getByText('Both Fleets (IRC + Cruiser)')).toBeVisible();

  // The dialog shows where each fleet went; the fleets are no longer
  // selectable rows. A newly-defined group is unticked on re-publish
  // (nothing publishes silently) — server-side, the old fleet pages only
  // come down once the combined page is live.
  await page.goto(seriesUrl);
  await page.getByRole('button', { name: 'Publish' }).click();
  dialog = page.getByRole('dialog', { name: 'Publish results' });
  await expect(dialog.getByTestId('suppressed-fleet-IRC')).toContainText('→ in Both Fleets');
  await expect(dialog.getByTestId('suppressed-fleet-Cruiser')).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'Publish Both Fleets' }).check();
  await dialog.getByRole('button', { name: 'Re-publish', exact: true }).click();

  const bothLink = dialog.getByRole('link', { name: /\/both-fleets$/ });
  await expect(bothLink).toBeVisible();
  const bothPath = new URL((await bothLink.getAttribute('href')) ?? '').pathname;

  // The standalone fleet pages are retracted.
  expect((await page.request.get(ircPath)).status()).toBe(404);
  expect((await page.request.get(cruiserPath)).status()).toBe(404);

  // The combined page carries both fleets in full detail: summary tables and
  // race tables per section, with per-section race anchors.
  await page.goto(bothPath);
  await expect(page.getByRole('heading', { name: 'Both Fleets' })).toBeVisible();
  await expect(page.locator('table.summarytable')).toHaveCount(2);
  await expect(page.locator('table.racetable')).toHaveCount(2);
  await expect(page.locator('#irc-r1')).toBeVisible();
  await expect(page.locator('#cruiser-r1')).toBeVisible();
});

test('block series: each sub-series gets its own combined page', async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['combined-pages', 'sub-series']);
  await createSeriesQuick(page, { name: 'Block League 2026' });
  await createFleets(page, ['IRC', 'Cruiser']);

  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const c of [
    { sail: '11', name: 'Alice', fleet: 'IRC' },
    { sail: '22', name: 'Bob', fleet: 'Cruiser' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sail);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('checkbox', { name: c.fleet }).check();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sail })).toBeVisible();
  }

  // Two races, one sub-series each.
  await page.getByRole('link', { name: 'Races' }).click();
  for (let n = 1; n <= 2; n++) {
    await page.getByRole('button', { name: 'Add race' }).click();
    await expect(page.getByText(`Race ${n}`)).toBeVisible();
  }
  const newSubSeries = async (name: string, raceNumber: number) => {
    await page.getByRole('button', { name: 'New sub-series' }).click();
    const subDialog = page.getByRole('dialog', { name: 'New sub-series' });
    await subDialog.getByLabel('Name', { exact: true }).fill(name);
    await subDialog.getByRole('checkbox', { name: new RegExp(`Race ${raceNumber}\\b`) }).check();
    await subDialog.getByRole('button', { name: 'Create sub-series' }).click();
    await expect(subDialog).toBeHidden();
  };
  await newSubSeries('Winter', 1);
  await newSubSeries('Spring', 2);
  const enterRace = async (raceLabel: string) => {
    await page.getByText(raceLabel, { exact: false }).first().click();
    await expect(page.getByText(`${raceLabel} — results`)).toBeVisible();
    for (const sail of ['11', '22']) {
      await page.getByLabel('Sail number').fill(sail);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
    }
    await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
    await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
    await expect(page).toHaveURL(/\/races$/);
  };
  await enterRace('Race 1');
  await enterRace('Race 2');

  // Define an Overall combined page (the Add default).
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const card = page.getByTestId('combined-pages-card');
  await card.getByRole('button', { name: 'Edit ▸' }).click();
  await card.getByRole('button', { name: '+ Add combined page' }).click();
  const row = card.getByTestId('combined-page-row');
  await expect(row.getByLabel('Combined page name')).toHaveValue('Overall');
  await card.getByRole('button', { name: 'Done' }).click();

  // Publish: the group row reads like a fleet row on a block series —
  // one page per sub-series, no per-page URL editor.
  await page.getByRole('link', { name: 'Standings' }).click();
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await expect(dialog.getByRole('checkbox', { name: 'Publish Overall' })).toBeChecked();
  await expect(dialog.getByText('one page per sub-series').first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();

  // Each block serves its own combined page at {block}/overall.
  const indexLink = dialog.getByRole('link', { name: /\/p\// }).first();
  await expect(indexLink).toBeVisible();
  const base = new URL((await indexLink.getAttribute('href')) ?? '').pathname;
  for (const block of ['winter', 'spring']) {
    await page.goto(`${base}/${block}/overall`);
    await expect(page.getByRole('heading', { name: 'Overall', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'IRC', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Cruiser', exact: true })).toBeVisible();
    await expect(page.locator('table.summarytable')).toHaveCount(2);
  }
});
