import { signedInTest as test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { addCompetitor, createFleets, createSeriesQuick, downloadFleetHtml, enableFeatures, setScoringMode } from './helpers';

/**
 * Time to win, rating to win and speed: three race-table columns a series
 * turns on in the Results columns dialog. With Speed on, the start dialog
 * offers the course length an IRC start otherwise has no use for.
 *
 * The gun is 10:00:00 and the course 12 NM. Alpha, TCC 1.000, finishes
 * 12:00:00; Bravo, TCC 0.950, finishes 12:03:00.
 *
 *   Bravo:  7,380 s × 0.950 = 7,011 s, so Bravo wins.
 *   Alpha:  7,200 s, 189 s behind; it needed 7,011 ÷ 1.000 s of elapsed time,
 *           so its time to win is 0:03:09 and its rating to win
 *           7,011 ÷ 7,200 = 0.974. 12 NM in two hours is 6.00 kn.
 */

const boats = [
  { sailNumber: 'IRL 1', name: 'Alpha', tcc: '1.000', finishTime: '12:00:00' },
  { sailNumber: 'IRL 2', name: 'Bravo', tcc: '0.950', finishTime: '12:03:00' },
];

async function fleetHtml(page: Page): Promise<string> {
  const download = await downloadFleetHtml(page);
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString();
}

test('a series publishes time to win, rating to win and speed', async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['custom-columns']);
  await createSeriesQuick(page, { name: 'Time To Win' });
  await createFleets(page, ['IRC 1']);
  await setScoringMode(page, 'handicap');
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'IRC' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── Turn the three columns on ─────────────────────────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByRole('heading', { name: 'Competitor fields' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Change results columns…' }).click();
  const dialog = page.getByTestId('results-columns-dialog');
  await dialog.getByRole('button', { name: 'Set this series’ columns' }).click();
  for (const name of ['Time to win', 'Rating to win', 'Speed (kn)']) {
    const box = dialog.getByRole('checkbox', { name: `Show ${name}` });
    await expect(box).not.toBeChecked();
    await box.click();
    await expect(box).toBeChecked();
  }
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('results-columns-line')).toContainText('Results columns: set for this series');

  await page.getByRole('navigation').getByRole('link', { name: 'Competitors' }).click();
  await expect(page).toHaveURL(/\/competitors$/);
  for (const b of boats) await addCompetitor(page, { sailNumber: b.sailNumber, name: b.name });
  for (const b of boats) {
    await page.getByRole('row').filter({ has: page.getByRole('cell', { name: b.name, exact: true }) }).click();
    await page.getByLabel('IRC TCC', { exact: true }).fill(b.tcc);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
  }

  // ── A start with its course length, and the finishes ──────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1', { exact: true }).click();
  await expect(page).toHaveURL(/\/races\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Race starts' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByLabel('Gun time').fill('10:00:00');
  await page.getByLabel(/Course length/).fill('12');
  await expect(page.getByText('Gives each boat’s speed over the course')).toBeVisible();
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

  // ── The published race table ─────────────────────────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);
  const html = await fleetHtml(page);
  const at = html.indexOf('id="r1"');
  expect(at).toBeGreaterThan(-1);
  const table = html.slice(at, html.indexOf('</table>', at));
  expect(table).toMatch(/>Delta<\/th>\s*<th[^>]*>Time to win<\/th>\s*<th[^>]*>Rating to win<\/th>\s*<th[^>]*>Speed \(kn\)<\/th>/);
  // Alpha: Delta, time to win, rating to win, speed.
  expect(table).toMatch(/0:03:09<\/td>\s*<td class="mono">0:03:09<\/td>\s*<td class="mono">0\.974<\/td>\s*<td class="mono">6\.00<\/td>/);
  // Bravo, the winner: no time to win, its own rating, 12 NM in 2:03:00.
  expect(table).toMatch(/0:00:00<\/td>\s*<td class="mono"><\/td>\s*<td class="mono">0\.950<\/td>\s*<td class="mono">5\.85<\/td>/);
});
