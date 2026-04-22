import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Create a new series using the quick-create form (bypasses the wizard).
 * Returns after the page navigates to the competitors tab.
 */
export async function createSeriesQuick(
  page: Page,
  data: { name: string; venue?: string; date?: string },
): Promise<void> {
  await page.goto('/series/new?quick=1');
  await page.getByLabel('Name').fill(data.name);
  if (data.venue) await page.getByLabel('Venue').fill(data.venue);
  if (data.date) await page.getByLabel('Date').fill(data.date);
  await page.getByRole('button', { name: 'Create series' }).click();
  await expect(page).toHaveURL(/\/series\/[0-9a-f-]{36}\/competitors$/);
}

/**
 * Create fleets in Settings > Fleets for the current series.
 * Assumes the page is already within a series context (any series tab).
 */
export async function createFleets(page: Page, names: string[]): Promise<void> {
  // Navigate to Settings tab
  const settingsLink = page.getByRole('navigation').getByRole('link', { name: 'Settings' });
  await settingsLink.click();
  // Wait for settings page to load — look for a specific card heading
  await expect(page.locator('h2', { hasText: 'Fleets' })).toBeVisible();
  // Click the Edit button in the Fleets card row
  // The Fleets card has: <div flex><h2>Fleets</h2><Button>Edit ▸</Button></div>
  // Use the test-visible locator for the button next to "Fleets" heading
  const fleetsRow = page.locator('h2', { hasText: 'Fleets' }).locator('..');
  await fleetsRow.locator('button').click();
  // Now the Fleets card is expanded — add fleets
  for (const name of names) {
    await page.getByRole('button', { name: '+ Add fleet' }).click();
    await page.getByPlaceholder('Fleet name').fill(name);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Done' }).first().click();
}

/**
 * Set the series scoring mode in Settings > Scoring Mode.
 * Assumes the page is already within a series context (any series tab).
 */
export async function setScoringMode(page: Page, mode: 'scratch' | 'handicap'): Promise<void> {
  const settingsLink = page.getByRole('navigation').getByRole('link', { name: 'Settings' });
  await settingsLink.click();
  await expect(page.locator('h2', { hasText: 'Scoring mode' })).toBeVisible();
  const scoringRow = page.locator('h2', { hasText: 'Scoring mode' }).locator('..');
  await scoringRow.getByRole('button', { name: /Edit/ }).click();
  const label = mode === 'handicap' ? 'Handicap (time-corrected)' : 'Scratch (position-based)';
  await page.getByText(label).click();
  await page.getByRole('button', { name: 'Done' }).click();
}

/**
 * Add a competitor using the competitor form.
 * Assumes the page is on the Competitors tab with the Add form open or about to be opened.
 * If fleet is specified and multiple fleets exist, checks the fleet checkbox.
 */
export async function addCompetitor(
  page: Page,
  data: { sailNumber: string; name: string; club?: string; fleet?: string; ircTcc?: string; pyNumber?: string; nhcStartingTcf?: string },
): Promise<void> {
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill(data.sailNumber);
  await page.getByLabel('Helm name').fill(data.name);
  if (data.club) await page.getByLabel('Club').fill(data.club);
  if (data.fleet) {
    // Check the fleet checkbox — only visible when multiple fleets exist
    const checkbox = page.getByRole('checkbox', { name: data.fleet });
    if (await checkbox.isVisible()) {
      await checkbox.check();
    }
  }
  if (data.ircTcc) await page.getByLabel('IRC TCC', { exact: true }).fill(data.ircTcc);
  if (data.pyNumber) await page.getByLabel('PY number', { exact: true }).fill(data.pyNumber);
  if (data.nhcStartingTcf) await page.getByLabel('NHC starting TCF', { exact: true }).fill(data.nhcStartingTcf);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: data.sailNumber })).toBeVisible();
}
