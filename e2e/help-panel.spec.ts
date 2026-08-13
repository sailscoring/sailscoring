import { signedInTest as test, expect } from './fixtures';

import { createSeriesQuick } from './helpers';

/**
 * The help panel reads chapters beside the working screen instead of
 * navigating away from it. What matters in every assertion below is that the
 * working screen is still there, still on its own URL, while help is open.
 */
test('help opens beside the working screen and minimises back to it', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Panel Test Series' });
  const workingUrl = page.url();
  const panel = page.getByTestId('help-panel');

  // Nothing until asked for.
  await expect(panel).toHaveCount(0);

  await page.getByRole('button', { name: 'Help' }).click();
  await expect(panel).toHaveAttribute('data-state', 'open');
  // The index lists chapters from the manifest. The chapter and its
  // same-named opening section are both buttons; the chapter comes first.
  await expect(panel.getByRole('button', { name: 'Entering results' }).first()).toBeVisible();
  // The screen the panel is sitting beside is pinned to the top: this is the
  // competitors tab of a new series.
  await expect(panel.getByText('For this page')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Adding competitors' })).toHaveCount(2);

  // Into a section — and the working screen has not moved.
  await panel.getByRole('button', { name: 'Redress (RDG)' }).click();
  await expect(panel.getByRole('heading', { name: 'Redress (RDG)' })).toBeVisible();
  expect(page.url()).toBe(workingUrl);
  await expect(page.getByRole('heading', { name: 'Panel Test Series' })).toBeVisible();

  // Minimised, the panel keeps its place: bringing it back lands on the same
  // chapter, not the index.
  await panel.getByRole('button', { name: 'Minimise help' }).click();
  await expect(panel).toHaveAttribute('data-state', 'minimised');
  await page.getByTestId('help-restore').click();
  await expect(panel).toHaveAttribute('data-state', 'open');
  await expect(panel.getByRole('heading', { name: 'Redress (RDG)' })).toBeVisible();

  // Back to the index, and out again with the keyboard.
  await panel.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Publishing', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveAttribute('data-state', 'minimised');

  // `h` reopens from anywhere in the app.
  await page.keyboard.press('h');
  await expect(panel).toHaveAttribute('data-state', 'open');

  // The panel survives moving around the app.
  await page.getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);
  await expect(panel).toHaveAttribute('data-state', 'open');
});

test('the panel keeps help links inside itself, and offers the page for a tab', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Help' }).click();
  const panel = page.getByTestId('help-panel');

  // The opening sections are reachable as a chapter of their own.
  await panel.getByRole('button', { name: 'Signing in and workspaces' }).click();
  await expect(panel.getByRole('heading', { name: 'Signing in and workspaces' })).toBeVisible();

  // A cross-reference inside the prose moves the panel, not the app.
  await panel.getByRole('link', { name: 'Working with co-scorers' }).click();
  await expect(panel.getByRole('heading', { name: 'Working with co-scorers' })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);

  // Open as a page still points at the real, shareable URL.
  await expect(panel.getByRole('link', { name: 'Open as a page' })).toHaveAttribute(
    'href',
    '/help/collaboration#collaboration',
  );
});

test('the docked panel can be widened, and the page keeps its room', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Help' }).click();
  const panel = page.getByTestId('help-panel');
  const before = (await panel.boundingBox())!;

  await page.getByTestId('help-resize').focus();
  await page.keyboard.press('ArrowLeft');
  const after = (await panel.boundingBox())!;
  expect(after.width).toBeCloseTo(before.width + 32, 0);

  // The page reserves the panel's width rather than sitting under it, so
  // the working screen is still fully visible. The reserved padding eases
  // in, so let it settle before measuring.
  await expect
    .poll(async () => {
      const main = (await page.locator('main').boundingBox())!;
      return main.x + main.width;
    })
    .toBeLessThanOrEqual(after.x + 1);
});

test('the /help pages keep their plain link and grow no panel', async ({ page }) => {
  await page.goto('/help');
  // On the help pages the header control is the link it always was — a panel
  // here would duplicate every section id in the document.
  await expect(page.getByRole('link', { name: 'Help', exact: true })).toBeVisible();
  await page.keyboard.press('h');
  await expect(page.getByTestId('help-panel')).toHaveCount(0);
});
