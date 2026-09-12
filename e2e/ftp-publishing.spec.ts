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

/**
 * The server choice is remembered on the series, so a scorer who publishes to
 * the same club server week after week never re-picks it. Covers all three
 * ways the pane resolves a server: the sole configured one, nothing when
 * several could be meant, and the one the scorer picked.
 */
test('Publish dialog · FTP mode: the server choice is remembered', async ({ page }) => {
  // ── One server configured ────────────────────────────────────────────────
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Add server' }).click();
  await page.getByLabel('Host').fill('ftp.first.example');
  await page.getByLabel('Username').fill('scorer');
  await page.locator('#ftp-password').fill('s3cret');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('ftp://ftp.first.example:21')).toBeVisible();

  // ── A series with a race, so Standings and Publish are reachable ─────────
  await createSeriesQuick(page, { name: 'Remembered Server' });
  await addCompetitor(page, { sailNumber: '1', name: 'Alice' });
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await page.getByLabel('Sail number').fill('1');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  await page.getByRole('link', { name: 'Standings' }).click();
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('button', { name: 'Your website (FTP)' }).click();

  // The only server there is, is the one meant: no picking required.
  await expect(page.getByRole('combobox')).toContainText('ftp.first.example');
  await page.getByRole('button', { name: 'Cancel' }).click();

  // ── A second server: now the pane can't guess, and says so ───────────────
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Add server' }).click();
  await page.getByLabel('Host').fill('ftp.second.example');
  await page.getByLabel('Username').fill('scorer');
  await page.locator('#ftp-password').fill('s3cret');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('ftp://ftp.second.example:21')).toBeVisible();

  await page.goto('/');
  await page.getByText('Remembered Server').click();
  await page.getByRole('link', { name: 'Standings' }).click();
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('combobox')).toContainText('Select a server');

  // ── Pick the second one; the choice is written to the series on the pick,
  //    with no upload needed to record it ──────────────────────────────────
  const saved = page.waitForResponse(
    (r) => /\/api\/v1\/series\/[0-9a-f-]{36}$/.test(new URL(r.url()).pathname)
      && r.request().method() === 'PUT'
      && r.ok(),
  );
  await page.getByRole('combobox').click();
  await page.getByRole('option', { name: /ftp\.second\.example/ }).click();
  await saved;

  // ── A fresh load opens on it ─────────────────────────────────────────────
  await page.goto('/');
  await page.getByText('Remembered Server').click();
  await page.getByRole('link', { name: 'Standings' }).click();
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('combobox')).toContainText('ftp.second.example');
});

test('Publish dialog · FTP mode: per-page selection lets you upload a subset', async ({ page }) => {
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

  // Every page ticked by default → both inputs enabled, Upload gated on paths.
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

  // The master "All pages" toggle re-selects everything.
  await page.getByRole('checkbox', { name: 'All pages' }).check();
  await expect(fastPath).toBeEnabled();
  await expect(slowPath).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Upload' })).toBeEnabled();
});

/**
 * Page ticks are remembered too: the pane opens on the pages that have gone
 * out before, minus any the scorer unticked when they last uploaded.
 *
 * Both records are written by a successful upload, which needs a live scupper
 * relay and FTP server, so they go in through /api/v1 the way the FTP host
 * does in series-file.spec.ts — the read side is what this covers.
 */
test('Publish dialog · FTP mode: page ticks are remembered', async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['ftp-upload', 'entry-list']);
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Add server' }).click();
  await page.getByLabel('Host').fill('ftp.example.com');
  await page.getByLabel('Username').fill('scorer');
  await page.locator('#ftp-password').fill('s3cret');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('ftp://ftp.example.com:21')).toBeVisible();

  await createSeriesQuick(page, { name: 'Remembered Pages' });
  const seriesId = page.url().match(/\/series\/([^/]+)/)![1];
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

  // ── Both fleet pages uploaded before; Entries never has been ─────────────
  await page.evaluate(async (id) => {
    const fleets = await (await fetch(`/api/v1/series/${id}/fleets`)).json();
    const fleetId = (name: string) => fleets.find((f: { name: string }) => f.name === name).id;
    const get = await fetch(`/api/v1/series/${id}`);
    const series = await get.json();
    series.ftpPaths = {
      [`fleet:${fleetId('Fast')}`]: '/public_html/fast.html',
      [`fleet:${fleetId('Slow')}`]: '/public_html/slow.html',
    };
    const put = await fetch(`/api/v1/series/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'If-Match': String(series.version) },
      body: JSON.stringify(series),
    });
    if (!put.ok) throw new Error(`PUT series ${id}: ${put.status}`);
  }, seriesId);

  await page.getByRole('link', { name: 'Standings' }).click();
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('button', { name: 'Your website (FTP)' }).click();
  await expect(page.getByRole('checkbox', { name: 'Upload Fast' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Upload Slow' })).toBeChecked();
  // A page that has never gone out isn't swept into the next upload.
  await expect(page.getByRole('checkbox', { name: 'Upload Entries' })).not.toBeChecked();
  await page.getByRole('button', { name: 'Cancel' }).click();

  // ── Slow left out of the last upload, though it has gone out before ──────
  await page.evaluate(async (id) => {
    const fleets = await (await fetch(`/api/v1/series/${id}/fleets`)).json();
    const slow = fleets.find((f: { name: string }) => f.name === 'Slow').id;
    const get = await fetch(`/api/v1/series/${id}`);
    const series = await get.json();
    series.ftpPagesExcluded = [`fleet:${slow}`];
    const put = await fetch(`/api/v1/series/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'If-Match': String(series.version) },
      body: JSON.stringify(series),
    });
    if (!put.ok) throw new Error(`PUT series ${id}: ${put.status}`);
  }, seriesId);

  await page.reload();
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('checkbox', { name: 'Upload Fast' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Upload Slow' })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Upload Entries' })).not.toBeChecked();
});

test('Publish dialog: FTP offers the same pages as Sail Scoring', async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['ftp-upload', 'entry-list']);
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Add server' }).click();
  await page.getByLabel('Host').fill('ftp.example.com');
  await page.getByLabel('Username').fill('scorer');
  await page.locator('#ftp-password').fill('s3cret');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('ftp://ftp.example.com:21')).toBeVisible();

  await createSeriesQuick(page, { name: 'Same Pages' });
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

  // The entry list (#423) is a page like any other on the Sail Scoring side …
  await expect(dialog.getByRole('checkbox', { name: 'Publish Entries' })).toBeVisible();

  // … and on the club's own web server, with a remote path of its own.
  await page.getByRole('button', { name: 'Your website (FTP)' }).click();
  await expect(dialog.getByLabel('Fast path')).toBeVisible();
  await expect(dialog.getByLabel('Slow path')).toBeVisible();
  await expect(dialog.getByLabel('Entries path')).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'Upload Entries' })).toBeVisible();
});
