import { signedInTest as test, expect } from './fixtures';

/**
 * On-enable feature demo seeding (#256). When a scorer switches on a feature
 * that ships a worked example, the demo is seeded into their workspace at that
 * moment — so they land on a live, editable series rather than an empty
 * affordance. Sub-series is the first such feature (club-league.sailscoring).
 *
 * The e2e web server disables sign-up sample seeding, so the fresh workspace
 * starts empty and the only series to appear is the one the toggle seeds.
 */
test.describe('feature demo seeding (#256)', () => {
  test('enabling sub-series seeds an editable demo series', async ({ page }) => {
    // Empty to begin with — no demo until the feature is switched on. This
    // load also warms the client-side series-list cache, which the rest of
    // the test must see invalidated.
    await page.goto('/');
    await expect(
      page.getByRole('link', { name: 'Sample Club League 2026' }),
    ).toHaveCount(0);

    // Turn sub-series on from the Workspace-settings Features card, reached
    // by client-side navigation — no full page load anywhere from here on.
    await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/workspace$/);
    const toggle = page.getByTestId('feature-toggle-sub-series');
    await toggle.click();
    // The switch reflecting "on" means the PATCH (which seeds server-side)
    // resolved and the effective feature set re-resolved.
    await expect(toggle).toBeChecked();

    // Back to the series list via its tab: the demo must show without a
    // reload — the toggle invalidates the cached series list, grouped under
    // "Samples".
    await page.getByRole('navigation').getByRole('link', { name: 'Series' }).click();
    const demo = page.getByRole('link', { name: 'Sample Club League 2026' });
    await expect(demo).toBeVisible();
    await demo.click();

    // Its sub-series are visible and editable — the feature is on, so the
    // authoring surface (the Sub-series panel + New button) renders.
    await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
    await expect(page).toHaveURL(/\/races$/);
    const panel = page.getByText('Sub-series', { exact: true }).locator('..');
    await expect(panel.getByText('Season Overall', { exact: true })).toBeVisible();
    await expect(panel.getByText('Spring Series', { exact: true })).toBeVisible();
    // The chain is reflected in the panel: Summer continues Spring.
    await expect(panel.getByText(/continues Spring Series/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'New sub-series' })).toBeVisible();

    // Standings render per block, so the season and its sub-series each score.
    await page.getByRole('navigation').getByRole('link', { name: 'Standings' }).click();
    await expect(page).toHaveURL(/\/standings$/);
    await expect(page.getByRole('tab', { name: 'Season Overall' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Summer Series' })).toBeVisible();
  });
});
