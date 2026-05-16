import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * E2E tests for discard rules (issue #32).
 *
 * Uses 5 competitors (N=5, penalty=6). Three races are sailed.
 *
 * Results:
 *   Race 1: Alice=1st, Bob=2nd, Carol=3rd, Dave=4th, Eve=5th
 *   Race 2: Alice=1st, Bob=2nd, Carol=3rd, Dave=4th, Eve=5th
 *   Race 3: Bob=1st, Carol=2nd, Dave=3rd, Eve=4th; Alice gets implicit DNC (6 pts)
 *
 * Without discard:
 *   Alice: 1+1+6=8, Bob: 2+2+1=5. Bob leads.
 *
 * With 1 discard (minRaces=3):
 *   Alice drops 6→net 2, Bob drops 2→net 3. Alice leads.
 */

const competitors = [
  { sailNumber: '1001', name: 'Alice Murphy' },
  { sailNumber: '1002', name: 'Bob Kelly' },
  { sailNumber: '1003', name: 'Carol Ryan' },
  { sailNumber: '1004', name: 'Dave Walsh' },
  { sailNumber: '1005', name: 'Eve Burke' },
];

test('discard rule changes standings and shows Nett column', async ({ page }) => {
  // ── 1. Create series ──────────────────────────────────────────────────────
  await createSeriesQuick(page, { name: 'Discard Test Series' });

  // ── 2. Add 5 competitors ──────────────────────────────────────────────────
  for (const c of competitors) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sailNumber })).toBeVisible();
  }

  // ── 3. Add 3 races ────────────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Races' }).click();
  for (let i = 1; i <= 3; i++) {
    await page.getByRole('button', { name: 'Add race' }).click();
    await expect(page.getByText(`Race ${i}`)).toBeVisible();
  }

  // ── 4. Enter Race 1 results: 1001, 1002, 1003, 1004, 1005 in order ────────
  await page.getByText('Race 1').click();
  for (const sail of ['1001', '1002', '1003', '1004', '1005']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByTestId('back-to-races').click();
  await expect(page).toHaveURL(/\/races$/);

  // ── 5. Enter Race 2 results: same order ──────────────────────────────────
  await page.getByText('Race 2').click();
  for (const sail of ['1001', '1002', '1003', '1004', '1005']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByTestId('back-to-races').click();
  await expect(page).toHaveURL(/\/races$/);

  // ── 6. Enter Race 3 results: Bob 1st, Carol 2nd, Dave 3rd, Eve 4th
  //       Alice NOT entered → implicit DNC (6 pts) ──────────────────────────
  await page.getByText('Race 3').click();
  for (const sail of ['1002', '1003', '1004', '1005']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByTestId('back-to-races').click();
  await expect(page).toHaveURL(/\/races$/);

  // ── 7. Check standings without discards: Bob should lead ─────────────────
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);

  const rows = page.getByRole('row');
  const aliceRow = rows.filter({ hasText: 'Alice Murphy' });
  const bobRow = rows.filter({ hasText: 'Bob Kelly' });

  // No discards configured yet — no Nett column
  await expect(page.getByRole('columnheader', { name: 'Nett' })).not.toBeVisible();

  // Bob leads (total 5), Alice is behind (total 8)
  await expect(bobRow.getByRole('cell').nth(0)).toContainText('1');

  // Status line shows "No discards"
  await expect(page.getByText('No discards')).toBeVisible();

  // ── 8. Add discard rule in Settings ──────────────────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByRole('heading', { name: 'Scoring', exact: true }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();

  await page.getByRole('button', { name: 'Add rule' }).click();

  // Set minRaces=3, discardCount=1
  const minRacesInput = page.getByRole('spinbutton').nth(0);
  const discardCountInput = page.getByRole('spinbutton').nth(1);
  await minRacesInput.fill('3');
  await discardCountInput.fill('1');

  // Save the scoring card
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  // ── 9. Check standings with 1 discard: Alice should now lead ─────────────
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);

  // Nett column now appears
  await expect(page.getByRole('columnheader', { name: 'Nett' })).toBeVisible();

  // Status line shows "1 discard"
  await expect(page.getByText('1 discard')).toBeVisible();

  // Alice leads with Nett=2 (drops her DNC of 6, keeps 1+1)
  await expect(aliceRow.getByRole('cell').nth(0)).toContainText('1');

  // Alice's last race cell (Race 3) should be struck through
  const aliceR3Cell = aliceRow.getByRole('cell').nth(7); // rank, sail, boat, name, club, R1, R2, R3
  await expect(aliceR3Cell).toHaveClass(/line-through/);

  // Alice: Total=8, Nett=2
  const aliceCells = aliceRow.getByRole('cell');
  const aliceTotalCell = aliceCells.nth(8);
  const aliceNettCell = aliceCells.nth(9);
  await expect(aliceTotalCell).toContainText('8');
  await expect(aliceNettCell).toContainText('2');

  // Bob: Total=5, Nett=3
  const bobCells = bobRow.getByRole('cell');
  const bobNettCell = bobCells.nth(9);
  await expect(bobNettCell).toContainText('3');
});
