import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * A race can be inserted at an arbitrary position (a postponed re-sail, a
 * make-up race), renumbering the races after it. The inserted race lands in
 * the right slot and the order persists across a reload.
 */
test('insert a race mid-series renumbers the tail', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Insert Series', venue: 'Howth Yacht Club' });

  await page.getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);

  // Two named races: Race 1 Alpha, Race 2 Bravo.
  for (const [number, name] of [[1, 'Alpha'], [2, 'Bravo']] as const) {
    await page.getByRole('button', { name: 'Add race' }).click();
    await expect(page.getByText(`Race ${number}`, { exact: false })).toBeVisible();
    await page.getByText(`Race ${number}`, { exact: false }).first().click();
    await page.getByRole('button', { name: `Add a name for Race ${number}` }).click();
    const input = page.getByLabel(`Name for Race ${number}`);
    await input.fill(name);
    await input.press('Enter');
    await page.getByRole('link', { name: 'Races' }).click();
  }

  const rows = page.getByTestId('race-row');
  await expect(rows).toHaveCount(2);

  // Insert a race below Alpha → it becomes Race 2, Bravo slides to Race 3.
  await rows.filter({ hasText: 'Alpha' }).getByLabel(/^Insert a race near/).click();
  await page.getByRole('menuitem', { name: 'Insert race below' }).click();

  await expect(rows).toHaveCount(3);
  await expect(async () => {
    const order = (await rows.allTextContents()).map((t) => t.trim());
    expect(order[0]).toMatch(/Race 1.*Alpha/);
    expect(order[1]).toMatch(/Race 2/);
    expect(order[1]).not.toMatch(/Alpha|Bravo/);
    expect(order[2]).toMatch(/Race 3.*Bravo/);
  }).toPass();

  // Persisted across a reload.
  await page.reload();
  await expect(rows).toHaveCount(3);
  const reloaded = (await rows.allTextContents()).map((t) => t.trim());
  expect(reloaded[0]).toMatch(/Race 1.*Alpha/);
  expect(reloaded[2]).toMatch(/Race 3.*Bravo/);
});
