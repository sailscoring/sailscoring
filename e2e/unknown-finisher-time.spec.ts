import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick, setScoringMode } from './helpers';

/**
 * An unknown boat on a sheet that records times: the time step is offered,
 * the time optional, since whether she needed one waits on resolving her. A
 * timed unknown takes her place by time; resolving keeps the time.
 */

/** A frostbite race: ILCA scored on position, PY on time, each with a start. */
async function seedFrostbiteRace(page: import('@playwright/test').Page): Promise<void> {
  await createSeriesQuick(page, { name: 'Frostbite Unknowns' });
  await createFleets(page, ['ILCA', 'PY']);
  await setScoringMode(page, 'handicap');
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  const pyRow = page.getByText('PY', { exact: true }).locator('..');
  await pyRow.getByRole('combobox').click();
  await page.getByRole('option', { name: 'PY' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const c of [
    { sailNumber: 'L1', name: 'Laser Alice', fleet: 'ILCA' },
    { sailNumber: 'P1', name: 'PY Carol', fleet: 'PY' },
    { sailNumber: 'P2', name: 'PY Dave', fleet: 'PY' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('checkbox', { name: c.fleet }).check();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sailNumber })).toBeVisible();
  }
  for (const { sail, py } of [{ sail: 'P1', py: '1000' }, { sail: 'P2', py: '1100' }]) {
    await page.getByRole('row').filter({ hasText: sail }).click();
    await page.getByLabel('PY number', { exact: true }).fill(py);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: sail })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  for (const { gun, fleet } of [{ gun: '14:05:00', fleet: 'ILCA' }, { gun: '14:10:00', fleet: 'PY' }]) {
    await page.getByRole('button', { name: 'Add start' }).click();
    await page.getByLabel('Gun time').fill(gun);
    await page.getByRole('checkbox', { name: fleet }).check();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(gun)).toBeVisible();
  }
}

async function recordUnknown(page: import('@playwright/test').Page, sail: string, time: string) {
  await page.getByLabel('Sail number').fill(sail);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Record as unknown' }).click();
  await expect(page.getByText('Unknown boat — time optional')).toBeVisible();
  const timeBox = page.getByRole('textbox', { name: 'Finish time', exact: true });
  if (time) await timeBox.fill(time);
  await timeBox.press('Enter');
  await expect(page.locator('li', { hasText: sail })).toContainText('Unknown — not registered');
}

test('an unknown boat takes an optional time, slots by it, and keeps it when resolved', async ({ page }) => {
  await seedFrostbiteRace(page);

  await page.getByLabel('Sail number').fill('P1');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('textbox', { name: 'Finish time', exact: true }).fill('14:20:00');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  // A PY boat the sheet doesn't know crossed before P1: her time puts her
  // above P1. An unknown with no time — an ILCA, by position — goes in at
  // the end, as she was entered.
  await recordUnknown(page, '9001', '14:15:00');
  await recordUnknown(page, '9002', '');

  const row = (n: number) => page.getByRole('listitem').nth(n);
  await expect(row(0)).toContainText('9001');
  await expect(row(1)).toContainText('P1');
  await expect(row(2)).toContainText('9002');
  await expect(page.getByTestId('finish-time-unknown-9001')).toHaveValue('14:15:00');
  await expect(page.getByTestId('finish-time-unknown-9002')).toHaveValue('');
  // Placed by its time, so not dragged; the untimed one still can be.
  await expect(page.getByTestId('drag-handle-9001')).toHaveCount(0);
  await expect(page.getByTestId('drag-handle-9002')).toBeVisible();

  // A time typed onto the untimed unknown later is optional too, and places
  // her; clearing it again takes it off.
  const late = page.getByTestId('finish-time-unknown-9002');
  await late.fill('14:18:00');
  await late.press('Enter');
  await expect(row(1)).toContainText('9002');
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await late.fill('');
  await late.press('Enter');
  await expect(page.getByTestId('drag-handle-9002')).toBeVisible();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // Resolving 9001 to a PY boat keeps her time.
  await page.locator('li', { hasText: '9001' }).getByRole('button', { name: 'Resolve' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /P2/ }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(row(0)).toContainText('P2');
  await expect(page.getByTestId('finish-time-P2')).toHaveValue('14:15:00');

  // Resolving 9002 to the ILCA boat keeps her place in the order.
  await page.locator('li', { hasText: '9002' }).getByRole('button', { name: 'Resolve' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /L1/ }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('Unknown — not registered')).toHaveCount(0);
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // The time typed on 9002 and cleared again moved her up, and clearing it
  // left her where it put her.
  await page.reload();
  await expect(row(0)).toContainText('P2');
  await expect(page.getByTestId('finish-time-P2')).toHaveValue('14:15:00');
  await expect(row(1)).toContainText('L1');
  await expect(row(2)).toContainText('P1');
});

test('an unknown boat on a position-only sheet goes straight in', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Position Only Unknowns' });
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();

  await page.getByLabel('Sail number').fill('9999');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Record as unknown' }).click();
  await expect(page.getByText('Unknown — not registered')).toBeVisible();
  await expect(page.getByText('Unknown boat — time optional')).toHaveCount(0);
  await expect(page.getByTestId('finish-time-unknown-9999')).toHaveCount(0);
});
