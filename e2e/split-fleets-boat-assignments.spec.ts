import type { Page } from '@playwright/test';

import { signedInTest as test, expect } from './fixtures';
import { createSplitFleetSeries, enableFeatures, showSailingInstructions, showStageSettings } from './helpers';

/**
 * Supplied boats, drawn for each fleet: the Irish Sailing Champions' Cup
 * shape, where two qualifying fleets sail the same boats one after the other
 * and every stage redraws them. The boats are entered where fleets are
 * assigned, a race's finishes are entered by the boat the committee hails,
 * and a fleet's boats are changed afterwards from its chip on the round.
 */

const DEMO_COUNT = 24;

const configSaved = (page: Page) =>
  page.waitForResponse(
    (r) =>
      /\/api\/v1\/series\/[^/]+\/split-fleets$/.test(r.url()) &&
      r.request().method() === 'PUT' &&
      r.ok(),
  );

/** Paste lines into a box the way a clipboard paste arrives. */
async function paste(page: Page, selector: string, text: string) {
  await page.locator(selector).first().evaluate((el, value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

test('split fleets: boats drawn for each fleet', async ({ page, signedInEmail }) => {
  test.setTimeout(180_000);
  await enableFeatures(page, signedInEmail, ['split-fleets']);
  await createSplitFleetSeries(page, { name: 'Champions Cup Demo', fleetCount: 2 });

  // ── The setting, and the sentence it writes ──────────────────────────────
  await showStageSettings(page, 'Qualification series');
  await Promise.all([configSaved(page), page.locator('#sf-boats').selectOption('drawn')]);
  await expect(page.getByText('boats drawn per fleet')).toBeVisible();
  const si = await showSailingInstructions(page);
  await expect(si).toContainText('Boats will be supplied by the organising authority');

  await page.getByRole('button', { name: `Add ${DEMO_COUNT} demo competitors` }).click();
  await expect(page.getByRole('button', { name: `Add ${DEMO_COUNT} demo competitors` })).toBeHidden();

  // ── Round 1: boats entered in the assignment ─────────────────────────────
  await page.getByRole('button', { name: 'Assign Preliminary fleets' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('columnheader', { name: 'Boat' })).toBeVisible();
  await expect(dialog.getByRole('columnheader', { name: 'Entry' })).toBeVisible();

  // A pasted column fills the row it lands in and the rows below.
  await paste(page, '[data-boat-cell]', '901\n902\n903\n');
  const cells = dialog.locator('[data-boat-cell]');
  await expect(cells.nth(0)).toHaveValue('901');
  await expect(cells.nth(2)).toHaveValue('903');
  await expect(cells.nth(3)).toHaveValue('');

  // Each fleet sails boats 401 upwards: the same boats, one helm in each.
  const rows = dialog.locator('tbody tr');
  const helmByFleetBoat = new Map<string, string>();
  const next = new Map<string, number>();
  const count = await rows.count();
  expect(count).toBe(DEMO_COUNT);
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const fleet = await row.getByRole('combobox').inputValue();
    const n = (next.get(fleet) ?? 400) + 1;
    next.set(fleet, n);
    helmByFleetBoat.set(`${fleet} ${n}`, (await row.locator('td').nth(2).innerText()).trim());
    await row.locator('[data-boat-cell]').fill(String(n));
  }

  // One boat twice in a fleet holds the commit.
  const commit = dialog.getByRole('button', { name: /Commit Round 1/ });
  const firstRowFleet = await rows.nth(0).getByRole('combobox').inputValue();
  let clashRow = -1;
  for (let i = 1; i < count; i++) {
    if ((await rows.nth(i).getByRole('combobox').inputValue()) === firstRowFleet) {
      clashRow = i;
      break;
    }
  }
  const clashCell = rows.nth(clashRow).locator('[data-boat-cell]');
  const kept = await clashCell.inputValue();
  await clashCell.fill('401');
  await expect(dialog).toContainText(`Boat 401 in ${firstRowFleet} is drawn for more than one entry`);
  await expect(commit).toBeDisabled();
  await clashCell.fill(kept);
  await expect(commit).toBeEnabled();

  await dialog.getByRole('checkbox', { name: /Also create/ }).check();
  await commit.click();
  await expect(page.getByText('Round 1 · QP1 onward')).toBeVisible();
  await expect(page.getByText(/not yet drawn/)).toHaveCount(0);

  // ── Finishes entered by boat: each fleet's race finds its own helm ───────
  const q1Row = page.getByTestId('logical-race-qualifying-1');
  for (const fleet of ['Yellow', 'Blue']) {
    await q1Row.getByRole('link', { name: new RegExp(`${fleet} · enter finishes`) }).click();
    await expect(page).toHaveURL(/\/races\//);
    await page.getByLabel('Sail number').fill('401');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const last = page.getByTestId('last-recorded');
    await expect(last).toContainText('401');
    await expect(last).toContainText(helmByFleetBoat.get(`${fleet} 401`)!);
    await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
    await page.goBack();
  }

  // ── A fleet's boats, changed afterwards from its chip ────────────────────
  await page.getByRole('button', { name: 'Yellow boats' }).click();
  const list = page.getByRole('dialog');
  const helm402 = helmByFleetBoat.get('Yellow 402')!;
  const box = list.getByLabel(`Boat for ${helm402}`);
  await expect(box).toHaveValue('402');
  // A spare replaces 402, and one boat is cleared for a later draw.
  await box.fill('409');
  await expect(list).toContainText('Boat 409 in Yellow is drawn for more than one entry');
  await box.fill('413');
  await list.getByLabel(`Boat for ${helmByFleetBoat.get('Yellow 403')!}`).fill('');
  await list.getByRole('button', { name: 'Save boats' }).click();
  await expect(list).toBeHidden();
  await expect(page.getByText('1 boat not yet drawn')).toBeVisible();

  await page.getByRole('button', { name: 'Yellow boats' }).click();
  await expect(page.getByRole('dialog').getByLabel(`Boat for ${helm402}`)).toHaveValue('413');
});
