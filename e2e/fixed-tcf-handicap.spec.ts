import { signedInTest as test, expect } from './fixtures';
import {
  addCompetitor,
  createFleets,
  createSeriesQuick,
  downloadFleetHtml,
  setScoringMode,
  settleFinish,
} from './helpers';

/**
 * E2E for a club handicap fixed for the series (#550) — Howth's autumn-league
 * shape: the committee sets an HPH number per boat and it does not move.
 *
 * Three boats in a "Class 1 HPH" fixed-TCF fleet start at 11:25:00:
 *   1425 (HPH 1.020): finishes 12:52:30 → ET 5250 s → CT 5355 s → 3rd
 *   1410 (HPH 0.910): finishes 13:00:40 → ET 5740 s → CT 5223 s → 2nd
 *   1405 (HPH 0.865): finishes 13:05:00 → ET 6000 s → CT 5190 s → 1st
 *
 * The boat first over the line is last on handicap, and the rating column —
 * on the form, and on the published page — is headed HPH, not TCC.
 */

const BOATS = [
  { sailNumber: '1405', name: 'Kestrel', hph: '0.865', finishTime: '13:05:00' },
  { sailNumber: '1410', name: 'Marlin', hph: '0.910', finishTime: '13:00:40' },
  { sailNumber: '1425', name: 'Osprey', hph: '1.020', finishTime: '12:52:30' },
];

test('fixed-TCF fleet: scored on the club number, and published under its name', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Autumn League 2026' });

  // ── The fleet: Fixed TCF, called HPH ──────────────────────────────────────
  await createFleets(page, ['Class 1 HPH']);
  await setScoringMode(page, 'handicap');
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'Fixed TCF', exact: true }).click();
  const labelBox = page.getByPlaceholder('TCF');
  await expect(labelBox).toBeVisible();
  await labelBox.fill('HPH');
  await labelBox.blur();
  await page.getByRole('button', { name: 'Done' }).click();
  // The fleet summary line reads back what the club calls the handicap.
  await expect(page.getByText('Class 1 HPH (fixed HPH)')).toBeVisible();

  // ── The boats, rated by the club's own number ─────────────────────────────
  // The rating field only appears once a boat is in the fleet, which a
  // single-fleet series does on save — so the numbers go in on the edit.
  await page.getByRole('navigation').getByRole('link', { name: 'Competitors' }).click();
  for (const b of BOATS) {
    await addCompetitor(page, { sailNumber: b.sailNumber, name: b.name });
  }
  for (const b of BOATS) {
    await page.getByRole('row').filter({ hasText: b.sailNumber }).click();
    // Labelled by the club's word for the handicap, not "TCF".
    await expect(page.getByLabel('HPH', { exact: true })).toBeVisible();
    await page.getByLabel('HPH', { exact: true }).fill(b.hph);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: b.sailNumber })).toBeVisible();
  }

  // ── One race ──────────────────────────────────────────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 1')).toBeVisible();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05', { exact: true }).fill('11:25:00');
  // The fleet is named by the club's word for its handicap here too.
  await page.getByRole('checkbox', { name: 'Class 1 HPH (HPH)' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('11:25:00')).toBeVisible();

  for (const b of [...BOATS].reverse()) {
    await settleFinish(page, async () => {
      await page.getByLabel('Sail number').fill(b.sailNumber);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await page.getByRole('textbox', { name: 'Finish time', exact: true }).fill(b.finishTime);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
    });
  }

  // ── Corrected time decides, not the finishing order ───────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByRole('row').nth(1)).toContainText('1405');
  await expect(page.getByRole('row').nth(2)).toContainText('1410');
  // Osprey crossed first and is scored last.
  await expect(page.getByRole('row').nth(3)).toContainText('1425');

  // ── The published page heads the rating column with the club's word ───────
  const download = await downloadFleetHtml(page);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const html = Buffer.concat(chunks).toString();
  expect(html).toContain('<th>HPH</th>');
  expect(html).not.toContain('<th>TCC</th>');
  // And the number each boat was scored on is the one the committee set.
  expect(html).toContain('0.865');
});
