import { signedInTest as test, expect } from './fixtures';
import { addCompetitor, createFleets, createSeriesQuick, enableFeatures } from './helpers';

/**
 * E2E for series-scoped per-fleet race exclusions (#246): a scorer strikes a
 * race for one fleet directly from the standings column header.
 *
 * Two fleets (Blue, Red), two boats each, two races. Blue finishes in the same
 * order both races (BLU1, BLU2), so before any exclusion BLU1 = 2, BLU2 = 4.
 * Striking R2 for Blue from the column header drops it to BLU1 = 1, BLU2 = 2,
 * while Red — which keeps both races — is untouched. The strike persists across
 * a reload.
 */

const blue = [
  { sailNumber: 'BLU1', name: 'Blue One', fleet: 'Blue' },
  { sailNumber: 'BLU2', name: 'Blue Two', fleet: 'Blue' },
];
const red = [
  { sailNumber: 'RED1', name: 'Red One', fleet: 'Red' },
  { sailNumber: 'RED2', name: 'Red Two', fleet: 'Red' },
];

async function addRaceResults(page: import('@playwright/test').Page, raceName: string, order: string[]) {
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText(raceName, { exact: true }).click();
  await expect(page.getByLabel('Sail number')).toBeVisible();
  for (const sail of order) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: sail })).toBeVisible();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
}

test('exclude a race for one fleet from the standings column header', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Exclusion Cup' });
  await createFleets(page, ['Blue', 'Red']);

  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const c of [...blue, ...red]) await addCompetitor(page, c);

  // Both races: Blue finishes BLU1 then BLU2; Red finishes RED1 then RED2.
  await addRaceResults(page, 'Race 1', ['BLU1', 'BLU2', 'RED1', 'RED2']);
  await addRaceResults(page, 'Race 2', ['BLU1', 'BLU2', 'RED1', 'RED2']);

  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);

  // Scope to each fleet's own table by a boat it contains.
  const blueTable = page.getByRole('table').filter({ has: page.getByText('BLU1') });
  const redTable = page.getByRole('table').filter({ has: page.getByText('RED1') });
  const blu2Total = () => blueTable.getByRole('row').filter({ hasText: 'BLU2' }).getByRole('cell').last();
  const red2Total = () => redTable.getByRole('row').filter({ hasText: 'RED2' }).getByRole('cell').last();

  // Before exclusion: BLU2 = 2 + 2 = 4; RED2 = 2 + 2 = 4.
  await expect(blu2Total()).toHaveText('4');
  await expect(red2Total()).toHaveText('4');

  // Strike R2 for the Blue fleet from its column header. The menu names the
  // underlying race (here R2 is series-wide Race 2).
  await blueTable.getByRole('button', { name: 'R2', exact: true }).click();
  await expect(page.getByRole('menu').getByText('Race 2', { exact: false })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Exclude from this fleet' }).click();

  // Blue R2 no longer counts: BLU2 drops to 2, BLU1 to 1. Red is untouched.
  await expect(blu2Total()).toHaveText('2');
  await expect(blueTable.getByRole('row').filter({ hasText: 'BLU1' }).getByRole('cell').last()).toHaveText('1');
  await expect(red2Total()).toHaveText('4');

  // The struck column is marked; the menu now offers the inverse action.
  await expect(blueTable.getByRole('columnheader').filter({ hasText: 'R2' })).toHaveClass(/line-through/);
  await blueTable.getByRole('button', { name: 'R2', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Include in this fleet' })).toBeVisible();
  await page.keyboard.press('Escape');

  // The exclusion persists across a reload.
  await page.reload();
  await expect(blu2Total()).toHaveText('2');
  await expect(red2Total()).toHaveText('4');
  await expect(blueTable.getByRole('columnheader').filter({ hasText: 'R2' })).toHaveClass(/line-through/);
});

test('an automatically-excluded race (no entrants) offers no manual toggle', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Auto Exclusion Cup' });
  await createFleets(page, ['Blue', 'Red']);

  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const c of [...blue, ...red]) await addCompetitor(page, c);

  await addRaceResults(page, 'Race 1', ['BLU1', 'BLU2', 'RED1', 'RED2']);
  // Race 2: only Red sails. Blue's boats are implicit DNC, so the race is
  // automatically excluded for Blue (nobody in the fleet came to the start).
  await addRaceResults(page, 'Race 2', ['RED1', 'RED2']);

  await page.getByRole('link', { name: 'Standings' }).click();
  const blueTable = page.getByRole('table').filter({ has: page.getByText('BLU1') });
  const redTable = page.getByRole('table').filter({ has: page.getByText('RED1') });

  // Blue R2 is struck (auto) even though it was never manually excluded.
  await expect(blueTable.getByRole('columnheader').filter({ hasText: 'R2' })).toHaveClass(/line-through/);

  // Its menu explains the automatic exclusion and offers no Exclude/Include.
  await blueTable.getByRole('button', { name: 'R2', exact: true }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByText('No entrants — excluded automatically')).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Exclude from this fleet' })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Include in this fleet' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Red actually sailed R2, so its header offers the normal manual action.
  await redTable.getByRole('button', { name: 'R2', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Exclude from this fleet' })).toBeVisible();
});

test('exclude a race for one fleet from a sub-series standings header', async ({ page, signedInEmail }) => {
  // The motivating case: a DBSC-style series always views its standings inside a
  // sub-series, so the header action must target the block's own exclusions.
  // Long by nature: four boats, three races each fully scored across two fleets,
  // and a sub-series before standings even render — under full-suite DB load the
  // setup can eat most of the 30s default, so give it the tripled budget.
  test.slow();
  await enableFeatures(page, signedInEmail, ['sub-series']);
  await createSeriesQuick(page, { name: 'Block Exclusion Cup' });
  await createFleets(page, ['Blue', 'Red']);

  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const c of [...blue, ...red]) await addCompetitor(page, c);

  // Three races, then a "Late" sub-series over races 2–3 only, so the block's
  // R1/R2 are series-wide Race 2/Race 3 — the exact renumbering that makes
  // "which race is this?" hard.
  await page.getByRole('link', { name: 'Races' }).click();
  for (let n = 1; n <= 3; n++) {
    await page.getByRole('button', { name: 'Add race' }).click();
    await expect(page.getByText(`Race ${n}`)).toBeVisible();
  }
  await page.getByRole('button', { name: 'New sub-series' }).click();
  const dialog = page.getByRole('dialog', { name: 'New sub-series' });
  await dialog.getByLabel('Name', { exact: true }).fill('Late');
  for (const n of [2, 3]) {
    await dialog.getByRole('checkbox', { name: new RegExp(`Race ${n}\\b`) }).check();
  }
  await dialog.getByRole('button', { name: 'Create sub-series' }).click();
  await expect(dialog).toBeHidden();

  await addRaceResults(page, 'Race 1', ['BLU1', 'BLU2', 'RED1', 'RED2']);
  await addRaceResults(page, 'Race 2', ['BLU1', 'BLU2', 'RED1', 'RED2']);
  await addRaceResults(page, 'Race 3', ['BLU1', 'BLU2', 'RED1', 'RED2']);

  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);
  // The Late block is auto-selected (its tab is shown). Allow a generous
  // window: rendering the standings runs the scoring engine over every race,
  // fleet, and sub-series, which under full-suite CPU load can outrun the
  // default expect timeout before the block tabs paint.
  await expect(page.getByRole('tab', { name: 'Late' })).toBeVisible({ timeout: 15_000 });

  const blueTable = page.getByRole('table').filter({ has: page.getByText('BLU1') });
  const redTable = page.getByRole('table').filter({ has: page.getByText('RED1') });
  const blu2Total = () => blueTable.getByRole('row').filter({ hasText: 'BLU2' }).getByRole('cell').last();
  const red2Total = () => redTable.getByRole('row').filter({ hasText: 'RED2' }).getByRole('cell').last();

  // Two block races (series-wide 2 & 3): BLU2 = 2 + 2 = 4.
  await expect(blu2Total()).toHaveText('4');

  // The block's R2 header is series-wide Race 3 — the menu names it so.
  await blueTable.getByRole('button', { name: 'R2', exact: true }).click();
  await expect(page.getByRole('menu').getByText('Race 3', { exact: false })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Exclude from this fleet' }).click();

  await expect(blu2Total()).toHaveText('2');
  await expect(red2Total()).toHaveText('4');
  await expect(blueTable.getByRole('columnheader').filter({ hasText: 'R2' })).toHaveClass(/line-through/);

  // Persists across a reload — and because the block standings read the
  // sub-series' own exclusions (not the series-level field), this also proves
  // the strike was written to the sub-series scope, not the whole series.
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Late' })).toBeVisible({ timeout: 15_000 });
  await expect(blu2Total()).toHaveText('2');
  await expect(red2Total()).toHaveText('4');
  await expect(blueTable.getByRole('columnheader').filter({ hasText: 'R2' })).toHaveClass(/line-through/);
});
