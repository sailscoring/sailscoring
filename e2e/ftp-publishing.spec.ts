import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';
import { signedInTest as test, expect } from './fixtures';
import { addCompetitor, createFleets, createSeriesQuick, enableFeatures } from './helpers';

/**
 * E2E tests for publishing to a club's own web server.
 *
 * Publishing a page on Sail Scoring also uploads it, server-side, to the FTP
 * path the series holds for it; the Publish dialog's FTP tab is where those
 * paths are set. FTP servers on the RFC 6761 `.test` TLD never reach the
 * relay: the upload is appended to `tests/.ftp-uploads.log`, which is how
 * these tests see what went where — and a `fail.` host fails, for the error
 * path. The relay itself is covered by scupper's own tests.
 *
 * FTP upload is a gated feature (#155), so each test enables it for the
 * signed-in user's personal workspace first.
 */

const FTP_LOG = path.join(process.cwd(), 'tests', '.ftp-uploads.log');

async function uploadsTo(host: string): Promise<{ host: string; path: string; html: string }[]> {
  try {
    const text = await fs.readFile(FTP_LOG, 'utf8');
    return text
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l))
      .filter((u) => u.host === host);
  } catch {
    return [];
  }
}

/** A host of this test's own, so parallel tests never read each other's
 *  uploads out of the shared log. */
function testHost(prefix = 'ftp'): string {
  return `${prefix}.${crypto.randomUUID().slice(0, 8)}.club.test`;
}

async function addServer(page: Page, host: string) {
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Add server' }).click();
  await page.getByLabel('Host').fill(host);
  await page.getByLabel('Username').fill('scorer');
  await page.locator('#ftp-password').fill('s3cret');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(`ftp://${host}:21`)).toBeVisible();
}

const HELMS = ['Alice', 'Bob'];

/** A series with a sailed race, on its Standings tab. Two fleets when asked
 *  for, with a boat in each. */
async function createSailedSeries(page: Page, name: string, fleets?: string[]) {
  await createSeriesQuick(page, { name });
  if (fleets) {
    await createFleets(page, fleets);
    await page.getByRole('link', { name: 'Competitors' }).click();
  }
  const boats = (fleets ?? [undefined]).map((fleet, i) => ({ sailNumber: `${i + 1}`, fleet }));
  for (const [i, boat] of boats.entries()) {
    await addCompetitor(page, { sailNumber: boat.sailNumber, name: HELMS[i], ...(boat.fleet ? { fleet: boat.fleet } : {}) });
  }
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  for (const boat of boats) {
    await page.getByLabel('Sail number').fill(boat.sailNumber);
    await page.getByRole('button', { name: 'Add' }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByRole('link', { name: 'Standings' }).click();
}

async function openPublish(page: Page) {
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Wait for the quiet publish-prefs write a pick or a typed path makes. */
function prefsWrite(page: Page) {
  return page.waitForResponse(
    (r) => /\/api\/v1\/series\/[0-9a-f-]{36}\/publish-prefs$/.test(new URL(r.url()).pathname)
      && r.request().method() === 'PATCH'
      && r.ok(),
  );
}

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

test('Publish dialog · FTP tab: settings only, with no way to publish to FTP alone', async ({ page }) => {
  await createSailedSeries(page, 'FTP Tab Series');

  // The dialog opens on its Pages tab; the FTP tab is beside it.
  const dialog = await openPublish(page);
  await expect(dialog.getByRole('tab', { name: 'Pages' })).toHaveAttribute('aria-selected', 'true');
  await dialog.getByRole('tab', { name: 'Your website (FTP)' }).click();

  // No servers yet: the tab points at Workspace Settings.
  await expect(dialog.getByText('No FTP servers configured.')).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Add one in Workspace Settings.' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Upload' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await addServer(page, testHost());
  await page.goto('/');
  await page.getByText('FTP Tab Series').click();
  await page.getByRole('link', { name: 'Standings' }).click();

  // With one: a path per page, and still nothing that uploads by itself.
  const again = await openPublish(page);
  await again.getByRole('tab', { name: 'Your website (FTP)' }).click();
  await expect(again.getByLabel('Standings path')).toBeVisible();
  await expect(again.getByRole('button', { name: 'Upload' })).toHaveCount(0);
  await expect(again.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0);
  await again.getByRole('button', { name: 'Back to pages' }).click();
  await expect(again.getByRole('button', { name: 'Publish', exact: true })).toBeVisible();
});

/**
 * The server choice is remembered on the series, so a scorer who publishes to
 * the same club server week after week never re-picks it. Covers all three
 * ways the tab resolves a server: the sole configured one, nothing when
 * several could be meant, and the one the scorer picked.
 */
test('Publish dialog · FTP tab: the server choice is remembered', async ({ page }) => {
  const first = testHost('first');
  const second = testHost('second');
  await addServer(page, first);
  await createSailedSeries(page, 'Remembered Server');

  // The only server there is, is the one meant: no picking required.
  let dialog = await openPublish(page);
  await dialog.getByRole('tab', { name: 'Your website (FTP)' }).click();
  await expect(dialog.getByRole('combobox')).toContainText(first);
  await page.keyboard.press('Escape');

  // A second server: now the tab can't guess, and says so.
  await addServer(page, second);
  await page.goto('/');
  await page.getByText('Remembered Server').click();
  await page.getByRole('link', { name: 'Standings' }).click();
  dialog = await openPublish(page);
  await dialog.getByRole('tab', { name: 'Your website (FTP)' }).click();
  await expect(dialog.getByRole('combobox')).toContainText('Select a server');

  // Pick the second one; the choice is written on the pick.
  const saved = prefsWrite(page);
  await dialog.getByRole('combobox').click();
  await page.getByRole('option', { name: new RegExp(second.replace(/\./g, '\\.')) }).click();
  await saved;

  // A fresh load opens on it.
  await page.goto('/');
  await page.getByText('Remembered Server').click();
  await page.getByRole('link', { name: 'Standings' }).click();
  dialog = await openPublish(page);
  await dialog.getByRole('tab', { name: 'Your website (FTP)' }).click();
  await expect(dialog.getByRole('combobox')).toContainText(second);
});

test('Publish dialog · FTP tab: the same pages as Pages, each path saved as typed', async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['ftp-upload', 'entry-list']);
  const host = testHost();
  await addServer(page, host);
  await createSailedSeries(page, 'Same Pages', ['Fast', 'Slow']);

  const dialog = await openPublish(page);
  // The entry list is a page like any other on the Pages tab …
  await expect(dialog.getByRole('checkbox', { name: 'Publish Entries' })).toBeVisible();
  // … and has a path of its own on the FTP tab.
  await dialog.getByRole('tab', { name: 'Your website (FTP)' }).click();
  await expect(dialog.getByLabel('Fast path')).toBeVisible();
  await expect(dialog.getByLabel('Slow path')).toBeVisible();
  await expect(dialog.getByLabel('Entries path')).toBeVisible();

  const saved = prefsWrite(page);
  await dialog.getByLabel('Fast path').fill('/public_html/results/fast.html');
  await dialog.getByLabel('Slow path').focus();
  await saved;

  // Back on the Pages tab, the dialog says where publishing will send Fast.
  await dialog.getByRole('tab', { name: 'Pages' }).click();
  await expect(dialog.getByTestId('ftp-publish-hint')).toHaveText(
    `Publishing Fast also uploads it to ${host}.`,
  );

  // Remembered across a fresh load.
  await page.reload();
  const again = await openPublish(page);
  await again.getByRole('tab', { name: 'Your website (FTP)' }).click();
  await expect(again.getByLabel('Fast path')).toHaveValue('/public_html/results/fast.html');
  await expect(again.getByLabel('Slow path')).toHaveValue('');
});

/**
 * Setting where results go is not an edit to the series. The pick and the
 * paths are written to the series row — that is how they are remembered —
 * through the quiet publish-prefs write, so nothing on the History tab says a
 * setting changed, and the publish indicator counts no edit.
 */
test('Publish dialog · FTP tab: setting it up is not recorded as a settings edit', async ({ page }) => {
  const host = testHost();
  await addServer(page, host);
  await createSailedSeries(page, 'Quiet Prefs Series');

  const dialog = await openPublish(page);
  await dialog.getByRole('tab', { name: 'Your website (FTP)' }).click();
  await expect(dialog.getByRole('combobox')).toContainText(host);
  const saved = prefsWrite(page);
  await dialog.getByLabel('Standings path').fill('/public_html/results/quiet.html');
  await dialog.getByLabel('Standings path').blur();
  await saved;
  await page.keyboard.press('Escape');

  await page.getByRole('navigation').getByRole('link', { name: 'History' }).click();
  await expect(page).toHaveURL(/\/series\/[0-9a-f-]{36}\/history$/);
  const revisions = page.getByTestId('revision-list');
  await expect(revisions).toContainText('Added Race 1');
  await expect(revisions).not.toContainText('Updated series settings');

  await page.goto('/workspace/activity');
  await expect(page.getByTestId('activity-entry').first()).toBeVisible();
  await expect(page.locator('[data-action="series.updated"]')).toHaveCount(0);
});

test('publishing a page also uploads it to the club site', async ({ page }) => {
  const host = testHost();
  await addServer(page, host);
  await createSailedSeries(page, 'Club Site Series', ['Fast', 'Slow']);

  const dialog = await openPublish(page);
  await dialog.getByRole('tab', { name: 'Your website (FTP)' }).click();
  const saved = prefsWrite(page);
  await dialog.getByLabel('Fast path').fill('/public_html/results/fast.html');
  await dialog.getByLabel('Fast path').blur();
  await saved;
  await dialog.getByRole('tab', { name: 'Pages' }).click();
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();

  // Both pages are live here; Fast went to the club site too.
  await expect(dialog.getByRole('link', { name: /\/fast$/ })).toBeVisible();
  const outcome = dialog.getByTestId('ftp-outcome');
  await expect(outcome).toContainText(`Uploaded Fast to ${host}.`);
  await expect(outcome).toContainText('No path on your website for Slow, so it stays here only.');

  const uploads = await uploadsTo(host);
  expect(uploads.map((u) => u.path)).toEqual(['/public_html/results/fast.html']);
  expect(uploads[0].html).toContain('Alice');
  expect(uploads[0].html).not.toContain('Bob');

  // Publishing again with nothing changed still sends it: that is the retry.
  await dialog.getByRole('button', { name: 'Re-publish' }).click();
  await expect(dialog.getByTestId('ftp-outcome')).toContainText(`Uploaded Fast to ${host}.`);
  expect(await uploadsTo(host)).toHaveLength(2);

  // The workspace feed has the upload.
  await page.goto('/workspace/activity');
  await expect(page.locator('[data-action="publish.ftp-uploaded"]').first()).toContainText(
    `Uploaded 1 page to ${host}`,
  );
});

test('a failed upload leaves the results published here, and says so', async ({ page }) => {
  const host = testHost('fail');
  await addServer(page, host);
  await createSailedSeries(page, 'Failing Upload Series');

  const dialog = await openPublish(page);
  await dialog.getByRole('tab', { name: 'Your website (FTP)' }).click();
  const saved = prefsWrite(page);
  await dialog.getByLabel('Standings path').fill('/public_html/results/standings.html');
  await dialog.getByLabel('Standings path').blur();
  await saved;
  await dialog.getByRole('tab', { name: 'Pages' }).click();
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();

  const outcome = dialog.getByTestId('ftp-outcome');
  await expect(outcome).toContainText(`Couldn't upload Standings to ${host}: FTP error: 530 Login incorrect`);
  await expect(outcome).toContainText('Publish again to retry.');
  // Published on Sail Scoring all the same.
  await expect(dialog.getByText(/^Last published/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Re-publish' })).toBeVisible();
});
