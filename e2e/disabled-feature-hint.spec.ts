import { signedInTest as test, expect } from './fixtures';

/**
 * Disabled-feature hint (#280). Feature gating hides a feature's authoring
 * card, not its data — so a series can carry sub-series (or combined-page)
 * config while the feature is off, leaving the scorer with rendered output and
 * no card to explain it. The Settings tab surfaces a hint pointing at the
 * Workspace-settings toggle.
 *
 * Setup uses the on-enable demo (#256): enabling sub-series seeds a series that
 * carries sub-series config, then switching it back off leaves exactly the
 * "config present, feature off" state the hint is for.
 */
test.describe('disabled-feature hint (#280)', () => {
  test('a series carrying sub-series config hints when the feature is off', async ({ page }) => {
    // Enable sub-series → seeds the demo (which carries sub-series config) …
    await page.goto('/workspace');
    const toggle = page.getByTestId('feature-toggle-sub-series');
    await toggle.click();
    await expect(toggle).toBeChecked();
    // … then switch it back off. The demo keeps its sub-series.
    await toggle.click();
    await expect(toggle).not.toBeChecked();

    // Open the demo's Settings tab: the hint explains what's hidden.
    await page.goto('/');
    await page.getByRole('link', { name: 'Sample Club League 2026' }).click();
    await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings$/);
    const settingsUrl = page.url();

    await expect(
      page.getByText(/isn.t enabled for this workspace/),
    ).toBeVisible();
    // The owner can act on it directly — the hint links to Workspace settings.
    const enableLink = page.getByRole('link', { name: 'Enable it in Workspace settings' });
    await expect(enableLink).toBeVisible();

    // Follow the link and re-enable; the marker means no second demo is seeded.
    await enableLink.click();
    await expect(page).toHaveURL(/\/workspace$/);
    const toggle2 = page.getByTestId('feature-toggle-sub-series');
    await toggle2.click();
    await expect(toggle2).toBeChecked();

    // Back on the series Settings tab, the hint is gone now the feature is on.
    await page.goto(settingsUrl);
    await expect(page.getByText(/isn.t enabled for this workspace/)).toHaveCount(0);
    // And only one demo was ever seeded.
    await page.goto('/');
    await expect(
      page.getByRole('link', { name: 'Sample Club League 2026' }),
    ).toHaveCount(1);
  });
});
