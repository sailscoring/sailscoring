import { test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * Full happy-path test for a simple one-day event.
 *
 * Creates "The Brassed-Off Cup" series, adds 5 competitors, enters
 * results for 2 races, and verifies standings are calculated correctly.
 *
 * Fleet: 5 competitors (N=5), no discards, Low Point scratch scoring.
 * Penalty points = N+1 = 6.
 *
 * Race 1:  1=A(1001), 2=B(1002), 3=C(1003), D(1004)=DNF, E(1005)=implicit DNC
 *          Points: A=1, B=2, C=3, D=6, E=6
 *
 * Race 2:  1=C(1003), 2=A(1001), 3=E(1005), B(1002)=OCS, D(1004)=implicit DNC
 *          Points: C=1, A=2, E=3, B=6, D=6
 *
 * Series totals:  A=3, C=4, B=8, E=9, D=12
 * Expected standings: 1=A(3), 2=C(4), 3=B(8), 4=E(9), 5=D(12)
 */

// Deliberately not in sail-number order to verify the list sorts correctly.
const competitors = [
  { sailNumber: '1003', name: 'Carol Ryan', club: 'HYC', gender: 'F', age: '11' },
  { sailNumber: '1001', name: 'Alice Murphy', club: 'HYC', gender: 'F', age: '12' },
  { sailNumber: '1005', name: 'Eve Burke', club: 'BYC', gender: 'F', age: '12' },
  { sailNumber: '1002', name: 'Bob Kelly', club: 'RCYC', gender: 'M', age: '13' },
  { sailNumber: '1004', name: 'Dave Walsh', club: 'NYS', gender: 'M', age: '14' },
];

test('scratch event, one fleet, 2 races', async ({ page }) => {
  // ── 1. Create series ──────────────────────────────────────────────────────
  await createSeriesQuick(page, { name: 'The Brassed-Off Cup', venue: 'Howth Yacht Club' });
  await expect(page.getByRole('heading', { name: 'The Brassed-Off Cup' })).toBeVisible();

  // ── 2. Add 5 competitors ──────────────────────────────────────────────────
  // Note: the Age field is optional and hidden by default — scorers enable it
  // via Settings → Competitor fields. This test uses the default layout, so
  // c.age goes unused here.
  for (const c of competitors) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Helm name').fill(c.name);
    await page.getByLabel('Club').fill(c.club);
    await page.getByRole('button', { name: 'Save' }).click();
    // Wait for row to appear before adding the next one
    await expect(page.getByRole('cell', { name: c.sailNumber })).toBeVisible();
  }

  // Verify competitor count and that the list is sorted by sail number
  await expect(page.getByText('5 competitors')).toBeVisible();
  const sailCells = page.getByRole('cell', { name: /^\d{4}$/ });
  await expect(sailCells.nth(0)).toHaveText('1001');
  await expect(sailCells.nth(1)).toHaveText('1002');
  await expect(sailCells.nth(2)).toHaveText('1003');
  await expect(sailCells.nth(3)).toHaveText('1004');
  await expect(sailCells.nth(4)).toHaveText('1005');

  // ── 3. Add races ──────────────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);

  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 1')).toBeVisible();

  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 2')).toBeVisible();

  // Newly added races have no results yet
  await expect(page.getByText('0 finishers')).toHaveCount(2);

  // ── 4. Enter Race 1 results ───────────────────────────────────────────────
  // Race 1: 1001, 1002, 1003 finish; 1004=DNF; 1005=implicit DNC
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  for (const sail of ['1001', '1002', '1003']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }

  // Verify finishing order — row 1 is the first list item and contains 1001
  await expect(page.getByRole('listitem').nth(0)).toContainText('1001');
  await expect(page.getByRole('listitem').filter({ hasText: '1001' })).toBeVisible();

  // Set 1004 as DNF (it's in the non-finishers panel)
  await page.getByTestId('non-finisher-1004').getByRole('combobox').click();
  await page.getByRole('option', { name: 'DNF' }).click();

  await page.getByRole('button', { name: 'Save results' }).click();
  await expect(page).toHaveURL(/\/races$/);

  // Race 1 had 3 finishers (1001, 1002, 1003); Race 2 still empty
  await expect(page.getByText('3 finishers')).toHaveCount(1);
  await expect(page.getByText('0 finishers')).toHaveCount(1);

  // ── 5. Enter Race 2 results ───────────────────────────────────────────────
  // Race 2: 1003, 1001, 1005 finish; 1002=OCS; 1004=implicit DNC
  await page.getByText('Race 2').click();
  await expect(page.getByText('Race 2 — results')).toBeVisible();

  for (const sail of ['1003', '1001', '1005']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }

  // Set 1002 as OCS
  await page.getByTestId('non-finisher-1002').getByRole('combobox').click();
  await page.getByRole('option', { name: 'OCS' }).click();

  await page.getByRole('button', { name: 'Save results' }).click();
  await expect(page).toHaveURL(/\/races$/);

  // Both races now have 3 finishers each (1003, 1001, 1005 in Race 2)
  await expect(page.getByText('3 finishers')).toHaveCount(2);

  // ── 6. Verify standings ───────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);

  // Check that Alice (1001) is ranked 1st with 3 total points
  const rows = page.getByRole('row');
  const aliceRow = rows.filter({ hasText: 'Alice Murphy' });
  await expect(aliceRow).toContainText('1001');
  await expect(aliceRow.getByRole('cell').last()).toContainText('3');

  // Check Carol (1003) is ranked 2nd with 4 total points
  const carolRow = rows.filter({ hasText: 'Carol Ryan' });
  await expect(carolRow).toContainText('1003');
  await expect(carolRow.getByRole('cell').last()).toContainText('4');

  // Check Dave (1004) has the highest total (12)
  const daveRow = rows.filter({ hasText: 'Dave Walsh' });
  await expect(daveRow.getByRole('cell').last()).toContainText('12');

  // Verify race count displayed
  await expect(page.getByText('2 races')).toBeVisible();

  // ── 7. Verify result codes in standings ───────────────────────────────────
  // Dave (1004): DNF in Race 1, implicit DNC in Race 2
  await expect(daveRow).toContainText('DNF');
  await expect(daveRow).toContainText('DNC');

  // Bob (1002): normal finish in Race 1, OCS in Race 2
  const bobRow = rows.filter({ hasText: 'Bob Kelly' });
  await expect(bobRow).toContainText('OCS');
  await expect(bobRow).not.toContainText('DNC');
  await expect(bobRow).not.toContainText('DNF');

  // Eve (1005): implicit DNC in Race 1, normal finish in Race 2
  const eveRow = rows.filter({ hasText: 'Eve Burke' });
  await expect(eveRow).toContainText('DNC');
  await expect(eveRow).not.toContainText('DNF');
  await expect(eveRow).not.toContainText('OCS');

  // Alice (1001): normal finishes in both races — no penalty codes shown
  await expect(aliceRow).not.toContainText('DNC');
  await expect(aliceRow).not.toContainText('DNF');
  await expect(aliceRow).not.toContainText('OCS');

  // ── 8. Delete Race 2 and verify standings update ──────────────────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await expect(page.getByText('2 races')).toBeVisible();

  // Race 2 is the second row — accept the confirm dialog then click its Delete
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete Race 2' }).click();
  await expect(page.getByText('Race 2')).not.toBeVisible();
  await expect(page.getByText('1 race')).toBeVisible();

  // Standings with Race 1 only (N=5, penalty=6):
  //   Alice=1, Bob=2, Carol=3, Dave=6(DNF), Eve=6(DNC)
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByText('1 race')).toBeVisible();
  await expect(aliceRow.getByRole('cell').last()).toContainText('1');
  await expect(carolRow.getByRole('cell').last()).toContainText('3');
  await expect(daveRow.getByRole('cell').last()).toContainText('6');
  await expect(daveRow).toContainText('DNF');
  await expect(eveRow.getByRole('cell').last()).toContainText('6');
  await expect(eveRow).toContainText('DNC');

  // ── 9. Delete Eve and verify standings recalculate ────────────────────────
  // With Eve gone, N drops to 4 so the penalty (N+1) falls to 5.
  // Dave's DNF should now score 5, not 6.
  await page.getByRole('link', { name: 'Competitors' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete Eve Burke' }).click();
  await expect(page.getByRole('cell', { name: '1005' })).not.toBeVisible();
  await expect(page.getByText('4 competitors')).toBeVisible();

  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByText('4 competitors')).toBeVisible();
  await expect(aliceRow.getByRole('cell').last()).toContainText('1');
  await expect(daveRow.getByRole('cell').last()).toContainText('5');
  await expect(daveRow).toContainText('DNF');
});

test('unknown sail number shows error and "Record as unknown" option', async ({ page }) => {
  // Create a minimal series with one competitor
  await createSeriesQuick(page, { name: 'Error Test Series' });

  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('9999');
  await page.getByLabel('Helm name').fill('Test Sailor');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: '9999' })).toBeVisible();

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();

  // Enter an unknown sail number — error and Record as unknown button appear
  await page.getByLabel('Sail number').fill('0000');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText(/not registered in this series/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record as unknown' })).toBeVisible();

  // Dismiss via Escape on the sail input — entry is NOT added
  await page.getByLabel('Sail number').press('Escape');
  await expect(page.getByText(/not registered in this series/)).not.toBeVisible();
  await expect(page.getByText('Unknown — not registered')).not.toBeVisible();

  // Enter the same sail number twice
  await page.getByLabel('Sail number').fill('9999');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByLabel('Sail number').fill('9999');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText(/already in the finishing order/)).toBeVisible();
});

test('unknown finish can be recorded and resolved', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Resolve Test Series' });

  // Add two competitors
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('1001');
  await page.getByLabel('Helm name').fill('Alice');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('1002');
  await page.getByLabel('Helm name').fill('Bob');
  await page.getByRole('button', { name: 'Save' }).click();

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();

  // Add 1001 as a known finisher
  await page.getByLabel('Sail number').fill('1001');
  await page.getByRole('button', { name: 'Add' }).click();

  // Record unknown sail 9999
  await page.getByLabel('Sail number').fill('9999');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText(/not registered in this series/)).toBeVisible();
  await page.getByRole('button', { name: 'Record as unknown' }).click();

  // Unknown entry appears in finishing order
  await expect(page.getByText('Unknown — not registered')).toBeVisible();
  await expect(page.getByText('9999')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resolve' })).toBeVisible();

  // Resolve to Bob (1002)
  await page.getByRole('button', { name: 'Resolve' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('Resolve sail 9999')).toBeVisible();
  // 1002/Bob should be in the list (1001 already finished)
  await page.getByRole('button', { name: /1002/ }).click();

  // Unknown entry replaced by known entry for 1002
  await expect(page.getByText('Unknown — not registered')).not.toBeVisible();
  await expect(page.getByText('Bob')).toBeVisible();

  // Save succeeds
  await page.getByRole('button', { name: 'Save results' }).click();
  await expect(page).toHaveURL(/\/races$/);
});

test('unknown finish resolved by adding a new competitor', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Add Competitor Test Series' });

  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('1001');
  await page.getByLabel('Helm name').fill('Alice');
  await page.getByRole('button', { name: 'Save' }).click();

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();

  // Record unknown sail 9999
  await page.getByLabel('Sail number').fill('9999');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByRole('button', { name: 'Record as unknown' }).click();

  // Open resolve dialog and choose "Add new competitor"
  await page.getByRole('button', { name: 'Resolve' }).click();
  await page.getByRole('button', { name: 'Add new competitor' }).click();

  // Form is pre-filled with the unknown sail number
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Sail number')).toHaveValue('9999');

  // Fill in the helm name and submit
  await dialog.getByLabel('Helm name *').fill('Bob');
  await dialog.getByRole('button', { name: 'Add and resolve' }).click();

  // Unknown entry replaced by the new competitor
  await expect(page.getByText('Unknown — not registered')).not.toBeVisible();
  await expect(page.getByText('Bob')).toBeVisible();

  // Save succeeds
  await page.getByRole('button', { name: 'Save results' }).click();
  await expect(page).toHaveURL(/\/races$/);

  // New competitor is now in the series
  await page.getByRole('link', { name: 'Competitors' }).click();
  await expect(page.getByRole('cell', { name: '9999' })).toBeVisible();
  await expect(page.getByText('Bob')).toBeVisible();
});

test('unknown finish survives save and reload', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Roundtrip Test Series' });

  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('1001');
  await page.getByLabel('Helm name').fill('Alice');
  await page.getByRole('button', { name: 'Save' }).click();

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();

  await page.getByLabel('Sail number').fill('1001');
  await page.getByRole('button', { name: 'Add' }).click();

  await page.getByLabel('Sail number').fill('9999');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByRole('button', { name: 'Record as unknown' }).click();
  await expect(page.getByText('Unknown — not registered')).toBeVisible();

  // Save and navigate back
  await page.getByRole('button', { name: 'Save results' }).click();
  await expect(page).toHaveURL(/\/races$/);
  await page.getByText('Race 1').click();

  // Unknown finish is still there after reload
  await expect(page.getByText('9999')).toBeVisible();
  await expect(page.getByText('Unknown — not registered')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resolve' })).toBeVisible();
});

test('unresolved unknown finish is excluded from standings', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Scoring Test Series' });

  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('1001');
  await page.getByLabel('Helm name').fill('Alice');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('1002');
  await page.getByLabel('Helm name').fill('Bob');
  await page.getByRole('button', { name: 'Save' }).click();

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();

  // 1001 finishes first, unknown 9999 second, 1002 not recorded
  await page.getByLabel('Sail number').fill('1001');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByLabel('Sail number').fill('9999');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByRole('button', { name: 'Record as unknown' }).click();

  await page.getByRole('button', { name: 'Save results' }).click();
  await expect(page).toHaveURL(/\/races$/);

  // Check standings
  await page.getByRole('link', { name: 'Standings' }).click();
  const rows = page.getByRole('row');
  // Alice (1001) has 1 point; Bob (1002) has DNC; no row for 9999
  await expect(rows.filter({ hasText: 'Alice' })).toContainText('1');
  await expect(rows.filter({ hasText: 'Bob' })).toContainText('DNC');
  // 9999 should not appear in standings at all
  await expect(page.getByText('9999')).not.toBeVisible();
});

test('move controls reorder scratch rows in the finishing list', async ({ page }) => {
  // ── Setup: series with 3 competitors and one race ─────────────────────────
  await createSeriesQuick(page, { name: 'Scratch Reorder Cup' });

  for (const [sailNumber, name] of [['101', 'Alice'], ['102', 'Bob'], ['103', 'Carol']]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(sailNumber);
    await page.getByLabel('Helm name').fill(name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: sailNumber })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  // Add finishers in order: 101 (row 1), 102 (row 2), 103 (row 3)
  for (const sail of ['101', '102', '103']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }

  const row = (n: number) => page.getByRole('listitem').nth(n);

  // Verify initial order
  await expect(row(0)).toContainText('101');
  await expect(row(1)).toContainText('102');
  await expect(row(2)).toContainText('103');

  // ── 1. Move 103 up two steps → [101, 103, 102] then [103, 101, 102] ───────
  await page.getByTestId('move-up-103').click();
  await expect(row(0)).toContainText('101');
  await expect(row(1)).toContainText('103');
  await expect(row(2)).toContainText('102');

  await page.getByTestId('move-up-103').click();
  await expect(row(0)).toContainText('103');
  await expect(row(1)).toContainText('101');
  await expect(row(2)).toContainText('102');

  // ── 2. Move 103 down → [101, 103, 102] ────────────────────────────────────
  await page.getByTestId('move-down-103').click();
  await expect(row(0)).toContainText('101');
  await expect(row(1)).toContainText('103');
  await expect(row(2)).toContainText('102');

  // ── 3. Move controls at the boundaries are disabled ───────────────────────
  // 101 is now in row 0, so its ↑ button is disabled
  await expect(page.getByTestId('move-up-101')).toBeDisabled();
  // 102 is now in row 2 (the last row), so its ↓ button is disabled
  await expect(page.getByTestId('move-down-102')).toBeDisabled();

  // ── 4. Save and confirm redirect ──────────────────────────────────────────
  await page.getByRole('button', { name: 'Save results' }).click();
  await expect(page).toHaveURL(/\/races$/);
  await expect(page.getByText('3 finishers')).toBeVisible();
});

test('sail number autocomplete in result entry', async ({ page }) => {
  // ── Setup: series with 3 competitors and one race ─────────────────────────
  await createSeriesQuick(page, { name: 'Autocomplete Test Cup' });

  for (const [sailNumber, name] of [['1001', 'Alice Murphy'], ['1002', 'Bob Kelly'], ['1003', 'Carol Ryan']]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(sailNumber);
    await page.getByLabel('Helm name').fill(name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: sailNumber })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  const sailInput = page.getByLabel('Sail number');

  // ── 1. Dropdown appears on partial input ──────────────────────────────────
  await sailInput.fill('100');
  await expect(page.getByRole('listbox')).toBeVisible();
  await expect(page.getByRole('option', { name: /1001/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /1002/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /1003/ })).toBeVisible();

  // ── 2. Dropdown filters by prefix ─────────────────────────────────────────
  await sailInput.fill('1001');
  await expect(page.getByRole('option', { name: /1001/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /1002/ })).not.toBeVisible();
  await expect(page.getByRole('option', { name: /1003/ })).not.toBeVisible();

  // ── 3. Mouse click on suggestion adds finisher and clears input ───────────
  await sailInput.fill('100');
  await page.getByRole('option', { name: /1001/ }).click();
  await expect(page.getByRole('listitem').filter({ hasText: '1001' })).toBeVisible();
  await expect(sailInput).toHaveValue('');
  await expect(page.getByRole('listbox')).not.toBeVisible();

  // ── 4. Already-added competitor excluded from suggestions ─────────────────
  await sailInput.fill('100');
  await expect(page.getByRole('option', { name: /1001/ })).not.toBeVisible();
  await expect(page.getByRole('option', { name: /1002/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /1003/ })).toBeVisible();

  // ── 5. Keyboard: ArrowDown + Enter selects highlighted suggestion ─────────
  await sailInput.press('ArrowDown');
  await sailInput.press('Enter');
  // First remaining suggestion (1002) should be added
  await expect(page.getByRole('listitem').filter({ hasText: '1002' })).toBeVisible();
  await expect(sailInput).toHaveValue('');

  // ── 6. Escape clears input and closes dropdown ────────────────────────────
  await sailInput.fill('100');
  await expect(page.getByRole('listbox')).toBeVisible();
  await sailInput.press('Escape');
  await expect(sailInput).toHaveValue('');
  await expect(page.getByRole('listbox')).not.toBeVisible();
});
