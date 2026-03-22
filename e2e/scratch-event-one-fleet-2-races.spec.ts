import { test, expect } from '@playwright/test';

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
  await page.goto('/');
  await page.getByRole('link', { name: 'New series' }).click();
  await expect(page.getByRole('heading', { name: 'New series' })).toBeVisible();

  await page.getByLabel('Name').fill('The Brassed-Off Cup');
  await page.getByLabel('Venue').fill('Howth Yacht Club');
  await page.getByRole('button', { name: 'Create series' }).click();

  // Should redirect to competitors tab
  await expect(page).toHaveURL(/\/series\/[0-9a-f-]{36}\/competitors$/);
  await expect(page.getByRole('heading', { name: 'The Brassed-Off Cup' })).toBeVisible();

  // ── 2. Add 5 competitors ──────────────────────────────────────────────────
  for (const c of competitors) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Helm name').fill(c.name);
    await page.getByLabel('Club').fill(c.club);
    await page.getByLabel('Age').fill(c.age);
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
  const [race1Link] = await page.getByRole('link', { name: 'Enter results' }).all();
  await race1Link.click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  for (const sail of ['1001', '1002', '1003']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }

  // Verify finishing order
  await expect(page.getByText('1.')).toBeVisible();
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
  const raceLinks = await page.getByRole('link', { name: 'Enter results' }).all();
  await raceLinks[1].click();
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
  await page.getByRole('button', { name: 'Delete' }).nth(1).click();
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

test('unknown sail number shows error in result entry', async ({ page }) => {
  // Create a minimal series with one competitor
  await page.goto('/');
  await page.getByRole('link', { name: 'New series' }).click();
  await page.getByLabel('Name').fill('Error Test Series');
  await page.getByRole('button', { name: 'Create series' }).click();

  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('9999');
  await page.getByLabel('Helm name').fill('Test Sailor');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: '9999' })).toBeVisible();

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByRole('link', { name: 'Enter results' }).click();

  // Enter an unknown sail number
  await page.getByLabel('Sail number').fill('0000');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText(/not found in this series/)).toBeVisible();

  // Enter the same sail number twice
  await page.getByLabel('Sail number').fill('9999');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByLabel('Sail number').fill('9999');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText(/already in the finishing order/)).toBeVisible();
});
