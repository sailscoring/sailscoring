import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * E2E tests for Phase 1 scoring codes (issue #35).
 *
 * Test 1: New position-replacing codes (DNS, RET, DSQ) can be assigned from
 * the non-finisher dropdown and appear correctly in standings.
 *
 * Test 2: BFD is non-discardable — shown in red without strikethrough even
 * when it would be the worst score under the active discard rule.
 */

// ── Test 1: new codes appear in standings ────────────────────────────────────

test('DNS, RET, and DSQ codes are assignable and appear in standings', async ({ page }) => {
  // 4 competitors, N=4, penalty=5
  const competitors = [
    { sailNumber: '101', name: 'Alice' },
    { sailNumber: '202', name: 'Bob' },
    { sailNumber: '303', name: 'Carol' },
    { sailNumber: '404', name: 'Dave' },
  ];

  await createSeriesQuick(page, { name: 'Codes Test' });

  for (const c of competitors) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();

  // Alice finishes 1st; Bob=DNS, Carol=RET, Dave=DSQ
  await page.getByLabel('Sail number').fill('101');
  await page.getByRole('button', { name: 'Add' }).click();

  await page.getByTestId('non-finisher-202').getByRole('combobox').click();
  await page.getByRole('option', { name: 'DNS' }).click();

  await page.getByTestId('non-finisher-303').getByRole('combobox').click();
  await page.getByRole('option', { name: 'RET' }).click();

  await page.getByTestId('non-finisher-404').getByRole('combobox').click();
  await page.getByRole('option', { name: 'DSQ' }).click();

  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByTestId('back-to-races').click();
  await expect(page).toHaveURL(/\/races$/);

  await page.getByRole('link', { name: 'Standings' }).click();

  const rows = page.getByRole('row');

  // Alice: 1pt, no code
  const aliceRow = rows.filter({ hasText: 'Alice' });
  await expect(aliceRow).not.toContainText('DNS');
  await expect(aliceRow).not.toContainText('DNF');

  // Bob: 5pts, DNS shown
  const bobRow = rows.filter({ hasText: 'Bob' });
  await expect(bobRow).toContainText('DNS');
  await expect(bobRow).toContainText('5');

  // Carol: 5pts, RET shown
  const carolRow = rows.filter({ hasText: 'Carol' });
  await expect(carolRow).toContainText('RET');
  await expect(carolRow).toContainText('5');

  // Dave: 5pts, DSQ shown
  const daveRow = rows.filter({ hasText: 'Dave' });
  await expect(daveRow).toContainText('DSQ');
  await expect(daveRow).toContainText('5');
});

// ── Test 2: BFD is non-discardable ───────────────────────────────────────────

test('BFD is not struck through and shown in red when a discard is active', async ({ page }) => {
  // 4 competitors, N=4, penalty=5
  // Race 1 & 2: Alice=1, Bob=2, Carol=3, Dave=4
  // Race 3: Alice=BFD(5pts, non-disc), Bob=1, Carol=2, Dave=3
  // With 1 discard:
  //   Alice: BFD(5) non-disc + best discardable-worst=1(R1) dropped → net=5+1=6
  //   Bob: 2+2+1=5, drop 2 → net=3
  const competitors = [
    { sailNumber: '1001', name: 'Alice' },
    { sailNumber: '1002', name: 'Bob' },
    { sailNumber: '1003', name: 'Carol' },
    { sailNumber: '1004', name: 'Dave' },
  ];

  await createSeriesQuick(page, { name: 'BFD Non-Discardable Test' });

  for (const c of competitors) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
  }

  // Add 3 races
  await page.getByRole('link', { name: 'Races' }).click();
  for (let i = 1; i <= 3; i++) {
    await page.getByRole('button', { name: 'Add race' }).click();
  }

  // Race 1: 1001, 1002, 1003, 1004
  await page.getByText('Race 1').click();
  for (const sail of ['1001', '1002', '1003', '1004']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByTestId('back-to-races').click();
  await expect(page).toHaveURL(/\/races$/);

  // Race 2: same order
  await page.getByText('Race 2').click();
  for (const sail of ['1001', '1002', '1003', '1004']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByTestId('back-to-races').click();
  await expect(page).toHaveURL(/\/races$/);

  // Race 3: Bob=1st, Carol=2nd, Dave=3rd; Alice=BFD
  await page.getByText('Race 3').click();
  for (const sail of ['1002', '1003', '1004']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }
  await page.getByTestId('non-finisher-1001').getByRole('combobox').click();
  await page.getByRole('option', { name: 'BFD' }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByTestId('back-to-races').click();
  await expect(page).toHaveURL(/\/races$/);

  // Add discard rule (1 discard from 3 races)
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Scoring', exact: true }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByRole('spinbutton').nth(0).fill('3');
  await page.getByRole('spinbutton').nth(1).fill('1');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);

  const rows = page.getByRole('row');
  const aliceRow = rows.filter({ hasText: 'Alice' });

  // Alice's Race 3 cell (col index: rank=0, sail=1, boat=2, name=3, club=4, R1=5, R2=6, R3=7)
  const aliceR3Cell = aliceRow.getByRole('cell').nth(7);

  // BFD cell must NOT be struck through (non-discardable)
  await expect(aliceR3Cell).not.toHaveClass(/line-through/);

  // The span inside the BFD cell must have the destructive (red) style
  const bfdSpan = aliceR3Cell.locator('span').first();
  await expect(bfdSpan).toHaveClass(/text-destructive/);

  // The span title attribute should mention "cannot be discarded"
  await expect(bfdSpan).toHaveAttribute('title', 'BFD — cannot be discarded');

  // Alice's Race 1 cell should be struck through (worst discardable score dropped)
  const aliceR1Cell = aliceRow.getByRole('cell').nth(5);
  await expect(aliceR1Cell).toHaveClass(/line-through/);

  // Bob leads with Nett=3; Alice is 2nd with Nett=6
  const aliceCells = aliceRow.getByRole('cell');
  await expect(aliceCells.nth(9)).toContainText('6'); // Nett
});

// ── Test 3: ZFP penalty is assignable and appears in standings ───────────────

test('ZFP penalty can be set on a finisher and appears in standings with amber styling', async ({ page }) => {
  // 3 competitors, N=3, DNF score=4. ZFP adds round(0.2×4)=1 pt.
  // Alice finishes 1st + ZFP → 2pts. Bob finishes 2nd → 2pts. Carol finishes 3rd → 3pts.
  const competitors = [
    { sailNumber: '501', name: 'Alice' },
    { sailNumber: '502', name: 'Bob' },
    { sailNumber: '503', name: 'Carol' },
  ];

  await createSeriesQuick(page, { name: 'ZFP Test' });

  for (const c of competitors) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();

  // Enter finishers: Alice 1st, Bob 2nd, Carol 3rd
  for (const sail of ['501', '502', '503']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }

  // Set ZFP on Alice (first finisher)
  await page.getByRole('button', { name: 'Set penalty for 501' }).click();
  await page.getByRole('dialog').getByRole('combobox').click();
  await page.getByRole('option', { name: /ZFP/ }).click();
  await page.getByRole('button', { name: 'Apply' }).click();

  // ZFP badge should appear next to Alice in the finisher list
  await expect(page.getByText('ZFP').first()).toBeVisible();

  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByTestId('back-to-races').click();
  await expect(page).toHaveURL(/\/races$/);

  await page.getByRole('link', { name: 'Standings' }).click();

  const rows = page.getByRole('row');
  const aliceRow = rows.filter({ hasText: 'Alice' });

  // Alice's R1 cell should show points and (ZFP)
  const aliceR1Cell = aliceRow.getByRole('cell').nth(5);
  await expect(aliceR1Cell).toContainText('ZFP');
  await expect(aliceR1Cell.locator('span').first()).toHaveAttribute('title', 'ZFP penalty applied');
});
