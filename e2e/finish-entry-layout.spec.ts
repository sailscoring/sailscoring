import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick } from './helpers';

/**
 * E2E for the adaptive finish-entry layout (issue #225).
 *
 * The Finishing order / Non-finishers split is no longer a fixed 50/50:
 *  - when there are no non-finishers, the panel disappears and the finishing
 *    order spans the full width (no blank half on a completed race);
 *  - while non-finishers remain, the panel can be collapsed and re-shown so the
 *    scorer can reclaim the width mid-entry.
 *
 * A scratch series (no start times) also doubles as coverage that no
 * finish-time column is rendered when the race has no times (#225 option C).
 */

const boats = [
  { sailNumber: 'A1', name: 'Alice' },
  { sailNumber: 'B2', name: 'Bob' },
  { sailNumber: 'C3', name: 'Carol' },
];

test('finish entry: adaptive non-finishers panel + collapse toggle', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Adaptive Layout 2026', venue: 'HYC' });

  for (const b of boats) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(b.sailNumber);
    await page.getByLabel('Competitor name').fill(b.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: b.sailNumber })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  const nonFinishersHeading = page.getByRole('heading', { name: /Non-finishers/ });

  // Finish two of three — one boat stays in the non-finishers panel.
  for (const sail of ['A1', 'B2']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: sail })).toBeVisible();
  }
  await expect(nonFinishersHeading).toBeVisible();
  await expect(page.getByTestId('non-finisher-C3')).toBeVisible();

  // Scratch race — no finish-time column on any row.
  await expect(page.getByLabel(/^Finish time for/)).toHaveCount(0);

  // Collapse the panel → heading gone, a "Non-finishers (1)" toggle appears.
  await page.getByRole('button', { name: 'Collapse non-finishers' }).click();
  await expect(nonFinishersHeading).toHaveCount(0);
  const showButton = page.getByRole('button', { name: 'Non-finishers (1)' });
  await expect(showButton).toBeVisible();

  // Re-show it.
  await showButton.click();
  await expect(nonFinishersHeading).toBeVisible();

  // Finish the last boat → no non-finishers → the whole panel disappears.
  await page.getByLabel('Sail number').fill('C3');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'C3' })).toBeVisible();
  await expect(nonFinishersHeading).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Non-finishers/ })).toHaveCount(0);
});

test('non-finishers: did-not-compete boats sink below recorded results', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Non-finisher Split 2026', venue: 'HYC' });

  for (const b of boats) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(b.sailNumber);
    await page.getByLabel('Competitor name').fill(b.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: b.sailNumber })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  // Finish A1 → B2 and C3 are non-finishers, both auto-DNC. No divider yet.
  await page.getByLabel('Sail number').fill('A1');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'A1' })).toBeVisible();
  await expect(page.getByTestId('non-finisher-B2')).toBeVisible();
  await expect(page.getByTestId('non-finisher-C3')).toBeVisible();
  const divider = page.getByText(/^Did not compete \(/);
  await expect(divider).toHaveCount(0);

  // Code B2 as RET → it becomes a recorded result and the two groups split,
  // with C3 alone under the "Did not compete" divider.
  await page.getByTestId('non-finisher-B2').getByRole('combobox').click();
  await page.getByRole('option', { name: 'RET' }).click();
  await expect(page.getByText('Did not compete (1)')).toBeVisible();

  // B2 (recorded) sits above the divider; C3 (auto-DNC) below it.
  const b2Box = await page.getByTestId('non-finisher-B2').boundingBox();
  const dividerBox = await page.getByText('Did not compete (1)').boundingBox();
  const c3Box = await page.getByTestId('non-finisher-C3').boundingBox();
  expect(b2Box!.y).toBeLessThan(dividerBox!.y);
  expect(dividerBox!.y).toBeLessThan(c3Box!.y);
});

test('non-finishers: a long fleet name stays inside the panel', async ({ page }) => {
  const longFleet = 'Cruisers 1 IRC White Sail Division';

  await createSeriesQuick(page, { name: 'Long Fleet Label 2026', venue: 'HYC' });
  await createFleets(page, [longFleet]);

  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('IRL 1234');
  await page.getByLabel('Competitor name').fill('Aoife Ní Mhurchú-Fitzgerald');
  // Sole fleet — the competitor is auto-assigned to it, so there is no fleet
  // checkbox to tick.
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'IRL 1234' })).toBeVisible();

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  // Nobody has finished, so the boat sits in the non-finishers panel — the
  // narrow half of the split, where the badge used to push the row's contents
  // out past the right-hand edge.
  const row = page.getByTestId('non-finisher-IRL 1234');
  await expect(row).toBeVisible();

  // Narrow viewports squeeze the panel hardest; check the widest and the
  // narrowest the two-column split is used at.
  for (const width of [1280, 900]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await row.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow, `row overflows at ${width}px`).toBeLessThanOrEqual(1);

    const rowBox = (await row.boundingBox())!;
    const badgeBox = (await row.getByText(longFleet).boundingBox())!;
    expect(badgeBox.x + badgeBox.width, `badge escapes the row at ${width}px`)
      .toBeLessThanOrEqual(rowBox.x + rowBox.width + 1);
  }
});

test('non-finishers: filter narrows the panel to assign a code', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Non-finisher Filter 2026', venue: 'HYC' });

  for (const b of boats) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(b.sailNumber);
    await page.getByLabel('Competitor name').fill(b.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: b.sailNumber })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  // No finishers yet — every boat is a non-finisher, so the panel is up.
  const filterInput = page.getByLabel('Filter non-finishers');
  await expect(filterInput).toBeVisible();

  // `/` focuses the filter (pressed with focus outside any input).
  await page.getByRole('heading', { name: /Non-finishers/ }).click();
  await page.keyboard.press('/');
  await expect(filterInput).toBeFocused();

  // Filter by helm name → only Bob's boat remains, heading shows "1 of 3".
  await filterInput.fill('bob');
  await expect(page.getByTestId('non-finisher-B2')).toBeVisible();
  await expect(page.getByTestId('non-finisher-A1')).toHaveCount(0);
  await expect(page.getByTestId('non-finisher-C3')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Non-finishers/ })).toContainText('1 of 3');

  // Assign RET to the surviving row — the filter stays, the row stays visible
  // with its new code.
  await page.getByTestId('non-finisher-B2').getByRole('combobox').click();
  await page.getByRole('option', { name: 'RET' }).click();
  await expect(page.getByTestId('non-finisher-B2').getByRole('combobox')).toContainText('RET');
  await expect(filterInput).toHaveValue('bob');

  // A filter that matches nothing shows the empty state, not a bare panel.
  await filterInput.fill('zzz');
  await expect(page.getByText('No non-finishers match “zzz”.')).toBeVisible();

  // Escape clears the filter — all boats return, and the page-level
  // Escape-to-leave must NOT fire (we stay on the race).
  await filterInput.press('Escape');
  await expect(page.getByTestId('non-finisher-A1')).toBeVisible();
  await expect(page.getByTestId('non-finisher-C3')).toBeVisible();
  await expect(page.getByText('Race 1 — results')).toBeVisible();
  await expect(page.getByTestId('non-finisher-B2').getByRole('combobox')).toContainText('RET');
});
