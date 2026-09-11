import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, keyboardReorder } from './helpers';

/**
 * Races can be reordered, and the renumbering persists. Races are named so we
 * can track each across the renumber (the position number changes, the name
 * doesn't). Covers both the keyboard drag (Sailwave's "move race") and the
 * Alt+↑/↓ nudge.
 */
test('races can be reordered and the renumbering persists', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Reorder Series', venue: 'Howth Yacht Club' });

  // Add three races and give each a stable name.
  await page.getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);
  for (const [number, name] of [[1, 'Alpha'], [2, 'Bravo'], [3, 'Charlie']] as const) {
    await page.getByRole('button', { name: 'Add race' }).click();
    await expect(page.getByText(`Race ${number}`, { exact: false })).toBeVisible();
    await page.getByText(`Race ${number}`, { exact: false }).first().click();
    await page.getByRole('button', { name: `Edit name for Race ${number}` }).click();
    const input = page.getByLabel(`Name for Race ${number}`);
    await input.fill(name);
    await input.press('Enter');
    // Wait for the save to land (editor collapses to the named button) before
    // navigating away — otherwise the navigation can abort the in-flight save.
    await expect(page.getByRole('button', { name: `Edit name for Race ${number}` })).toContainText(name);
    await page.getByRole('link', { name: 'Races' }).click();
  }

  const rows = page.getByTestId('race-row');
  await expect(rows).toHaveCount(3);
  const order = async () => (await rows.allTextContents()).map((t) => t.trim());

  // Initial order: Race 1 Alpha, Race 2 Bravo, Race 3 Charlie.
  const initial = await order();
  expect(initial[0]).toMatch(/Race 1.*Alpha/);
  expect(initial[2]).toMatch(/Race 3.*Charlie/);

  // Drag "Alpha" down two slots → Bravo, Charlie, Alpha (renumbered 1,2,3).
  const handleFor = (name: string) =>
    rows.filter({ hasText: name }).getByLabel(/^Reorder Race/);
  await keyboardReorder(page, handleFor('Alpha'), 'ArrowDown', 2);

  await expect(async () => {
    const after = await order();
    expect(after[0]).toMatch(/Race 1.*Bravo/);
    expect(after[1]).toMatch(/Race 2.*Charlie/);
    expect(after[2]).toMatch(/Race 3.*Alpha/);
  }).toPass();

  // Survives a reload (persisted server-side).
  await page.reload();
  await expect(rows).toHaveCount(3);
  const reloaded = await order();
  expect(reloaded[0]).toMatch(/Race 1.*Bravo/);
  expect(reloaded[2]).toMatch(/Race 3.*Alpha/);

  // Alt+↑ nudges "Alpha" (now last) one place earlier → Bravo, Alpha, Charlie.
  await rows.filter({ hasText: 'Alpha' }).focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(async () => {
    const after = await order();
    expect(after[1]).toMatch(/Race 2.*Alpha/);
    expect(after[2]).toMatch(/Race 3.*Charlie/);
  }).toPass();
});

/**
 * The race list is one stop in the Tab order, not four per row, and an action
 * that changes the list leaves focus somewhere useful rather than on <body>.
 */
test('the race list is one tab stop and keeps focus across a delete', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Roving Focus Series' });
  await page.getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Add race' }).click();
    await expect(page.getByTestId('race-row')).toHaveCount(i + 1);
  }
  const rows = page.getByTestId('race-row');

  const focusIsInTheList = () =>
    page.evaluate(() => {
      const active = document.activeElement;
      return Boolean(active?.closest('[data-testid="race-row"]'));
    });

  // One Tab out of the middle row leaves the list entirely — the drag handle,
  // actions trigger and delete button are all out of the tab order.
  await rows.nth(1).focus();
  expect(await focusIsInTheList()).toBe(true);
  await page.keyboard.press('Tab');
  expect(await focusIsInTheList()).toBe(false);

  // `l` goes back in, to the row left rather than to the first.
  await page.keyboard.press('l');
  await expect(rows.nth(1)).toBeFocused();

  // `a` opens that row's actions menu, which the mouse would otherwise own.
  await page.keyboard.press('a');
  await expect(page.getByRole('menuitem', { name: 'Insert race above' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Deleting leaves focus on the row that took the deleted one's place.
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press('d');
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toBeFocused();
});
