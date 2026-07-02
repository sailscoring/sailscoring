import { signedInTest as test, expect } from './fixtures';
import { addCompetitor, createFleets, createSeriesQuick, enableFeatures } from './helpers';

/**
 * E2E tests for FTP publishing (issue #54).
 *
 * Covers:
 *   - Adding, editing, and deleting an FTP server in workspace settings
 *   - FTP upload dialog on the Standings tab shows the configured server
 *   - FTP upload dialog shows a "no servers" message when none are configured
 *
 * Does not test the actual upload (requires a live scupper service and FTP
 * server); that is covered by scupper's own integration tests.
 *
 * FTP upload is a gated experimental feature (#155), so each test enables it
 * for the signed-in user's personal workspace first.
 */

test.beforeEach(async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['ftp-upload']);
});

test('FTP server settings: add, edit, delete', async ({ page }) => {
  await page.goto('/workspace');
  await expect(
    page.getByRole('heading', { name: /Workspace settings/ }),
  ).toBeVisible();
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
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Add server' }).click();
  await page.locator('#ftp-password').fill('s3cret');

  const passwordInput = page.locator('#ftp-password');
  await expect(passwordInput).toHaveAttribute('type', 'password');

  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(passwordInput).toHaveAttribute('type', 'text');

  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(passwordInput).toHaveAttribute('type', 'password');
});

test('Publish dialog · FTP mode: no-servers message, then remembered across reopen', async ({ page }) => {
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

  // ── Publish opens in Sail Scoring mode; switch to the FTP destination ─────
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('dialog', { name: 'Publish results' })).toBeVisible();
  await page.getByRole('button', { name: 'Your website (FTP)' }).click();

  // No servers yet: the FTP pane shows the workspace link and hides Upload.
  await expect(page.getByText('No FTP servers configured.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add one in Workspace Settings.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload' })).not.toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  // ── Add a server ─────────────────────────────────────────────────────────
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Add server' }).click();
  await page.getByLabel('Host').fill('ftp.example.com');
  await page.getByLabel('Username').fill('scorer');
  await page.locator('#ftp-password').fill('s3cret');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('ftp://ftp.example.com:21')).toBeVisible();

  // ── Reopen Publish: the series remembers FTP mode (persisted on the switch),
  //    so it lands in the FTP pane directly — no second switch needed ────────
  await page.goto('/');
  await page.getByText('FTP Test Series').click();
  await page.getByRole('link', { name: 'Standings' }).click();
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('dialog', { name: 'Publish results' })).toBeVisible();
  await expect(page.getByText('No FTP servers configured.')).not.toBeVisible();
  await expect(page.getByLabel('Path')).toBeVisible(); // single-fleet FTP path input
  await expect(page.getByRole('button', { name: 'Upload' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload' })).toBeDisabled();
  // The destination toggle shows FTP as the active mode, with the way back.
  await expect(
    page.getByRole('button', { name: 'Your website (FTP)' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Sail Scoring pages' })).toBeVisible();
});

test('Publish dialog · FTP mode: per-fleet selection lets you upload a subset', async ({ page }) => {
  // ── Configure a server ────────────────────────────────────────────────────
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Add server' }).click();
  await page.getByLabel('Host').fill('ftp.example.com');
  await page.getByLabel('Username').fill('scorer');
  await page.locator('#ftp-password').fill('s3cret');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('ftp://ftp.example.com:21')).toBeVisible();

  // ── Series with two fleets, a competitor in each, and one race so the
  //    Standings tab (and the Publish button) render ────────────────────────
  await createSeriesQuick(page, { name: 'Multi Fleet FTP' });
  await createFleets(page, ['Fast', 'Slow']);

  await page.getByRole('link', { name: 'Competitors' }).click();
  await addCompetitor(page, { sailNumber: '1', name: 'Alice', fleet: 'Fast' });
  await addCompetitor(page, { sailNumber: '2', name: 'Bob', fleet: 'Slow' });

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await page.getByLabel('Sail number').fill('1');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByLabel('Sail number').fill('2');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  await page.getByRole('link', { name: 'Standings' }).click();
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Your website (FTP)' }).click();
  await expect(page.getByLabel('Fast path')).toBeVisible();

  // Pick the server (a fresh series has no saved host to auto-select).
  await page.getByRole('combobox').click();
  await page.getByRole('option', { name: /ftp\.example\.com/ }).click();

  const fastPath = page.getByLabel('Fast path');
  const slowPath = page.getByLabel('Slow path');
  await expect(fastPath).toBeVisible();
  await expect(slowPath).toBeVisible();

  // All fleets ticked by default → both inputs enabled, Upload gated on paths.
  await expect(page.getByRole('button', { name: 'Upload' })).toBeDisabled();
  await fastPath.fill('/public_html/fast.html');
  await slowPath.fill('/public_html/slow.html');
  await expect(page.getByRole('button', { name: 'Upload' })).toBeEnabled();

  // Untick Slow: its input disables, but Fast is still selected + has a path,
  // so a partial upload is allowed.
  await page.getByRole('checkbox', { name: 'Upload Slow' }).uncheck();
  await expect(slowPath).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Upload' })).toBeEnabled();

  // Untick Fast too: nothing selected → Upload disabled.
  await page.getByRole('checkbox', { name: 'Upload Fast' }).uncheck();
  await expect(page.getByRole('button', { name: 'Upload' })).toBeDisabled();

  // The master "All fleets" toggle re-selects everything.
  await page.getByRole('checkbox', { name: 'All fleets' }).check();
  await expect(fastPath).toBeEnabled();
  await expect(slowPath).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Upload' })).toBeEnabled();
});
