import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick, setScoringMode } from './helpers';

/**
 * E2E tests for IRC time-corrected handicap scoring (issue #61, Phase 1).
 *
 * Three boats in an IRC fleet start at 14:00:00.
 * Finish times and TCC ratings:
 *   IRC1 (TCC=1.000): finishes 14:30:00 → ET=1800s → CT=1800.0s  → 3rd
 *   IRC2 (TCC=1.050): finishes 14:28:00 → ET=1680s → CT=1764.0s  → 2nd
 *   IRC3 (TCC=1.100): finishes 14:25:00 → ET=1500s → CT=1650.0s  → 1st
 *
 * Standings after 1 race: IRC3=1pt, IRC2=2pt, IRC1=3pt.
 */

test('IRC fleet: standings ordered by corrected time', async ({ page }) => {
  // ── 1. Create series ──────────────────────────────────────────────────────
  await createSeriesQuick(page, { name: 'IRC Test 2025' });

  // ── 2. Create IRC fleet and set scoring system to IRC ─────────────────────
  await createFleets(page, ['IRC']);
  await setScoringMode(page, 'handicap');
  // Open Fleets card for editing
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'IRC' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 3. Add three competitors in IRC fleet ─────────────────────────────────
  await page.getByRole('link', { name: 'Competitors' }).click();

  const boats = [
    { sailNumber: 'IRC1', name: 'Slow Alice' },
    { sailNumber: 'IRC2', name: 'Medium Bob' },
    { sailNumber: 'IRC3', name: 'Fast Carol' },
  ];

  for (const c of boats) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sailNumber })).toBeVisible();
  }

  // ── 4. Edit competitors to add TCC ratings ────────────────────────────────

  const tccs: Record<string, string> = { IRC1: '1.000', IRC2: '1.050', IRC3: '1.100' };
  for (const c of boats) {
    const row = page.getByRole('row').filter({ hasText: c.sailNumber });
    await row.hover();
    await row.getByRole('button', { name: /Edit/ }).click();
    // With IRC fleet checked, TCC input is visible
    await expect(page.getByLabel('IRC TCC', { exact: true })).toBeVisible();
    await page.getByLabel('IRC TCC', { exact: true }).fill(tccs[c.sailNumber]);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sailNumber })).toBeVisible();
  }

  // ── 5. Add a race ─────────────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 1')).toBeVisible();

  // ── 6. Open race — add start time and finish times ────────────────────────
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  // Expand the race starts card, then add a start time: 14:00:00 for the IRC fleet
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05:00').fill('14:00:00');
  // Check the IRC fleet checkbox in the start dialog
  await page.getByRole('checkbox', { name: 'IRC' }).check();
  await page.getByRole('button', { name: 'Save' }).click();

  // Verify the start is recorded
  await expect(page.getByText('14:00:00')).toBeVisible();

  // For each boat: type sail number → Add → time-entry prompt → type time → Add
  for (const { sailNumber, finishTime } of [
    { sailNumber: 'IRC3', finishTime: '14:25:00' },
    { sailNumber: 'IRC2', finishTime: '14:28:00' },
    { sailNumber: 'IRC1', finishTime: '14:30:00' },
  ]) {
    await page.getByLabel('Sail number').fill(sailNumber);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    // Pending time-entry prompt appears; fill finish time and confirm
    await page.getByRole('textbox', { name: 'Finish time', exact: true }).fill(finishTime);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }

  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByTestId('back-to-races').click();
  await expect(page).toHaveURL(/\/races$/);

  // ── 7. Verify standings: IRC3 first, IRC1 last ────────────────────────────
  await page.getByRole('link', { name: 'Standings' }).click();

  // IRC label should appear somewhere on the standings page
  await expect(page.getByText(/IRC/)).toBeVisible();

  // IRC3 has lowest CT (1650s) → rank 1 → first data row
  await expect(page.getByRole('row').nth(1)).toContainText('IRC3');
  // IRC1 has highest CT (1800s) → rank 3 → third data row
  await expect(page.getByRole('row').nth(3)).toContainText('IRC1');
});

/**
 * File format version is current after adding IRC fleet and scoring system.
 */
test('series file version is current with IRC fleet scoring system', async ({ page }) => {
  // ── 1. Create a series with an IRC fleet ──────────────────────────────────
  await createSeriesQuick(page, { name: 'IRC Format Test' });

  // Create IRC fleet and set scoring system to IRC
  await createFleets(page, ['IRC']);
  await setScoringMode(page, 'handicap');
  // Open Fleets card for editing
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'IRC' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  // Add one competitor in the IRC fleet
  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('F1');
  await page.getByLabel('Competitor name').fill('Format Tester');
  await page.getByRole('button', { name: 'Save' }).click();

  // ── 2. Save to file and verify format version ─────────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save to File' }).click();
  const dl = await download;

  const stream = await dl.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const json = JSON.parse(Buffer.concat(chunks).toString());

  expect(json.formatVersion).toBe(6);

  const ircFleet = json.fleets?.find((f: { name: string }) => f.name === 'IRC');
  expect(ircFleet?.scoringSystem).toBe('irc');
});
