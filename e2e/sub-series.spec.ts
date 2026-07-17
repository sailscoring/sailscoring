import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, enableFeatures } from './helpers';

/**
 * Sub-series happy path (#203): on the Races tab create two sub-series as
 * named race selections, score each independently on the Standings tab (its
 * own discards and entrants, block-local race numbering), and publish one page
 * per sub-series.
 *
 * Series: "Frostbite 2026", 4 boats, 3 races — Winter selects R1–R2, Spring R3.
 *
 *   Winter R1: 1001=1, 1002=2, 1003=3, 1004=4
 *   Winter R2: 1001=1, 1002=2, 1003=3, 1004 absent → DNC = entrants(4)+1 = 5
 *     Winter totals: A=2, B=4, C=6, D=9
 *   Spring R3: 1003=1, 1001=2 — Spring has "rank only boats that took part" set,
 *     so Bob (1002) and Dave (1004), who never sailed it, are not in its standings.
 */

const competitors = [
  { sailNumber: '1001', name: 'Alice Murphy' },
  { sailNumber: '1002', name: 'Bob Kelly' },
  { sailNumber: '1003', name: 'Carol Ryan' },
  { sailNumber: '1004', name: 'Dave Walsh' },
];

test('sub-series: select races, per-block standings, publish per block', async ({ page, signedInEmail }) => {
  // Long setup (4 boats, 3 races with finishes, 2 sub-series, publish): under
  // full-suite load the default 30s cap is not enough.
  test.slow();
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

  // ── 2. Create Winter (R1–R2) + Spring (R3) by race selection ─────────────
  const newSubSeries = async (name: string, raceNumbers: number[], excludeDnc = false) => {
    await page.getByRole('button', { name: 'New sub-series' }).click();
    const dialog = page.getByRole('dialog', { name: 'New sub-series' });
    await dialog.getByLabel('Name', { exact: true }).fill(name);
    for (const n of raceNumbers) {
      await dialog.getByRole('checkbox', { name: new RegExp(`Race ${n}\\b`) }).check();
    }
    if (excludeDnc) await dialog.getByRole('checkbox', { name: /Rank only boats that took part/ }).check();
    await dialog.getByRole('button', { name: 'Create sub-series' }).click();
    await expect(dialog).toBeHidden();
  };
  await newSubSeries('Winter', [1, 2]);
  // Spring ranks only its participants (the opt-in), so Bob and Dave — who never
  // sailed it — stay off the Spring table rather than scoring DNC.
  await newSubSeries('Spring', [3], true);

  // The Sub-series panel lists both with their race counts. Edit round-trips.
  const panel = page.getByText('Sub-series', { exact: true }).locator('..');
  await expect(panel.getByText('Winter')).toBeVisible();
  await expect(panel.getByText('2 races')).toBeVisible();
  await expect(panel.getByText('1 race', { exact: false })).toBeVisible();

  // ── 3. Finishes either side of the boundary ──────────────────────────────
  const enterRace = async (raceLabel: string, sails: string[]) => {
    await page.getByText(raceLabel, { exact: false }).first().click();
    await expect(page.getByLabel('Sail number')).toBeVisible();
    for (const sail of sails) {
      await page.getByLabel('Sail number').fill(sail);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
    }
    await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
    await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
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

test('sub-series: "rank only boats that took part" toggle persists', async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['sub-series']);
  await createSeriesQuick(page, { name: 'DNC Toggle 2026', venue: 'HYC' });

  await page.getByRole('link', { name: 'Races' }).click();
  for (let n = 1; n <= 2; n++) {
    await page.getByRole('button', { name: 'Add race' }).click();
    await expect(page.getByText(`Race ${n}`)).toBeVisible();
  }

  // Create a sub-series with the toggle on.
  await page.getByRole('button', { name: 'New sub-series' }).click();
  let dialog = page.getByRole('dialog', { name: 'New sub-series' });
  await dialog.getByLabel('Name', { exact: true }).fill('Series A');
  await dialog.getByRole('checkbox', { name: /Race 1\b/ }).check();
  await dialog.getByRole('checkbox', { name: /Rank only boats that took part/ }).check();
  await dialog.getByRole('button', { name: 'Create sub-series' }).click();
  await expect(dialog).toBeHidden();

  // Reopen the editor; the toggle survived the round-trip through the API.
  await page.getByRole('button', { name: 'Edit sub-series Series A' }).click();
  dialog = page.getByRole('dialog', { name: 'Edit sub-series' });
  await expect(dialog.getByRole('checkbox', { name: /Rank only boats that took part/ })).toBeChecked();
});
