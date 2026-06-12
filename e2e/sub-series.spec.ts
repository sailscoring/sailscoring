import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, enableFeatures } from './helpers';

/**
 * Sub-series happy path (#203): split a series into named blocks on the
 * Races tab, score each block independently on the Standings tab (its own
 * discards and entrants, block-local race numbering), and publish one page
 * per block.
 *
 * Series: "Frostbite 2026", 4 boats, 3 races split Winter (R1–R2) + Spring (R3).
 *
 *   Winter R1: 1001=1, 1002=2, 1003=3, 1004=4
 *   Winter R2: 1001=1, 1002=2, 1003=3, 1004 absent → DNC = entrants(4)+1 = 5
 *     Winter totals: A=2, B=4, C=6, D=9
 *   Spring R3: 1003=1, 1001=2 — only two boats enter the block, so Bob (1002)
 *     and Dave (1004) are not in the Spring standings at all.
 */

const competitors = [
  { sailNumber: '1001', name: 'Alice Murphy' },
  { sailNumber: '1002', name: 'Bob Kelly' },
  { sailNumber: '1003', name: 'Carol Ryan' },
  { sailNumber: '1004', name: 'Dave Walsh' },
];

test('sub-series: split, per-block standings, publish per block', async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['sub-series']);

  // ── 1. Series, competitors, races ────────────────────────────────────────
  await createSeriesQuick(page, { name: 'Frostbite 2026', venue: 'HYC' });
  for (const c of competitors) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sailNumber })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  for (let n = 1; n <= 3; n++) {
    await page.getByRole('button', { name: 'Add race' }).click();
    await expect(page.getByText(`Race ${n}`)).toBeVisible();
  }

  // ── 2. Split into Winter (R1–R2) + Spring (R3) ───────────────────────────
  await page.getByRole('button', { name: 'Start a new sub-series at Race 3' }).click();
  const splitDialog = page.getByRole('dialog', { name: 'Start a new sub-series at Race 3' });
  await splitDialog.getByLabel('Name', { exact: true }).fill('Spring');
  // First split of a blockless series: the earlier races need a name too.
  await splitDialog.getByLabel('Name for Races 1–2').fill('Winter');
  await splitDialog.getByRole('button', { name: 'Create sub-series' }).click();

  await expect(page.getByRole('heading', { name: /Winter/ })).toContainText('2 races');
  await expect(page.getByRole('heading', { name: /Spring/ })).toContainText('1 race');

  // Rename round-trips from the block header.
  await page.getByRole('button', { name: 'Rename sub-series Winter' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Deep Winter');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Deep Winter/ })).toBeVisible();
  await page.getByRole('button', { name: 'Rename sub-series Deep Winter' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Winter');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Winter/ })).toBeVisible();

  // ── 3. Finishes either side of the boundary ──────────────────────────────
  const enterRace = async (raceLabel: string, sails: string[]) => {
    await page.getByText(raceLabel, { exact: false }).first().click();
    await expect(page.getByText(`${raceLabel} — results`)).toBeVisible();
    for (const sail of sails) {
      await page.getByLabel('Sail number').fill(sail);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
    }
    await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
    await page.getByTestId('back-to-races').click();
    await expect(page).toHaveURL(/\/races$/);
  };
  await enterRace('Race 1', ['1001', '1002', '1003', '1004']);
  await enterRace('Race 2', ['1001', '1002', '1003']);
  await enterRace('Race 3', ['1003', '1001']);

  // ── 4. Per-block standings ───────────────────────────────────────────────
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);

  // Both blocks have finishes, so the default tab is the last one — Spring.
  await expect(page.getByRole('tab', { name: 'Winter' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Spring' })).toBeVisible();
  await expect(page.getByText('1 race · Low Point · No discards · 2 entrants')).toBeVisible();

  // Spring: Carol 1st, Alice 2nd; Bob and Dave aren't entrants. The lone
  // race column is the block-local R1, not the series-wide R3.
  await expect(page.getByRole('columnheader', { name: 'R1' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'R3' })).toHaveCount(0);
  const springRows = page.getByRole('row');
  await expect(springRows.filter({ hasText: 'Carol Ryan' })).toContainText('1');
  await expect(springRows.filter({ hasText: 'Bob Kelly' })).toHaveCount(0);
  await expect(springRows.filter({ hasText: 'Dave Walsh' })).toHaveCount(0);

  // Winter: all four boats; Dave's missed race scores entrants + 1 = 5.
  await page.getByRole('tab', { name: 'Winter' }).click();
  await expect(page.getByText('2 races · Low Point · No discards · 4 entrants')).toBeVisible();
  const winterRows = page.getByRole('row');
  const dave = winterRows.filter({ hasText: 'Dave Walsh' });
  await expect(dave).toContainText('DNC');
  await expect(dave.getByRole('cell').last()).toContainText('9');
  const alice = winterRows.filter({ hasText: 'Alice Murphy' });
  await expect(alice.getByRole('cell').last()).toContainText('2');

  // ── 5. Publish: one page per block ───────────────────────────────────────
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await expect(dialog).toBeVisible();
  // Blocked series: pages are per sub-series, no single-path editor.
  await expect(dialog.getByText(/Each sub-series publishes its own page/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();

  // The dialog links the series index, which lists both block pages.
  const link = dialog.getByRole('link', { name: /\/p\// });
  await expect(link).toBeVisible();
  const indexPath = new URL((await link.getAttribute('href')) ?? '').pathname;
  expect(indexPath).toMatch(/\/p\/[^/]+\/frostbite-2026$/);

  await page.goto(indexPath);
  await expect(page.getByRole('heading', { name: 'Winter' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Spring' })).toBeVisible();

  // The Winter page lives one segment down and renders the block standings.
  await page.goto(`${indexPath}/winter/standings`);
  await expect(page.getByText('Frostbite 2026 — Winter').first()).toBeVisible();
  await expect(page.getByText('Dave Walsh').first()).toBeVisible();

  // The Spring page only lists its entrants.
  await page.goto(`${indexPath}/spring/standings`);
  await expect(page.getByText('Frostbite 2026 — Spring').first()).toBeVisible();
  await expect(page.getByText('Carol Ryan').first()).toBeVisible();
  await expect(page.getByText('Bob Kelly')).toHaveCount(0);
});
