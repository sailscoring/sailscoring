import { signedInTest as test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { addCompetitor, createFleets, createSeriesQuick, downloadFleetHtml, setScoringMode } from './helpers';

/**
 * A fleet added to a series whose races already have their starts is in none
 * of them (#562). For a handicap fleet that means the races score on crossing
 * order under the fleet's rating system's name — a standings table that looks
 * exactly like a corrected one. Two halves: the Standings tab says so, and
 * adding the fleet offers to put it in the starts a fleet already racing has.
 *
 * Two boats whose crossing order and corrected order disagree, so which of
 * the two a fleet is showing is readable off the ranks alone:
 *   FAST crosses first, TCC 1.200 → CT 1800s × 1.200 = 2160s
 *   SLOW crosses second, TCC 0.800 → CT 2100s × 0.800 = 1680s
 * Crossing order FAST, SLOW; corrected order SLOW, FAST.
 */

const boats = [
  { sailNumber: 'FAST', name: 'First Across', ircTcc: '1.200', finishTime: '14:30:00' },
  { sailNumber: 'SLOW', name: 'Second Across', ircTcc: '0.800', finishTime: '14:35:00' },
];

/** The published HTML for one fleet, off the Preview dialog's download. */
async function fleetHtml(page: Page, fleetName: string): Promise<string> {
  const download = await downloadFleetHtml(page, fleetName);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString();
}

/** A one-race IRC series whose single race has a start covering "Class 1". */
async function seriesWithOneStartedRace(page: Page, name: string) {
  await createSeriesQuick(page, { name });
  await createFleets(page, ['Class 1']);
  await setScoringMode(page, 'handicap');
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'IRC' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const b of boats) {
    await addCompetitor(page, { sailNumber: b.sailNumber, name: b.name });
  }
  // The TCC field appears on the edit form, once the boat is in the IRC fleet.
  for (const b of boats) {
    await page.getByRole('row').filter({ hasText: b.sailNumber }).click();
    await expect(page.getByLabel('IRC TCC', { exact: true })).toBeVisible();
    await page.getByLabel('IRC TCC', { exact: true }).fill(b.ircTcc);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: b.sailNumber })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05', { exact: true }).fill('14:00:00');
  await page.getByRole('checkbox', { name: 'Class 1' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('14:00:00')).toBeVisible();

  for (const b of boats) {
    await page.getByLabel('Sail number').fill(b.sailNumber);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('textbox', { name: 'Finish time', exact: true }).fill(b.finishTime);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);
}

/** Add a fleet from the Settings → Fleets card, answering the join-starts
 *  offer either by naming the fleet it starts with or by declining. */
async function addFleet(page: Page, name: string, startsWith: string | null) {
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await expect(page.locator('h2', { hasText: 'Fleets' })).toBeVisible();
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('button', { name: '+ Add fleet' }).click();
  await page.getByPlaceholder('Fleet name').fill(name);
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  const offer = page.getByRole('dialog').filter({ hasText: 'start with' });
  await expect(offer).toBeVisible();
  if (startsWith === null) {
    await offer.getByRole('button', { name: 'Not now' }).click();
  } else {
    await page.getByTestId('companion-fleet-select').click();
    await page.getByRole('option', { name: new RegExp(`^${startsWith} `) }).click();
    await offer.getByRole('button', { name: 'Add to those starts' }).click();
  }
  await expect(offer).toBeHidden();
}

/** Put the new fleet on IRC and both boats in it, so it scores like Class 1
 *  does — the only difference left being whether it is in the race's start. */
async function scoreFleetOnIrc(page: Page, name: string) {
  const row = page.getByTestId('fleet-row').filter({ hasText: name });
  await row.getByRole('combobox').click();
  await page.getByRole('option', { name: 'IRC' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const b of boats) {
    await page.getByRole('row').filter({ hasText: b.sailNumber }).click();
    await page.getByRole('checkbox', { name }).check();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: b.sailNumber })).toBeVisible();
  }
}

test('a fleet left out of the race\'s start is flagged as scored on finishing order', async ({ page }) => {
  await seriesWithOneStartedRace(page, 'Left Out of the Start 2026');
  await addFleet(page, 'Shadow Fleet', null);
  await scoreFleetOnIrc(page, 'Shadow Fleet');

  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);
  const warning = page.getByTestId('fleet-not-in-start-warning');
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('Race 1');
  await expect(warning).toContainText('not IRC');

  // Class 1 is in the start and corrects (SLOW first); the shadow fleet is not
  // and ranks on crossing order (FAST first).
  const tables = page.getByRole('table');
  await expect(tables).toHaveCount(2);
  await expect(tables.first().getByRole('row').nth(1)).toContainText('SLOW');
  await expect(tables.last().getByRole('row').nth(1)).toContainText('FAST');

  // The page still breaks the race down (#563): a fleet scored on crossing
  // order publishes its race table, without the rating and corrected-time
  // columns it had nothing to put in them.
  const html = await fleetHtml(page, 'Shadow Fleet');
  expect(html).toContain('class="racetable"');
  expect(html).not.toContain('<th>CT</th>');
  const corrected = await fleetHtml(page, 'Class 1');
  expect(corrected).toContain('<th>CT</th>');
});

test('adding a fleet offers to put it in the starts a racing fleet already has', async ({ page }) => {
  await seriesWithOneStartedRace(page, 'Joins the Start 2026');
  await addFleet(page, 'Class 1 Echo', 'Class 1');
  await scoreFleetOnIrc(page, 'Class 1 Echo');

  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);
  await expect(page.getByTestId('fleet-not-in-start-warning')).toHaveCount(0);

  // Both fleets are in the 14:00 gun, so both correct: SLOW leads each table.
  const tables = page.getByRole('table');
  await expect(tables).toHaveCount(2);
  await expect(tables.first().getByRole('row').nth(1)).toContainText('SLOW');
  await expect(tables.last().getByRole('row').nth(1)).toContainText('SLOW');
});
