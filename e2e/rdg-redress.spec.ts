import { test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * E2E tests for RDG (Redress Given) scoring — RRS Appendix A9.
 *
 * Test 1: Non-finisher RDG — competitor retires and is granted redress via the
 * code picker. Score is replaced by the A9(a) average of their other races.
 *
 * Test 2: Finisher RDG — competitor records a finish position but is later
 * granted redress via the scales button. Position is kept in the record but
 * the standings show the redress score.
 */

// ── Test 1: non-finisher RDG (A9(a) all races) ───────────────────────────────

test('RDG non-finisher: A9(a) average replaces score and shows RDG(pts) in standings', async ({ page }) => {
  // 3 competitors, 3 races, no discards.
  // Race 1: Alice=1st(1pt), Bob=2nd(2pt), Carol=3rd(3pt).
  // Race 2: Alice=RDG(A9(a)), Bob=1st(1pt), Carol=2nd(2pt).
  // Race 3: Bob=1st(1pt), Alice=2nd(2pt), Carol=3rd(3pt).
  // Alice's redress pool = races 1 & 3: avg(1, 2) = 1.5.
  // Standings: Bob 4pts (rank 1), Alice 4.5pts (rank 2), Carol 8pts (rank 3).

  const competitors = [
    { sailNumber: '1', name: 'Alice' },
    { sailNumber: '2', name: 'Bob' },
    { sailNumber: '3', name: 'Carol' },
  ];

  await createSeriesQuick(page, { name: 'RDG Non-Finisher Test' });

  for (const c of competitors) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Helm name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  for (let i = 1; i <= 3; i++) {
    await page.getByRole('button', { name: 'Add race' }).click();
  }

  // Race 1: Alice=1st, Bob=2nd, Carol=3rd
  await page.getByText('Race 1').click();
  for (const sail of ['1', '2', '3']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }
  await page.getByRole('button', { name: 'Save results' }).click();
  await expect(page).toHaveURL(/\/races$/);

  // Race 2: Bob=1st, Carol=2nd; Alice gets RDG
  await page.getByText('Race 2').click();
  for (const sail of ['2', '3']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }

  // Select RDG from Alice's non-finisher dropdown — dialog opens
  await page.getByTestId('non-finisher-1').getByRole('combobox').click();
  await page.getByRole('option', { name: 'RDG (redress)' }).click();

  // Redress dialog should open
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Redress (RDG) — 1');

  // A9(a) all_races is the default method — no changes needed; apply
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).not.toBeVisible();

  // Alice's row now shows RDG code
  await expect(page.getByTestId('non-finisher-1')).toContainText('RDG');

  await page.getByRole('button', { name: 'Save results' }).click();
  await expect(page).toHaveURL(/\/races$/);

  // Race 3: Bob=1st, Alice=2nd, Carol=3rd
  await page.getByText('Race 3').click();
  for (const sail of ['2', '1', '3']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }
  await page.getByRole('button', { name: 'Save results' }).click();
  await expect(page).toHaveURL(/\/races$/);

  await page.getByRole('link', { name: 'Standings' }).click();

  const rows = page.getByRole('row');
  const aliceRow = rows.filter({ hasText: 'Alice' });
  const bobRow = rows.filter({ hasText: 'Bob' });

  // Rank column: Bob=1, Alice=2
  await expect(bobRow.getByRole('cell').nth(0)).toContainText('1');
  await expect(aliceRow.getByRole('cell').nth(0)).toContainText('2');

  // Alice's Race 2 cell (col 5: rank=0 sail=1 name=2 club=3 R1=4 R2=5)
  const aliceR2Cell = aliceRow.getByRole('cell').nth(5);
  await expect(aliceR2Cell).toContainText('RDG(1.5)');

  // The RDG cell should be amber
  await expect(aliceR2Cell.locator('span').first()).toHaveClass(/text-amber-/);

  // Total column (col 7 for 3 races, no discard): Bob=4, Alice=4.5
  await expect(bobRow.getByRole('cell').nth(7)).toContainText('4');
  await expect(aliceRow.getByRole('cell').nth(7)).toContainText('4.5');
});

// ── Test 2: finisher RDG via scales button ────────────────────────────────────

test('RDG finisher: scales button replaces finish score with A9(a) average', async ({ page }) => {
  // 3 competitors, 3 races, no discards.
  // Race 1: Alice=1st(1pt), Bob=2nd(2pt), Carol=3rd(3pt).
  // Race 2: Alice=1st(1pt), Bob=2nd(2pt), Carol=3rd(3pt).
  // Race 3: Alice finishes 3rd but is granted RDG (A9(a)).
  //   Pool = races 1 & 2: avg(1, 1) = 1.0. Replaces the 3pt finish.
  // Standings: Alice 3.0pts (rank 1), Bob 5pts (rank 2), Carol 8pts (rank 3).

  const competitors = [
    { sailNumber: '10', name: 'Alice' },
    { sailNumber: '20', name: 'Bob' },
    { sailNumber: '30', name: 'Carol' },
  ];

  await createSeriesQuick(page, { name: 'RDG Finisher Test' });

  for (const c of competitors) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Helm name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  for (let i = 1; i <= 3; i++) {
    await page.getByRole('button', { name: 'Add race' }).click();
  }

  // Race 1: Alice=1st, Bob=2nd, Carol=3rd
  await page.getByText('Race 1').click();
  for (const sail of ['10', '20', '30']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }
  await page.getByRole('button', { name: 'Save results' }).click();
  await expect(page).toHaveURL(/\/races$/);

  // Race 2: Alice=1st, Bob=2nd, Carol=3rd
  await page.getByText('Race 2').click();
  for (const sail of ['10', '20', '30']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }
  await page.getByRole('button', { name: 'Save results' }).click();
  await expect(page).toHaveURL(/\/races$/);

  // Race 3: Bob=1st, Carol=2nd, Alice=3rd — then grant Alice redress
  await page.getByText('Race 3').click();
  for (const sail of ['20', '30', '10']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }

  // Open redress dialog via the scales button on Alice's finisher row
  await page.getByRole('button', { name: 'Set redress for 10' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Redress (RDG) — 10');
  // Dialog notes that the finish position will be kept
  await expect(dialog).toContainText('position 3 is kept');

  // A9(a) is the default; apply
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).not.toBeVisible();

  // Alice's finisher row should have amber styling (redress active)
  const aliceFinisherRow = page.locator('li').filter({ hasText: 'Alice' });
  await expect(aliceFinisherRow).toHaveClass(/border-amber/);

  await page.getByRole('button', { name: 'Save results' }).click();
  await expect(page).toHaveURL(/\/races$/);

  await page.getByRole('link', { name: 'Standings' }).click();

  const rows = page.getByRole('row');
  const aliceRow = rows.filter({ hasText: 'Alice' });
  const bobRow = rows.filter({ hasText: 'Bob' });

  // Alice ranks 1st (3.0pts), Bob 2nd (6pts)
  await expect(aliceRow.getByRole('cell').nth(0)).toContainText('1');
  await expect(bobRow.getByRole('cell').nth(0)).toContainText('2');

  // Alice's Race 3 cell (col 6) shows RDG(1) — pool avg of 1, 1 = 1.0 → shown as 1
  const aliceR3Cell = aliceRow.getByRole('cell').nth(6);
  await expect(aliceR3Cell).toContainText('RDG(1)');
  await expect(aliceR3Cell.locator('span').first()).toHaveClass(/text-amber-/);

  // Total: Alice=3, Bob=5
  await expect(aliceRow.getByRole('cell').nth(7)).toContainText('3');
  await expect(bobRow.getByRole('cell').nth(7)).toContainText('5');
});
