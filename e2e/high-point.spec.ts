import type { Page } from '@playwright/test';
import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, enableFeatures } from './helpers';

/**
 * High-point scoring (#745): a series switched to high point scores boats
 * beaten, or CHIPS3, the highest total ranking first; the race page says what
 * the points were scored from; and a code that counts toward the fleet size
 * can be given to the boats that declared and didn't race.
 */

async function addCompetitors(page: Page, boats: { sailNumber: string; name: string }[]) {
  for (const c of boats) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sailNumber })).toBeVisible();
  }
}

async function openScoringCard(page: Page) {
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  const scoringHeading = page.getByRole('heading', { name: 'Scoring', exact: true });
  await expect(scoringHeading).toBeVisible();
  await scoringHeading.locator('..').getByRole('button', { name: 'Edit ▸' }).click();
}

test('boats beaten scores a race and ranks the highest total first', async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['high-point-scoring']);
  await createSeriesQuick(page, { name: 'Boats Beaten Series' });
  await addCompetitors(page, [
    { sailNumber: '101', name: 'Alice' },
    { sailNumber: '202', name: 'Bob' },
    { sailNumber: '303', name: 'Carol' },
    { sailNumber: '404', name: 'Dave' },
  ]);

  // ── High point, boats beaten, with the start point — before any race, so
  //    nothing is rescored and nothing is asked ─────────────────────────────
  await openScoringCard(page);
  await page.getByRole('radio', { name: /^High point/ }).check();
  await expect(page.getByRole('radio', { name: /^Boats beaten/ })).toBeChecked();
  await page.getByRole('checkbox', { name: /And 1 point for coming to the start/ }).check();
  // The preview: the winner of 5 scores 6, a DNF 1.
  const preview = page.getByTestId('high-point-preview');
  await expect(preview.getByRole('row').filter({ hasText: '1st' })).toContainText('6');
  await expect(preview.getByRole('row').filter({ hasText: 'DNF' })).toContainText('1');
  // A5.2/A5.3 are low-point rules; the code table replaces them.
  await expect(page.getByText('DNF/DNS scoring (RRS A5)')).toBeHidden();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByText('High point (boats beaten, +1 for coming to the start) ·')).toBeVisible();

  // ── Race 1: Alice 1st, Bob 2nd, Carol DNF, Dave doesn't come ─────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByTestId('non-finisher-404')).toBeVisible();
  for (const sail of ['101', '202']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }
  await page.getByTestId('non-finisher-303').getByRole('combobox').click();
  await page.getByRole('option', { name: 'DNF' }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // Two finishers and a DNF are the boats in the race; Dave isn't.
  await expect(page.getByTestId('high-point-race-line')).toContainText('High point · 3 boats in the race');

  // ── n = 3 with the start point: Alice 4, Bob 3, Carol 1, Dave 0 ─────────
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);
  await expect(page.getByText('1 race · High Point · No discards')).toBeVisible();
  const rows = page.getByRole('row');
  await expect(rows.filter({ hasText: 'Alice' }).getByRole('cell').first()).toContainText('1');
  await expect(rows.filter({ hasText: 'Alice' })).toContainText('4');
  await expect(rows.filter({ hasText: 'Bob' })).toContainText('3');
  await expect(rows.filter({ hasText: 'Carol' })).toContainText('DNF');
  await expect(rows.filter({ hasText: 'Dave' }).getByRole('cell').first()).toContainText('4');
});

test('CHIPS3 counts a declared boat in the fleet size', async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['high-point-scoring', 'custom-scoring-codes']);
  await createSeriesQuick(page, { name: 'CHIPS3 Series' });
  await addCompetitors(page, [
    { sailNumber: '101', name: 'Alice' },
    { sailNumber: '202', name: 'Bob' },
    { sailNumber: '303', name: 'Carol' },
  ]);
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 1')).toBeVisible();

  // ── With a race on the books, each change asks before rescoring ─────────
  // The radios change once the scorer says yes, so they are clicked, not
  // checked.
  await openScoringCard(page);
  await page.getByRole('radio', { name: /^High point/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Scores will be recomputed high point');
  await page.getByRole('button', { name: 'Rescore' }).click();
  await expect(page.getByRole('radio', { name: /^Boats beaten/ })).toBeChecked();
  await page.getByRole('radio', { name: /^CHIPS3/ }).click();
  await expect(page.getByRole('dialog')).toContainText('CHIPS3');
  await page.getByRole('button', { name: 'Rescore' }).click();
  await expect(page.getByRole('radio', { name: /^CHIPS3/ })).toBeChecked();

  // ── A code of the series' own for a boat that declared and didn't race ──
  await page.getByRole('button', { name: 'Change scoring codes…' }).click();
  const dialog = page.getByTestId('scoring-codes-dialog');
  await dialog.getByRole('button', { name: 'Change scoring codes', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add a code' }).click();
  await dialog.getByLabel('Code', { exact: true }).fill('DTP');
  await dialog.getByLabel('Description').fill('Declared to race, did not race');
  await dialog.getByLabel('Fixed points').fill('8');
  await expect(dialog.getByRole('checkbox', { name: /Counts toward the fleet size/ })).toBeChecked();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByTestId('code-row-DTP')).toContainText('8 points → 8');
  await dialog.getByRole('button', { name: 'Done' }).click();

  // ── Race 1: Alice finishes alone; Bob declared and didn't race ──────────
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);
  await page.getByText('Race 1').click();
  await expect(page.getByTestId('non-finisher-303')).toBeVisible();
  await page.getByLabel('Sail number').fill('101');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await expect(page.getByTestId('high-point-race-line')).toContainText('High point · 1 boat in the race');

  await page.getByRole('button', { name: 'Mark declared boats…' }).click();
  const declare = page.getByTestId('mark-declared-dialog');
  await declare.getByRole('checkbox', { name: 'Declared: 202' }).check();
  await declare.getByRole('button', { name: 'Mark 1 DTP' }).click();
  await expect(declare).toBeHidden();
  // Bob now counts: n = 2.
  await expect(page.getByTestId('high-point-race-line')).toContainText('High point · 2 boats in the race');

  // ── CHIPS3(1, 2) = 88.2 to Alice, 8 to Bob, 0 to Carol ─────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);
  const rows = page.getByRole('row');
  await expect(rows.filter({ hasText: 'Alice' })).toContainText('88.2');
  await expect(rows.filter({ hasText: 'Bob' })).toContainText('DTP');
  await expect(rows.filter({ hasText: 'Bob' })).toContainText('8');
  await expect(rows.filter({ hasText: 'Carol' }).getByRole('cell').first()).toContainText('3');
});
