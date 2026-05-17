import { signedInTest as test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { createSeriesQuick } from './helpers';

/**
 * E2E tests for the series file save / load round-trip.
 *
 * Covers:
 *   - Save to File exports correct JSON (all series fields, competitors, races,
 *     FTP host/path)
 *   - Update from File: identical snapshot → "nothing to update" dialog
 *   - Update from File: clean lineage (descendant) → in-place update
 *   - Update from File: diverged → conflict dialog (open as new copy path)
 */

// ─── local types matching the file format ────────────────────────────────────

interface FileCompetitor {
  id: string;
  fleetIds: string[];
  sailNumber: string;
  name: string;
  crewName?: string;
  club: string;
  gender: string;
  age: number | null;
}

interface FileFinish {
  id: string;
  competitorId: string;
  sortOrder: number | null;
  resultCode: string | null;
  startPresent: boolean | null;
}

interface FileRace {
  id: string;
  raceNumber: number;
  date: string;
  finishes: FileFinish[];
}

interface SeriesFile {
  formatVersion: number;
  seriesId: string;
  snapshotId: string;
  snapshotHistory: string[];
  exportedAt: string;
  series: {
    id: string;
    name: string;
    venue: string;
    startDate: string;
    endDate: string;
    venueLogoUrl: string;
    eventLogoUrl: string;
    discardThresholds: unknown[];
    dnfScoring: string;
    ftpHost: string;
    ftpPath: string;
    bilgeBundle: unknown;
    enabledCompetitorFields?: string[];
  };
  competitors: FileCompetitor[];
  races: FileRace[];
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function getSeriesId(page: Page): string {
  const match = page.url().match(/\/series\/([^/]+)/);
  if (!match) throw new Error(`Not on a series page: ${page.url()}`);
  return match[1];
}

/** Clicks "Save to File" and returns the parsed JSON. Must be on Settings tab. */
async function saveToFile(page: Page): Promise<SeriesFile> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save to File' }).click(),
  ]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as SeriesFile;
}

/** Clicks "Update from File" and supplies the given object as the file content. */
async function updateFromFile(page: Page, file: object): Promise<void> {
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Update from File' }).click(),
  ]);
  await fileChooser.setFiles({
    name: 'test.sailscoring',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(file)),
  });
}

// ─── tests ────────────────────────────────────────────────────────────────────

test('series file: save exports correct JSON with all series fields, competitors, races, and FTP host/path', async ({ page }) => {
  // ── Create series ─────────────────────────────────────────────────────────
  await createSeriesQuick(page, { name: 'Autumn League 2025' });
  const seriesId = getSeriesId(page);

  // ── Fill in basics ────────────────────────────────────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Basic' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByLabel('Venue', { exact: true }).fill('Howth Yacht Club');
  await page.getByLabel('Start date').fill('2025-09-06');
  await page.getByLabel('End date').fill('2025-11-01');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Howth Yacht Club').first()).toBeVisible();

  // ── Inject ftpHost/ftpPath via the API ────────────────────────────────────
  // (These fields are normally set on a successful FTP upload; we can't do
  //  a real upload in tests so we PUT them directly through /api/v1.)
  await page.evaluate(async ({ id, host, path }) => {
    const get = await fetch(`/api/v1/series/${id}`);
    if (!get.ok) throw new Error(`GET series ${id}: ${get.status}`);
    const series = await get.json();
    series.ftpHost = host;
    series.ftpPath = path;
    const put = await fetch(`/api/v1/series/${id}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'If-Match': String(series.version),
      },
      body: JSON.stringify(series),
    });
    if (!put.ok) throw new Error(`PUT series ${id}: ${put.status}`);
  }, { id: seriesId, host: 'ftp.hyc.ie', path: '/results/2025/autumn-league.html' });

  // ── Add competitor ────────────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('1234');
  await page.getByLabel('Competitor name').fill('Jane Doe');
  await page.getByLabel('Club').fill('HYC');
  await page.getByRole('button', { name: 'Save' }).click();

  // ── Add race with result ──────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await page.getByLabel('Sail number').fill('1234');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // ── Save to file and verify JSON ──────────────────────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const file = await saveToFile(page);

  // Top-level envelope
  expect(file.formatVersion).toBe(5);
  expect(file.seriesId).toBe(seriesId);
  expect(typeof file.snapshotId).toBe('string');
  expect(file.snapshotHistory).toEqual([file.snapshotId]);
  expect(typeof file.exportedAt).toBe('string');

  // Series fields
  expect(file.series.name).toBe('Autumn League 2025');
  expect(file.series.venue).toBe('Howth Yacht Club');
  expect(file.series.startDate).toBe('2025-09-06');
  expect(file.series.endDate).toBe('2025-11-01');
  expect(file.series.ftpHost).toBe('ftp.hyc.ie');
  expect(file.series.ftpPath).toBe('/results/2025/autumn-league.html');
  expect(file.series.bilgeBundle).toBeNull();
  // New in v8: scorer's choice of which optional competitor fields to show.
  expect(file.series.enabledCompetitorFields).toEqual(['boatName', 'club']);

  // Competitors and races
  expect(file.competitors).toHaveLength(1);
  expect(file.competitors[0].sailNumber).toBe('1234');
  expect(file.competitors[0].name).toBe('Jane Doe');

  expect(file.races).toHaveLength(1);
  expect(file.races[0].raceNumber).toBe(1);
  expect(file.races[0].finishes).toHaveLength(1);
  expect(file.races[0].finishes[0].sortOrder).toBe(1);
});

test('series file: identical snapshot shows "nothing to update"', async ({ page }) => {
  // ── Create series and save ────────────────────────────────────────────────
  await createSeriesQuick(page, { name: 'Identical Test' });
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const file = await saveToFile(page);

  // ── Upload the same file back ─────────────────────────────────────────────
  await updateFromFile(page, file);

  await expect(page.getByRole('dialog', { name: 'Nothing to update' })).toBeVisible();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('dialog', { name: 'Nothing to update' })).not.toBeVisible();
});

test('series file: clean lineage updates series in place', async ({ page }) => {
  // ── Create series with a competitor, save to file ─────────────────────────
  await createSeriesQuick(page, { name: 'Clean Test' });

  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('10');
  await page.getByLabel('Competitor name').fill('Original Helm');
  await page.getByRole('button', { name: 'Save' }).click();

  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const original = await saveToFile(page);

  // ── Build a descendant file: new snapshotId, original in history ──────────
  // Simulates a co-scorer who received the file, made changes, and saved again.
  const newSnapshotId = crypto.randomUUID();
  const descendant: SeriesFile = {
    ...original,
    snapshotId: newSnapshotId,
    snapshotHistory: [...original.snapshotHistory, newSnapshotId],
    series: { ...original.series, name: 'Updated by Co-scorer', venue: 'RIYC' },
    competitors: [
      ...original.competitors,
      { id: crypto.randomUUID(), fleetIds: original.competitors[0].fleetIds, sailNumber: '99', name: 'New Helm', club: 'RIYC', gender: '', age: null },
    ],
  };

  // ── Update from the descendant file ──────────────────────────────────────
  await updateFromFile(page, descendant);

  await expect(page.getByRole('dialog', { name: /Update/ })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('newer version');
  await page.getByRole('button', { name: 'Update' }).click();

  // ── Verify the series was updated in place ────────────────────────────────
  await expect(page).toHaveURL(/\/races$/);
  await expect(page.getByRole('heading', { name: 'Updated by Co-scorer' })).toBeVisible();
});

test('series file: Import Series shows working dialog while loading file (#139)', async ({ page }) => {
  // ── Create series and save to file ────────────────────────────────────────
  await createSeriesQuick(page, { name: 'Working Dialog Test' });

  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const original = await saveToFile(page);

  // Rewrite seriesId so the open hits the "no-existing" branch (the path with
  // the most visible delay — fans out into many writes before routing).
  const freshId = crypto.randomUUID();
  const fresh: SeriesFile = {
    ...original,
    seriesId: freshId,
    series: { ...original.series, id: freshId, name: 'Working Dialog Reopened' },
  };

  // ── Go home and trigger Import Series → Sail Scoring file ───────────────
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Series' })).toBeVisible();
  await page.getByRole('button', { name: 'Import Series' }).click();

  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByTestId('import-format-sailscoring').click(),
  ]);
  await fileChooser.setFiles({
    name: 'fresh.sailscoring',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fresh)),
  });

  // ── Working dialog must appear before navigation completes ───────────────
  await expect(page.getByRole('dialog', { name: /Opening series/ })).toBeVisible();

  // ── …and disappear once we land on the Races tab ─────────────────────────
  await expect(page).toHaveURL(/\/series\/[^/]+\/races$/);
  await expect(page.getByRole('dialog', { name: /Opening series/ })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Working Dialog Reopened' })).toBeVisible();
});

test('series file: diverged snapshot shows conflict dialog; open as new copy creates second series', async ({ page }) => {
  // ── Create series and save to file ────────────────────────────────────────
  await createSeriesQuick(page, { name: 'Diverged Original' });
  const originalSeriesId = getSeriesId(page);

  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const original = await saveToFile(page);

  // ── Build a diverged file: independent snapshot history (no common ancestor)
  // Simulates two scorers who both edited from the same starting point and
  // saved independently — neither file's history includes the other's snapshot.
  const diverged: SeriesFile = {
    ...original,
    snapshotId: crypto.randomUUID(),
    snapshotHistory: [crypto.randomUUID(), crypto.randomUUID()],
    series: { ...original.series, name: 'Diverged Copy' },
  };

  // ── Update from the diverged file ────────────────────────────────────────
  await updateFromFile(page, diverged);

  await expect(page.getByRole('dialog', { name: /conflicts with your local copy/ })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('diverged');

  // ── Choose "Open as a new copy" ───────────────────────────────────────────
  await page.getByRole('button', { name: 'Open as a new copy' }).click();

  // Should land on a new series (different ID) with the diverged file's name
  await expect(page).toHaveURL(/\/races$/);
  const newSeriesId = getSeriesId(page);
  expect(newSeriesId).not.toBe(originalSeriesId);
  await expect(page.getByRole('heading', { name: 'Diverged Copy' })).toBeVisible();
});
