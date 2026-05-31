import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, keyboardReorder } from './helpers';

/**
 * Drag-reorder of the active series list (#171). New series append to the
 * bottom, so creation order is top-to-bottom; dragging rewrites that order and
 * it persists across a reload.
 */
test('series can be drag-reordered and the order persists', async ({ page }) => {
  for (const name of ['Reorder Alpha', 'Reorder Bravo', 'Reorder Charlie']) {
    await createSeriesQuick(page, { name });
  }

  await page.goto('/');
  const rows = page.getByTestId('series-row');
  await expect(rows).toHaveCount(3);

  // Created in order → appended to the bottom → top-to-bottom is creation order.
  const order = async () => (await rows.allTextContents()).map((t) => t.trim());
  const initial = await order();
  expect(initial[0]).toMatch(/Alpha/);
  expect(initial[1]).toMatch(/Bravo/);
  expect(initial[2]).toMatch(/Charlie/);

  // Drag "Alpha" down two slots → Bravo, Charlie, Alpha.
  const handleFor = (name: string) =>
    rows.filter({ hasText: name }).getByLabel('Drag to reorder');
  await keyboardReorder(page, handleFor('Reorder Alpha'), 'ArrowDown', 2);

  await expect(async () => {
    const after = await order();
    expect(after[0]).toMatch(/Bravo/);
    expect(after[1]).toMatch(/Charlie/);
    expect(after[2]).toMatch(/Alpha/);
  }).toPass();

  // The new order survives a reload (persisted server-side).
  await page.reload();
  await expect(rows).toHaveCount(3);
  const reloaded = await order();
  expect(reloaded[0]).toMatch(/Bravo/);
  expect(reloaded[1]).toMatch(/Charlie/);
  expect(reloaded[2]).toMatch(/Alpha/);
});
