import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick, enableFeatures, setScoringMode } from './helpers';

/**
 * Experimental-feature gating (#155). A fresh user's personal workspace has no
 * features, so the gated affordances must be absent; enabling a feature (here
 * via the personal-workspace seeding helper, mirroring an org grant under
 * Model B) must reveal it. NHC *scoring* stays GA throughout — only the custom
 * per-fleet parameters are gated.
 */
test.describe('experimental feature gating (#155)', () => {
  test('gated affordances are hidden in a personal workspace by default', async ({ page }) => {
    // Home import dialog: no Sailwave option (Sail Scoring file stays).
    await page.goto('/');
    await page.getByRole('button', { name: 'Import Series' }).click();
    const dialog = page.getByRole('dialog', { name: 'Import Series' });
    await expect(dialog.getByTestId('import-format-sailscoring')).toBeVisible();
    await expect(dialog.getByTestId('import-format-sailwave')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Workspace settings: no FTP card.
    await page.goto('/workspace');
    await expect(page.getByRole('heading', { name: /Workspace settings/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add server' })).toHaveCount(0);

    // Help: no finish-sheet-CSV table-of-contents entry.
    await page.goto('/help');
    await expect(
      page.getByRole('link', { name: 'Importing a finish sheet from a spreadsheet' }),
    ).toHaveCount(0);

    // Fleets settings: ECHO is on by default (the seeded sample series uses it),
    // so its scoring option is present; NHC stays selectable but its
    // custom-parameters Configure… button is gated.
    await createSeriesQuick(page, { name: 'Gating Defaults 2026' });
    await createFleets(page, ['Fleet']);
    await setScoringMode(page, 'handicap');
    await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
    await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
    await expect(page.getByRole('option', { name: 'ECHO' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'NHC' })).toBeVisible();
    await page.getByRole('option', { name: 'NHC' }).click();
    await expect(page.getByRole('button', { name: 'Configure…' })).toHaveCount(0);
  });

  test('enabling features reveals their affordances', async ({ page, signedInEmail }) => {
    // echo is on by default — no need to enable it here.
    await enableFeatures(page, signedInEmail, [
      'sailwave-import',
      'ftp-upload',
      'csv-finish-import',
      'nhc-parameters',
    ]);

    await page.goto('/');
    await page.getByRole('button', { name: 'Import Series' }).click();
    await expect(page.getByTestId('import-format-sailwave')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.goto('/workspace');
    await expect(page.getByRole('button', { name: 'Add server' })).toBeVisible();

    await page.goto('/help');
    await expect(
      page.getByRole('link', { name: 'Importing a finish sheet from a spreadsheet' }),
    ).toBeVisible();

    await createSeriesQuick(page, { name: 'Gating Enabled 2026' });
    await createFleets(page, ['Fleet']);
    await setScoringMode(page, 'handicap');
    await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
    await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
    await expect(page.getByRole('option', { name: 'ECHO' })).toBeVisible();
    await page.getByRole('option', { name: 'NHC' }).click();
    await expect(page.getByRole('button', { name: 'Configure…' })).toBeVisible();
  });

  test('owner can self-disable a feature from the Features card (#278)', async ({
    page,
  }) => {
    // The signed-in user owns their personal workspace, so the Features card is
    // present. logo-library is default-on, so the Logos library card renders —
    // that heading is the observable proxy for the feature being effective.
    await page.goto('/workspace');
    await expect(page.getByRole('heading', { name: 'Features' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Logo library' }),
    ).toBeVisible();

    // Turn logo-library off; after the metadata write + refresh the Logos card
    // is gone. Operator-managed features (ftp-upload) never appear as a toggle.
    await expect(
      page.getByTestId('feature-toggle-ftp-upload'),
    ).toHaveCount(0);
    await page.getByTestId('feature-toggle-logo-library').click();
    await expect(
      page.getByRole('heading', { name: 'Logo library' }),
    ).toHaveCount(0);

    // And back on again.
    await page.getByTestId('feature-toggle-logo-library').click();
    await expect(
      page.getByRole('heading', { name: 'Logo library' }),
    ).toBeVisible();
  });
});
