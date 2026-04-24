import { test, expect } from './fixtures';
import { createFleets, createSeriesQuick } from './helpers';

/**
 * E2E tests for fleet support (issue #40).
 *
 * Two fleets: Junior (3 competitors), Senior (2 competitors).
 * 2 races, all competitors finish.
 *
 * Race 1 — finish order: J1, J2, J3, S1, S2 (absolute positions 1–5)
 *   Junior points:  J1=1, J2=2, J3=3  (N=3, penalty=4)
 *   Senior points:  S1=4, S2=5        (absolute positions; N=2, penalty=3)
 *
 * Race 2 — finish order: J2, J3, J1, S2, S1 (absolute positions 1–5)
 *   Junior points:  J2=1, J3=2, J1=3
 *   Senior points:  S2=4, S1=5
 *
 * Junior totals:  J2=3, J1=4, J3=5  → 1=J2, 2=J1, 3=J3
 * Senior totals:  S1=9, S2=9 (tie; S2 wins: better score in Race 2 → 4 vs 5)
 */

const juniors = [
  { sailNumber: 'J1', name: 'Alice Junior', club: 'HYC', fleet: 'Junior' },
  { sailNumber: 'J2', name: 'Bob Junior', club: 'HYC', fleet: 'Junior' },
  { sailNumber: 'J3', name: 'Carol Junior', club: 'HYC', fleet: 'Junior' },
];
const seniors = [
  { sailNumber: 'S1', name: 'Dave Senior', club: 'HYC', fleet: 'Senior' },
  { sailNumber: 'S2', name: 'Eve Senior', club: 'HYC', fleet: 'Senior' },
];

test('two-fleet series shows fleet column, per-fleet standings, and exports two files', async ({ page }) => {
  // ── 1. Create series ──────────────────────────────────────────────────────
  await createSeriesQuick(page, { name: 'Junior-Senior Combined 2025', venue: 'HYC' });

  // ── 2. Create fleets ─────────────────────────────────────────────────────
  await createFleets(page, ['Junior', 'Senior']);

  // ── 3. Add competitors with fleet assignments ─────────────────────────────
  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const c of [...juniors, ...seniors]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByLabel('Club').fill(c.club);
    // Check the appropriate fleet checkbox
    await page.getByRole('checkbox', { name: c.fleet }).check();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sailNumber })).toBeVisible();
  }

  // ── 4. Fleet column appears in competitors table ──────────────────────────
  await expect(page.getByRole('columnheader', { name: 'Fleet' })).toBeVisible();
  const rows = page.getByRole('row');
  await expect(rows.filter({ hasText: 'J1' }).first()).toContainText('Junior');
  await expect(rows.filter({ hasText: 'S1' }).first()).toContainText('Senior');

  // ── 5. Add 2 races ────────────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 1')).toBeVisible();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 2')).toBeVisible();

  // ── 6. Enter Race 1: J1, J2, J3, S1, S2 in order ────────────────────────
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  for (const sail of ['J1', 'J2', 'J3', 'S1', 'S2']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }

  await page.getByRole('button', { name: 'Save results' }).click();
  await expect(page).toHaveURL(/\/races$/);

  // ── 7. Enter Race 2: J2, J3, J1, S2, S1 in order ─────────────────────────
  await page.getByText('Race 2').click();
  await expect(page.getByText('Race 2 — results')).toBeVisible();

  for (const sail of ['J2', 'J3', 'J1', 'S2', 'S1']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }

  await page.getByRole('button', { name: 'Save results' }).click();
  await expect(page).toHaveURL(/\/races$/);

  // ── 8. Standings show per-fleet headings ──────────────────────────────────
  await page.getByRole('link', { name: 'Standings' }).click();

  await expect(page.getByRole('heading', { name: 'Junior' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Senior' })).toBeVisible();
  await expect(page.getByText(/2 fleets/)).toBeVisible();

  // Junior winner is J2 (1+2=3 points); Senior: S1=[4,5] ties S2=[5,4] on net 9,
  // S2 wins tie-break (better score in Race 2: 4 vs 5).
  const juniorSection = page.getByRole('heading', { name: 'Junior' }).locator('..');
  await expect(juniorSection.getByRole('row').nth(1)).toContainText('J2');

  const seniorSection = page.getByRole('heading', { name: 'Senior' }).locator('..');
  await expect(seniorSection.getByRole('row').nth(1)).toContainText('S2');

  // ── 9. Export HTML dropdown offers per-fleet downloads ───────────────────
  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));

  await page.getByRole('button', { name: /Export HTML/ }).click();
  await page.getByRole('menuitem', { name: 'Junior' }).click();
  await page.getByRole('button', { name: /Export HTML/ }).click();
  await page.getByRole('menuitem', { name: 'Senior' }).click();
  await page.waitForTimeout(500);

  expect(downloads.some((n) => n.includes('junior'))).toBe(true);
  expect(downloads.some((n) => n.includes('senior'))).toBe(true);
});

test('multi-fleet non-finishers show fleet badge', async ({ page }) => {
  // Create series
  await createSeriesQuick(page, { name: 'Non-finisher Fleet Test', venue: 'HYC' });

  // Create fleets
  await createFleets(page, ['Junior', 'Senior']);

  // Add competitors in two fleets
  await page.getByRole('link', { name: 'Competitors' }).click();
  const competitors = [
    { sailNumber: 'J1', name: 'Alice', club: 'HYC', fleet: 'Junior' },
    { sailNumber: 'S1', name: 'Bob', club: 'HYC', fleet: 'Senior' },
    { sailNumber: 'S2', name: 'Carol', club: 'HYC', fleet: 'Senior' },
  ];
  for (const c of competitors) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByLabel('Club').fill(c.club);
    await page.getByRole('checkbox', { name: c.fleet }).check();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sailNumber })).toBeVisible();
  }

  // Add a race
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  // Enter only J1 as a finisher — S1 and S2 remain as non-finishers
  await page.getByLabel('Sail number').fill('J1');
  await page.getByRole('button', { name: 'Add' }).click();

  // Non-finishers should show fleet badges
  const s1Row = page.getByTestId('non-finisher-S1');
  const s2Row = page.getByTestId('non-finisher-S2');
  await expect(s1Row).toContainText('Senior');
  await expect(s2Row).toContainText('Senior');

  // The finisher (J1) also has a fleet badge in the finishing order — just verify non-finishers
  const j1NonFinisher = page.getByTestId('non-finisher-J1');
  await expect(j1NonFinisher).not.toBeVisible();
});

test('reorder works after CSV import creates multiple fleets in parallel (#90)', async ({ page }) => {
  // Regression: ensureFleet was not transactional, so parallel calls from a
  // single pipe-delimited CSV row could produce two fleets with the same
  // displayOrder. The Fleets card's ↑/↓ buttons used to swap displayOrder
  // values between rows, which became a no-op under a collision.
  await createSeriesQuick(page, { name: 'Fleet Reorder Regression' });

  const csv = [
    'sailNumber,name,club,fleet',
    '1,Alice,HYC,Alpha|Bravo',
  ].join('\n');
  await page
    .locator('input[type=file][accept=".csv,text/csv"]')
    .setInputFiles({ name: 'competitors.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: /Import 1 row/i }).click();
  await expect(page.getByRole('heading', { name: /import complete/i })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // Open Settings → Fleets
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const fleetsHeading = page.locator('h2', { hasText: 'Fleets' });
  await expect(fleetsHeading).toBeVisible();
  await fleetsHeading.locator('..').getByRole('button', { name: /Edit/ }).click();

  // Both fleets are present and both ↓/↑ buttons render
  const rows = page.getByTestId('fleet-row');
  await expect(rows).toHaveCount(2);
  const initial = await rows.allTextContents();
  expect(initial[0]).toMatch(/Alpha/);
  expect(initial[1]).toMatch(/Bravo/);

  // Click ↓ on Alpha (first row) — order must flip
  await rows.nth(0).getByTitle('Move down').click();
  await expect(async () => {
    const after = await rows.allTextContents();
    expect(after[0]).toMatch(/Bravo/);
    expect(after[1]).toMatch(/Alpha/);
  }).toPass();

  // And reversing it restores the original order
  await rows.nth(1).getByTitle('Move up').click();
  await expect(async () => {
    const after = await rows.allTextContents();
    expect(after[0]).toMatch(/Alpha/);
    expect(after[1]).toMatch(/Bravo/);
  }).toPass();
});

test('single-fleet series hides fleet concept', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Single Fleet Cup', venue: 'HYC' });

  // Add competitor with no fleet — goes to Default fleet
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('42');
  await page.getByLabel('Competitor name').fill('Alice');
  await page.getByLabel('Club').fill('HYC');
  // No fleet checkbox shown for single-fleet series
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: '42' })).toBeVisible();

  // Fleet column should NOT be visible for a single-fleet series
  await expect(page.getByRole('columnheader', { name: 'Fleet' })).not.toBeVisible();
});
