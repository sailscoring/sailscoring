import { test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * E2E tests for start check-in and A5.3 scoring (issue #42).
 *
 * 5 competitors (N=5, series-entry penalty=6).
 *
 * Race 1: all 5 finish cleanly (1–5).
 * Race 2: Alice, Bob, Carol checked in to the starting area.
 *   - Carol finishes 1st.
 *   - Alice and Bob do not finish and appear in the non-finisher list as DNF
 *     (because they were checked in).
 *   - Dave and Eve are not checked in → implicit DNC.
 *
 * With A5.3 enabled:
 *   starting-area count = 3 → starting-area penalty = 4
 *   Alice: DNF = 4, Bob: DNF = 4, Carol: 1
 *   Dave: DNC = 6, Eve: DNC = 6
 *
 * Race 2 totals: Carol=4, Alice=5, Bob=6, Dave=10, Eve=11
 */

const competitors = [
  { sailNumber: '101', name: 'Alice' },
  { sailNumber: '202', name: 'Bob' },
  { sailNumber: '303', name: 'Carol' },
  { sailNumber: '404', name: 'Dave' },
  { sailNumber: '505', name: 'Eve' },
];

test('start check-in marks boats present and affects A5.3 standings', async ({ page }) => {
  // ── 1. Create series ──────────────────────────────────────────────────────
  await createSeriesQuick(page, { name: 'A5.3 Test Series' });

  // ── 2. Add 5 competitors ──────────────────────────────────────────────────
  for (const c of competitors) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Helm name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sailNumber })).toBeVisible();
  }

  // ── 3. Enable A5.3 in Settings ───────────────────────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Scoring', exact: true }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByLabel('Boats in the starting area (RRS A5.3 — alternative)').check();
  await page.getByRole('button', { name: 'Save', exact: false }).last().click();

  // ── 4. Add 2 races ────────────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Races' }).click();
  for (let i = 1; i <= 2; i++) {
    await page.getByRole('button', { name: 'Add race' }).click();
    await expect(page.getByText(`Race ${i}`)).toBeVisible();
  }

  // ── 5. Race 1: all 5 finish cleanly ──────────────────────────────────────
  await page.getByText('Race 1').click();
  for (const sail of ['101', '202', '303', '404', '505']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }
  await page.getByRole('button', { name: 'Save results' }).click();
  await expect(page).toHaveURL(/\/races$/);

  // ── 6. Race 2: check in Alice, Bob, Carol; then enter Carol as finisher ───
  await page.getByText('Race 2').click();

  // Switch to start check-in tab
  await page.getByRole('button', { name: 'Start check-in' }).click();

  // Mark Alice via keyboard (Enter on the autocomplete suggestion)
  const search = page.getByPlaceholder('Sail number to search…');
  await search.fill('101');
  await search.press('Enter');
  await expect(search).toHaveValue('');
  await expect(page.getByText('Present at start: 1 / 5')).toBeVisible();

  // Mark Bob via keyboard (Tab on the autocomplete suggestion)
  await search.fill('202');
  await search.press('Tab');
  await expect(search).toHaveValue('');
  await expect(page.getByText('Present at start: 2 / 5')).toBeVisible();

  // Mark Carol by clicking the row (covers the original mouse-down path)
  await page.getByRole('button', { name: /303/ }).click();

  // Confirm count shows 3 present
  await expect(page.getByText('Present at start: 3 / 5')).toBeVisible();

  // Switch back to finish entry and enter Carol as sole finisher
  await page.getByRole('button', { name: 'Finish entry' }).click();
  await page.getByLabel('Sail number').fill('303');
  await page.getByRole('button', { name: 'Add' }).click();

  // Alice and Bob should show as DNF (not DNC) in the non-finisher list
  // because they were checked in to the starting area
  const aliceRow = page.getByTestId('non-finisher-101');
  const bobRow = page.getByTestId('non-finisher-202');
  await expect(aliceRow).toBeVisible();
  await expect(bobRow).toBeVisible();
  await expect(aliceRow.getByRole('combobox')).toContainText('DNF');
  await expect(bobRow.getByRole('combobox')).toContainText('DNF');

  await page.getByRole('button', { name: 'Save results' }).click();
  await expect(page).toHaveURL(/\/races$/);

  // ── 7. Check standings reflect A5.3 scoring ───────────────────────────────
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);

  const rows = page.getByRole('row');
  const carolRow = rows.filter({ hasText: 'Carol' });
  const aliceStandingRow = rows.filter({ hasText: 'Alice' });
  const daveRow = rows.filter({ hasText: 'Dave' });

  // Carol leads: 3 + 1 = 4
  await expect(carolRow.getByRole('cell').nth(0)).toContainText('1');

  // Alice is 2nd: 1 + 4 = 5 (DNF scores starting-area penalty 4, not series 6)
  await expect(aliceStandingRow.getByRole('cell').nth(0)).toContainText('2');

  // Dave is 4th: 4 + 6 = 10 (DNC still scores series-entry penalty 6)
  await expect(daveRow.getByRole('cell').nth(0)).toContainText('4');
});
