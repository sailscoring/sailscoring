import { signedInTest as test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { addCompetitor, createFleets, createSeriesQuick, downloadFleetHtml, enableFeatures, setScoringMode } from './helpers';

/**
 * A boat declared on its secondary IRC certificate for one race.
 *
 * Alpha holds a primary at TCC 1.000 and a secondary at 1.100; Bravo 1.000.
 * Both races start at 10:00:00; Alpha finishes 12:00:00, Bravo 12:03:00.
 *
 *   On the primary:   Alpha 7200 s × 1.000 = 2:00:00, Bravo 7380 s = 2:03:00.
 *   Race 2 declared on the secondary: Alpha 7200 × 1.100 = 7920 s = 2:12:00,
 *   so Bravo wins it. Race 1 is unchanged.
 */

const boats = [
  { sailNumber: 'IRL 1', name: 'Alpha', finishTime: '12:00:00' },
  { sailNumber: 'IRL 2', name: 'Bravo', finishTime: '12:03:00' },
];

/** The published HTML for the fleet, off the Preview dialog's download. */
async function fleetHtml(page: Page): Promise<string> {
  const download = await downloadFleetHtml(page);
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString();
}

/** One race's table on the published page. */
function raceTable(html: string, n: number): string {
  const at = html.indexOf(`id="r${n}"`);
  expect(at).toBeGreaterThan(-1);
  return html.slice(at, html.indexOf('</table>', at));
}

test('a boat declared on its secondary certificate for one race', async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['per-race-certificates']);
  await createSeriesQuick(page, { name: 'Secondary Certificate' });
  await createFleets(page, ['IRC 1']);
  await setScoringMode(page, 'handicap');
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'IRC' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('navigation').getByRole('link', { name: 'Competitors' }).click();
  await expect(page).toHaveURL(/\/competitors$/);
  for (const b of boats) await addCompetitor(page, { sailNumber: b.sailNumber, name: b.name });
  for (const b of boats) {
    await page.getByRole('row').filter({ has: page.getByRole('cell', { name: b.name, exact: true }) }).click();
    await page.getByLabel('IRC TCC', { exact: true }).fill('1.000');
    if (b.name === 'Alpha') await page.getByLabel('IRC secondary TCC').fill('1.100');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
  }

  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);
  for (let n = 1; n <= 2; n++) {
    await page.getByRole('button', { name: 'Add race' }).click();
    await expect(page.getByText(`Race ${n}`)).toBeVisible();
  }
  for (let n = 1; n <= 2; n++) {
    await page.getByText(`Race ${n}`, { exact: true }).click();
    await expect(page).toHaveURL(/\/races\/[^/]+$/);
    await expect(page.getByRole('heading', { name: 'Race starts' })).toBeVisible();
    await page.getByRole('button', { name: 'Edit ▸' }).click();
    await page.getByRole('button', { name: 'Add start' }).click();
    await page.getByLabel('Gun time').fill('10:00:00');
    await page.getByRole('checkbox', { name: 'IRC 1' }).check();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('10:00:00')).toBeVisible();
    for (const b of boats) {
      await page.getByLabel('Sail number').fill(b.sailNumber);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await page.getByRole('textbox', { name: 'Finish time', exact: true }).fill(b.finishTime);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
    }
    await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

    if (n === 2) {
      // ── Alpha declares its secondary for race 2 ───────────────────────────
      await page.getByRole('button', { name: 'Ratings', exact: true }).click();
      const choice = page.getByRole('group', { name: 'IRL 1 certificate' });
      await expect(choice.getByRole('button', { name: 'Primary 1.000' })).toHaveAttribute('aria-pressed', 'true');
      await choice.getByRole('button', { name: 'Secondary 1.100' }).click();
      await expect(choice.getByRole('button', { name: 'Secondary 1.100' })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTitle('Declared on the secondary certificate')).toBeVisible();
    }
    await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
    await expect(page).toHaveURL(/\/races$/);
  }

  // ── Bravo wins race 2, and with it the tie-break ───────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);
  const row = (sail: string) => page.getByRole('row').filter({ hasText: sail });
  await expect(row('IRL 2').getByRole('cell').first()).toHaveText('1');
  await expect(row('IRL 1').getByRole('cell').last()).toHaveText('3');

  // ── Race 2's corrected time is the secondary's; race 1's the primary's ────
  const html = await fleetHtml(page);
  expect(raceTable(html, 2)).toMatch(/1\.100<\/td>\s*<td class="mono">2:12:00/);
  expect(raceTable(html, 1)).toMatch(/1\.000<\/td>\s*<td class="mono">2:00:00/);
});
