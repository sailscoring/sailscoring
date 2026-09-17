import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick, setScoringMode, settleFinish } from './helpers';

/**
 * Times on a scratch fleet's published race table (issue #601).
 *
 * A keelboat class racing at Howth enters the same boats twice: once in a
 * handicap fleet and once on the order alone. One finish sheet serves both,
 * so the scratch fleet has the crossing times all along — it just never
 * published them. Now it does, with the elapsed time worked out from the gun
 * the two fleets share.
 */
test('a scratch fleet publishes the times recorded on the sheet', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Squib League 2026', venue: 'HYC' });

  // ── Two fleets over one class: PY for the handicap, order alone for the other
  await createFleets(page, ['Squib HPH', 'Squib Scratch']);
  await setScoringMode(page, 'handicap');
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByTestId('fleet-row').filter({ hasText: 'Squib HPH' })
    .getByRole('combobox').click();
  await page.getByRole('option', { name: 'PY' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── Every boat in both fleets ─────────────────────────────────────────────
  const boats = [
    { sail: 'IRL12', name: 'Alice', py: '1050' },
    { sail: 'IRL34', name: 'Bob', py: '1050' },
    { sail: 'IRL56', name: 'Cara', py: '1050' },
  ];
  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const b of boats) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number *').fill(b.sail);
    await page.getByLabel('Competitor name').fill(b.name);
    await page.getByRole('checkbox', { name: 'Squib HPH' }).check();
    await page.getByRole('checkbox', { name: 'Squib Scratch' }).check();
    await page.getByLabel('PY number', { exact: true }).fill(b.py);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: b.sail })).toBeVisible();
  }

  // ── One race, one gun, both fleets on it ──────────────────────────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  const startDialog = page.getByRole('dialog');
  await startDialog.getByPlaceholder('14:05', { exact: true }).fill('14:00:00');
  await startDialog.getByRole('checkbox', { name: 'Squib HPH' }).check();
  await startDialog.getByRole('checkbox', { name: 'Squib Scratch' }).check();
  await startDialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('14:00:00')).toBeVisible();

  // ── The sheet, times of day off the ship's clock ──────────────────────────
  const times = [
    { sail: 'IRL12', at: '14:45:20', elapsed: '45:20' },
    { sail: 'IRL34', at: '14:46:20', elapsed: '46:20' },
    { sail: 'IRL56', at: '14:50:00', elapsed: '50:00' },
  ];
  // A timed start asks for the crossing before it takes the boat.
  const timePrompt = page.getByRole('textbox', { name: 'Finish time', exact: true });
  for (const t of times) {
    await page.getByLabel('Sail number').fill(t.sail);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(timePrompt).toBeVisible();
    await timePrompt.fill(t.at);
    await settleFinish(page, () => page.getByRole('button', { name: 'Add', exact: true }).click());
  }
  for (const t of times) {
    await expect(page.getByTestId(`finish-time-${t.sail}`)).toHaveValue(t.at);
  }

  // ── Publish, and read the scratch fleet's own page ────────────────────────
  await page.getByRole('link', { name: 'Standings' }).click();
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const scratchLink = dialog.getByRole('link', { name: /\/p\/.*squib-scratch/ });
  await expect(scratchLink).toBeVisible();
  await page.goto(new URL((await scratchLink.getAttribute('href')) ?? '').pathname);

  // The scratch table is scored on the order, so it carries no rating or
  // corrected-time columns — but it now says when each boat crossed and how
  // long she took.
  const race = page.locator('table.racetable').first();
  await expect(race).toBeVisible();
  await expect(race.locator('th', { hasText: 'Finish time' })).toBeVisible();
  await expect(race.locator('th', { hasText: 'Elapsed' })).toBeVisible();
  await expect(race.locator('th', { hasText: 'CT' })).toHaveCount(0);
  for (const t of times) {
    const row = race.locator('tr', { hasText: t.sail });
    await expect(row).toContainText(t.at);
    await expect(row).toContainText(t.elapsed);
  }
});
