import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * The dev/CI Resend stub appends each magic-link issuance to this file as
 * a TSV: `<timestamp>\t<email>\t<url>`. Tests poll it after triggering a
 * sign-in to retrieve the link instead of going through real email.
 */
const MAGIC_LINKS_LOG = path.join(process.cwd(), 'tests', '.magic-links.log');

/**
 * Wait for the most recent magic-link issued to `forEmail` to appear in
 * the local TSV log and return its URL. Polls for ~5 seconds.
 */
export async function readLatestMagicLink(forEmail: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const content = await fs.readFile(MAGIC_LINKS_LOG, 'utf8');
      const lines = content.trim().split('\n').reverse();
      for (const line of lines) {
        const [, email, url] = line.split('\t');
        if (email === forEmail && url) return url;
      }
    } catch {
      // file may not exist yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No magic link found for ${forEmail}`);
}

/**
 * Sign a fresh user into the app via the magic-link flow. Used by every
 * server-mode e2e test — server mode has no anonymous browsing, so each
 * test starts from /sign-in and lands at /account before any series work.
 *
 * Returns the email that was used so callers can assert against it.
 */
export async function signInFreshUser(page: Page, prefix: string): Promise<string> {
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@sailscoring.test`;
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send magic link' }).click();
  const link = await readLatestMagicLink(email);
  await page.goto(link);
  await expect(page).toHaveURL(/\/account/);
  return email;
}

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
  data: { sailNumber: string; name: string; club?: string; fleet?: string; ircTcc?: string; pyNumber?: string; nhcStartingTcf?: string; echoStartingTcf?: string },
): Promise<void> {
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill(data.sailNumber);
  await page.getByLabel('Competitor name').fill(data.name);
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
  if (data.echoStartingTcf) await page.getByLabel('ECHO starting handicap', { exact: true }).fill(data.echoStartingTcf);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: data.sailNumber })).toBeVisible();
}
