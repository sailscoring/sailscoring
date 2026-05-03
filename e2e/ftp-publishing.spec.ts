import { test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * E2E tests for FTP publishing (issue #54).
 *
 * Covers:
 *   - Adding, editing, and deleting an FTP server in global Settings
 *   - FTP upload dialog on the Standings tab shows the configured server
 *   - FTP upload dialog shows a "no servers" message when none are configured
 *
 * Does not test the actual upload (requires a live scupper service and FTP
 * server); that is covered by scupper's own integration tests.
 */

test('FTP server settings: add, edit, delete', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByText('No FTP servers configured.')).toBeVisible();

  // ── Add ──────────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Add server' }).click();
  await page.getByLabel('Host').fill('ftp.example.com');
  // Port defaults to 21 — leave it
  await page.getByLabel('Username').fill('scorer');
  await page.locator('#ftp-password').fill('s3cret');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText('ftp://ftp.example.com:21')).toBeVisible();
  await expect(page.getByText('No FTP servers configured.')).not.toBeVisible();

  // ── Edit ─────────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Edit ftp.example.com' }).click();
  // Host field should be pre-filled
  await expect(page.getByLabel('Host')).toHaveValue('ftp.example.com');
  await page.getByLabel('Host').fill('ftp.hyc.ie');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText('ftp://ftp.hyc.ie:21')).toBeVisible();
  await expect(page.getByText('ftp://ftp.example.com:21')).not.toBeVisible();

  // ── Delete ────────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Delete ftp.hyc.ie' }).click();
  await expect(page.getByText('No FTP servers configured.')).toBeVisible();
});

test('FTP server settings: password visibility toggle', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Add server' }).click();
  await page.locator('#ftp-password').fill('s3cret');

  const passwordInput = page.locator('#ftp-password');
  await expect(passwordInput).toHaveAttribute('type', 'password');

  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(passwordInput).toHaveAttribute('type', 'text');

  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(passwordInput).toHaveAttribute('type', 'password');
});

test('FTP upload dialog: shows configured server; shows no-servers message after delete', async ({ page }) => {
  // ── Set up a series with one race so Standings tab is reachable ───────────
  await createSeriesQuick(page, { name: 'FTP Test Series' });

  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('1');
  await page.getByLabel('Competitor name').fill('Alice');
  await page.getByRole('button', { name: 'Save' }).click();

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await page.getByLabel('Sail number').fill('1');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  await page.getByRole('link', { name: 'Standings' }).click();

  // ── No servers configured: dialog shows the link to Settings ─────────────
  await page.getByRole('button', { name: 'Upload via FTP' }).click();
  await expect(page.getByRole('dialog', { name: 'Upload via FTP' })).toBeVisible();
  await expect(page.getByText('No FTP servers configured.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add one in Settings.' })).toBeVisible();
  // Upload button should not be present when there are no servers
  await expect(page.getByRole('button', { name: 'Upload' })).not.toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  // ── Add a server ─────────────────────────────────────────────────────────
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Add server' }).click();
  await page.getByLabel('Host').fill('ftp.example.com');
  await page.getByLabel('Username').fill('scorer');
  await page.locator('#ftp-password').fill('s3cret');
  await page.getByRole('button', { name: 'Save' }).click();
  // Wait for save to complete before navigating away — the async IndexedDB write
  // must finish or page.goto() will interrupt it.
  await expect(page.getByText('ftp://ftp.example.com:21')).toBeVisible();

  // ── Return to Standings: dialog now shows the server dropdown ─────────────
  await page.goto('/');
  await page.getByText('FTP Test Series').click();
  await page.getByRole('link', { name: 'Standings' }).click();
  await page.getByRole('button', { name: 'Upload via FTP' }).click();
  await expect(page.getByRole('dialog', { name: 'Upload via FTP' })).toBeVisible();
  await expect(page.getByText('No FTP servers configured.')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload' })).toBeVisible();
  // Upload button disabled until server and path are both filled
  await expect(page.getByRole('button', { name: 'Upload' })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel' }).click();
});
