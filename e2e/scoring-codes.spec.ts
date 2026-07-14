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

  // The sail-number entry resolves against the client's competitor list, and
  // an unresolved sail is a no-op (inline "not found" error, no save). The
  // refetch after the last competitor's creation can still be in flight when
  // this page renders, so wait for the newest boat's non-finisher row — it
  // proves the list the resolver reads includes every boat created above.
  await expect(page.getByTestId('non-finisher-404')).toBeVisible();

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
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
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

// ── Test 2: BFD is discardable (rule 30.4) ───────────────────────────────────

test('BFD is struck through like any other code when it is the discarded worst score', async ({ page }) => {
  // A plain BFD is an ordinary disqualification and IS discardable (rule 30.4);
  // only the niche sail-the-restart case is non-excludable (scored DNE).
  // 4 competitors, N=4, penalty=5
  // Race 1 & 2: Alice=1, Bob=2, Carol=3, Dave=4
  // Race 3: Alice=BFD(5pts), Bob=1, Carol=2, Dave=3
  // With 1 discard:
  //   Alice: 1+1+BFD(5), drop the BFD (worst) → net=2
  //   Bob: 2+2+1=5, drop 2 → net=3
  const competitors = [
    { sailNumber: '1001', name: 'Alice' },
    { sailNumber: '1002', name: 'Bob' },
    { sailNumber: '1003', name: 'Carol' },
    { sailNumber: '1004', name: 'Dave' },
  ];

  await createSeriesQuick(page, { name: 'BFD Discardable Test' });

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
  // Sail entry no-ops on an unresolved number — wait for the newest boat's
  // non-finisher row so the competitor list is known to be complete.
  await expect(page.getByTestId('non-finisher-1004')).toBeVisible();
  for (const sail of ['1001', '1002', '1003', '1004']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);

  // Race 2: same order
  await page.getByText('Race 2').click();
  for (const sail of ['1001', '1002', '1003', '1004']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
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
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
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

  // BFD is the worst score and IS discardable, so the cell must be struck through
  await expect(aliceR3Cell).toHaveClass(/line-through/);

  // The BFD span must NOT carry the non-discardable (red) styling or tooltip
  const bfdSpan = aliceR3Cell.locator('span').first();
  await expect(bfdSpan).not.toHaveClass(/text-destructive/);
  await expect(bfdSpan).not.toHaveAttribute('title', 'BFD — cannot be discarded');

  // Alice's Race 1 cell should NOT be struck through (the BFD was dropped instead)
  const aliceR1Cell = aliceRow.getByRole('cell').nth(5);
  await expect(aliceR1Cell).not.toHaveClass(/line-through/);

  // Alice leads with Nett=2 (BFD discarded); Bob is 2nd with Nett=3
  const aliceCells = aliceRow.getByRole('cell');
  await expect(aliceCells.nth(9)).toContainText('2'); // Nett
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

  // Sail entry no-ops on an unresolved number — wait for the newest boat's
  // non-finisher row so the competitor list is known to be complete.
  await expect(page.getByTestId('non-finisher-503')).toBeVisible();

  // Enter finishers: Alice 1st, Bob 2nd, Carol 3rd
  for (const sail of ['501', '502', '503']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }

  // Set ZFP on Alice (first finisher)
  await page.getByRole('button', { name: 'Row actions for 501' }).click();
  await page.getByRole('menuitem', { name: 'Set scoring penalty' }).click();
  await page.getByRole('dialog').getByRole('combobox').click();
  await page.getByRole('option', { name: /ZFP/ }).click();
  await page.getByRole('button', { name: 'Apply' }).click();

  // ZFP badge should appear next to Alice in the finisher list
  await expect(page.getByText('ZFP').first()).toBeVisible();

  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);

  await page.getByRole('link', { name: 'Standings' }).click();

  const rows = page.getByRole('row');
  const aliceRow = rows.filter({ hasText: 'Alice' });

  // Alice's R1 cell should show points and (ZFP)
  const aliceR1Cell = aliceRow.getByRole('cell').nth(5);
  await expect(aliceR1Cell).toContainText('ZFP');
  await expect(aliceR1Cell.locator('span').first()).toHaveAttribute('title', 'ZFP penalty applied');
});

// ── Test 4: DNC is selectable on a boat with a retained check-in record ──────

test('DNC sticks on a non-finisher whose row retained a check-in flag', async ({ page }) => {
  await createSeriesQuick(page, { name: 'DNC Stick Test' });

  for (const c of [
    { sailNumber: '101', name: 'Alice' },
    { sailNumber: '202', name: 'Bob' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();

  // Sail entry no-ops on an unresolved number (inline "not found" error, no
  // save) — wait for the newest boat's non-finisher row so the competitor
  // list the resolver reads is known to be complete. Without this, a slow
  // post-create refetch makes the Add below a silent no-op, race 1 ends with
  // no finisher at all, and the standings exclude it ("—" cells, 0 points).
  await expect(page.getByTestId('non-finisher-202')).toBeVisible();

  // Bob finishes; Alice is added by mistake and removed again. The removal
  // retains her row as a check-in-only record (startPresent stays true), so
  // she shows as DNF among the non-finishers rather than DNC (absent).
  await page.getByLabel('Sail number').fill('202');
  await page.getByRole('button', { name: 'Add' }).click();
  // Bob leaving the panel proves his finish was actually committed.
  await expect(page.getByTestId('non-finisher-202')).toHaveCount(0);
  await page.getByLabel('Sail number').fill('101');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByRole('button', { name: 'Remove 101' }).click();
  // Let the remove's saves settle: in-flight mutations re-render the
  // non-finisher rows, which would close the select menu under the click.
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  const aliceSelect = page.getByTestId('non-finisher-101').getByRole('combobox');
  await expect(aliceSelect).toHaveText('DNF');

  // "DNC (absent)" must stick: it deletes the retained record outright.
  await aliceSelect.click();
  await page.getByRole('option', { name: 'DNC (absent)' }).click();
  await expect(aliceSelect).toHaveText('DNC (absent)');
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // Explicit DNC must stick too (and not redisplay as DNF or collapse to
  // the implicit label).
  await aliceSelect.click();
  await page.getByRole('option', { name: 'DNC', exact: true }).click();
  await expect(aliceSelect).toHaveText('DNC', { useInnerText: true });
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // Standings agree with the finish sheet: Alice is scored DNC.
  await page.getByRole('link', { name: 'Standings' }).click();
  const aliceRow = page.getByRole('row').filter({ hasText: 'Alice' });
  await expect(aliceRow).toContainText('DNC');
  await expect(aliceRow).not.toContainText('DNF');
});
