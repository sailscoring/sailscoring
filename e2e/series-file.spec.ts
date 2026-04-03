import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

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
  sailNumber: string;
  name: string;
  club: string;
  gender: string;
  age: number | null;
}

interface FileFinish {
  id: string;
  competitorId: string;
  finishPosition: number | null;
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
  await page.goto('/');
  await page.getByRole('link', { name: 'New series' }).click();
  await page.getByLabel('Name').fill('Autumn League 2025');
  await page.getByRole('button', { name: 'Create series' }).click();
  await expect(page).toHaveURL(/\/competitors$/);
  const seriesId = getSeriesId(page);

  // ── Fill in basics ────────────────────────────────────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Venue', { exact: true }).fill('Howth Yacht Club');
  await page.getByLabel('Start date').fill('2025-09-06');
  await page.getByLabel('End date').fill('2025-11-01');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();

  // ── Inject ftpHost/ftpPath directly into IndexedDB ───────────────────────
  // (These fields are normally set on a successful FTP upload; we can't do
  //  a real upload in tests so we write them directly.)
  await page.evaluate(async ([id, host, path]) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('sailscoring');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('series', 'readwrite');
        const store = tx.objectStore('series');
        const get = store.get(id);
        get.onsuccess = () => {
          const s = get.result;
          s.ftpHost = host;
          s.ftpPath = path;
          store.put(s);
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, [seriesId, 'ftp.hyc.ie', '/results/2025/autumn-league.htm']);

  // ── Add competitor ────────────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('1234');
  await page.getByLabel('Helm name').fill('Jane Doe');
  await page.getByLabel('Club').fill('HYC');
  await page.getByRole('button', { name: 'Save' }).click();

  // ── Add race with result ──────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await page.getByLabel('Sail number').fill('1234');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByRole('button', { name: 'Save results' }).click();

  // ── Save to file and verify JSON ──────────────────────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const file = await saveToFile(page);

  // Top-level envelope
  expect(file.formatVersion).toBe(1);
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
  expect(file.series.ftpPath).toBe('/results/2025/autumn-league.htm');

  // Competitors and races
  expect(file.competitors).toHaveLength(1);
  expect(file.competitors[0].sailNumber).toBe('1234');
  expect(file.competitors[0].name).toBe('Jane Doe');

  expect(file.races).toHaveLength(1);
  expect(file.races[0].raceNumber).toBe(1);
  expect(file.races[0].finishes).toHaveLength(1);
  expect(file.races[0].finishes[0].finishPosition).toBe(1);
});

test('series file: identical snapshot shows "nothing to update"', async ({ page }) => {
  // ── Create series and save ────────────────────────────────────────────────
  await page.goto('/');
  await page.getByRole('link', { name: 'New series' }).click();
  await page.getByLabel('Name').fill('Identical Test');
  await page.getByRole('button', { name: 'Create series' }).click();
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
  await page.goto('/');
  await page.getByRole('link', { name: 'New series' }).click();
  await page.getByLabel('Name').fill('Clean Test');
  await page.getByRole('button', { name: 'Create series' }).click();

  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('10');
  await page.getByLabel('Helm name').fill('Original Helm');
  await page.getByRole('button', { name: 'Save' }).click();

  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const original = await saveToFile(page);

  // ── Build a descendant file: new snapshotId, original in history ──────────
  // Simulates a co-scorer who received the file, made changes, and saved again.
  const newSnapshotId = 'snap-v2-' + Date.now();
  const descendant: SeriesFile = {
    ...original,
    snapshotId: newSnapshotId,
    snapshotHistory: [...original.snapshotHistory, newSnapshotId],
    series: { ...original.series, name: 'Updated by Co-scorer', venue: 'RIYC' },
    competitors: [
      ...original.competitors,
      { id: 'new-competitor-1', sailNumber: '99', name: 'New Helm', club: 'RIYC', gender: '', age: null },
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

test('series file: diverged snapshot shows conflict dialog; open as new copy creates second series', async ({ page }) => {
  // ── Create series and save to file ────────────────────────────────────────
  await page.goto('/');
  await page.getByRole('link', { name: 'New series' }).click();
  await page.getByLabel('Name').fill('Diverged Original');
  await page.getByRole('button', { name: 'Create series' }).click();
  const originalSeriesId = getSeriesId(page);

  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const original = await saveToFile(page);

  // ── Build a diverged file: independent snapshot history (no common ancestor)
  // Simulates two scorers who both edited from the same starting point and
  // saved independently — neither file's history includes the other's snapshot.
  const diverged: SeriesFile = {
    ...original,
    snapshotId: 'diverged-snap-' + Date.now(),
    snapshotHistory: ['unrelated-snap-1', 'unrelated-snap-2'],
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
