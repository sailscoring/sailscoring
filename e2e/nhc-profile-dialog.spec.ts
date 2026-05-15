import { test, expect } from './fixtures';
import { createFleets, createSeriesQuick, setScoringMode } from './helpers';

/**
 * E2E for the per-fleet NHC profile override dialog (#143). Covers the UI
 * loop: open Configure on an NHC fleet, edit the blend rates, save, reopen
 * and verify the values persisted. The collapsed Fleets summary should
 * also pick up the "custom" annotation.
 *
 * Algorithmic propagation is covered by the YAML fixture
 * `tests/fixtures/scoring/nhc/06-custom-profile.yaml` and unit tests; this
 * spec stays focused on the settings flow.
 */
test('NHC profile dialog: edit, save, persist, reopen', async ({ page }) => {
  await createSeriesQuick(page, { name: 'NHC Profile Test 2026' });
  await createFleets(page, ['NHC']);
  await setScoringMode(page, 'handicap');

  // Open Fleets card, switch the fleet to NHC.
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'NHC' }).click();

  // Stock NHC → Configure… button visible (not "NHC · custom").
  const configure = page.getByRole('button', { name: 'Configure…' });
  await expect(configure).toBeVisible();
  await configure.click();

  // Dialog open: defaults match DEFAULT_NHC_PROFILE.
  await expect(page.getByText(/NHC parameters/)).toBeVisible();
  await expect(page.getByTestId('nhc-profile-alphaP')).toHaveValue('0.3');
  await expect(page.getByTestId('nhc-profile-alphaN')).toHaveValue('0.15');

  // Aggressive overrides (matches the #143 experiment).
  await page.getByTestId('nhc-profile-alphaP').fill('0.5');
  await page.getByTestId('nhc-profile-alphaN').fill('0.3');
  await page.getByTestId('nhc-profile-alphaPX').fill('0.25');
  await page.getByTestId('nhc-profile-alphaNX').fill('0.15');
  await page.getByRole('button', { name: 'Save' }).click();

  // Button label flips to "NHC · custom".
  await expect(page.getByRole('button', { name: 'NHC · custom' })).toBeVisible();

  // Collapse and re-expand the Fleets card; summary annotates custom NHC.
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText(/\(NHC, custom\)/)).toBeVisible();

  // Reopen the dialog and check the values stuck.
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('button', { name: 'NHC · custom' }).click();
  await expect(page.getByTestId('nhc-profile-alphaP')).toHaveValue('0.5');
  await expect(page.getByTestId('nhc-profile-alphaN')).toHaveValue('0.3');
  await expect(page.getByTestId('nhc-profile-alphaPX')).toHaveValue('0.25');
  await expect(page.getByTestId('nhc-profile-alphaNX')).toHaveValue('0.15');

  // Restore defaults clears the override (button returns to "Configure…").
  await page.getByRole('button', { name: 'Restore defaults' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Configure…' })).toBeVisible();
});
