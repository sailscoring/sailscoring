import { signedInTest as test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { createSeriesQuick } from './helpers';

/**
 * E2E tests for the series file save / load round-trip.
 *
 * Covers:
 *   - Save to File exports correct JSON (all series fields, competitors, races,
 *     FTP host/path)
 *   - Update from File: confirm dialog → in-place update (matched by seriesId)
 *   - Update from File: "Open as a new copy" path creates a second series
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
  exportedAt: string;
  series: {
    id: string;
    name: string;
    venue: string;
    startDate: string;
    endDate: string;
    venueLogoUrl: string;
    eventLogoUrl: string;
    venueUrl?: string;
    eventUrl?: string;
    discardThresholds: unknown[];
    dnfScoring: string;
    ftpHost: string;
    ftpPath: string;
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
  await page.getByLabel('Venue website URL').fill('https://www.hyc.ie');
  await page.getByLabel('Event website URL').fill('https://example.com/autumn-league');
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
  await expect(page.getByText('Race 1 — results')).toBeVisible();
  const raceId = page.url().match(/\/races\/([^/]+)$/)![1];
  // Commit via the autocomplete suggestion. Clicking "Add" before the race page
  // has loaded the competitor list no-ops: the sail won't resolve in sailMap,
  // so addFinisher() bails to the "unknown sail" prompt and saves nothing.
  // Waiting for the suggestion confirms the competitor is loaded first.
  await page.getByLabel('Sail number').fill('1234');
  await page.getByRole('option', { name: /1234/ }).click();
  await expect(page.getByRole('listitem').filter({ hasText: '1234' })).toBeVisible();
  // buildSeriesFile reads finishes fresh from the server, so the finish must be
  // durably persisted before we navigate away and export. The autosave-status
  // pill is racy here: its idle and saved states share the text "All changes
  // saved", so asserting it can match the pre-save state and let the export run
  // before the save round-trips. Poll server truth — exactly what the export
  // reads — instead.
  await expect
    .poll(() =>
      page.evaluate(async (rid) => {
        const res = await fetch(`/api/v1/races/${rid}/finishes`);
        return res.ok ? ((await res.json()) as unknown[]).length : -1;
      }, raceId),
    )
    .toBe(1);

  // ── Save to file and verify JSON ──────────────────────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const file = await saveToFile(page);

  // Top-level envelope
  expect(file.formatVersion).toBe(8);
  expect(file.seriesId).toBe(seriesId);
  expect(file).not.toHaveProperty('snapshotId');
  expect(file).not.toHaveProperty('snapshotHistory');
  expect(typeof file.exportedAt).toBe('string');

  // Series fields
  expect(file.series.name).toBe('Autumn League 2025');
  expect(file.series.venue).toBe('Howth Yacht Club');
  expect(file.series.startDate).toBe('2025-09-06');
  expect(file.series.endDate).toBe('2025-11-01');
  expect(file.series.ftpHost).toBe('ftp.hyc.ie');
  expect(file.series.ftpPath).toBe('/results/2025/autumn-league.html');
  // Website URLs round-trip into the file verbatim.
  expect(file.series.venueUrl).toBe('https://www.hyc.ie');
  expect(file.series.eventUrl).toBe('https://example.com/autumn-league');
  // Bilge publishing state was removed in ADR-008 Phase 9 — no longer written.
  expect(file.series).not.toHaveProperty('bilgeBundle');
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

test('series file: Update from File replaces the series in place (matched by seriesId)', async ({ page }) => {
  // ── Create series with a competitor, save to file ─────────────────────────
  await createSeriesQuick(page, { name: 'Update In Place Test' });

  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('10');
  await page.getByLabel('Competitor name').fill('Original Helm');
  await page.getByRole('button', { name: 'Save' }).click();

  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const original = await saveToFile(page);

  // ── Build an edited file carrying the same seriesId ───────────────────────
  // Simulates a regenerated / co-scorer-edited file of the same series.
  const edited: SeriesFile = {
    ...original,
    series: { ...original.series, name: 'Updated by Co-scorer', venue: 'RIYC' },
    competitors: [
      ...original.competitors,
      { id: crypto.randomUUID(), fleetIds: original.competitors[0].fleetIds, sailNumber: '99', name: 'New Helm', club: 'RIYC', gender: '', age: null },
    ],
  };

  // ── Update from the edited file → single confirm → in-place replace ───────
  await updateFromFile(page, edited);

  await expect(page.getByRole('dialog', { name: /Update .* from file\?/ })).toBeVisible();
  await page.getByRole('button', { name: 'Update' }).click();

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

test('series file: importing a new .sailscoring file lets you file it under a category', async ({ page }) => {
  // ── Create series, save to file, then add a category ──────────────────────
  await createSeriesQuick(page, { name: 'Category Import Source' });
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const original = await saveToFile(page);

  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Manage' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('New category name').fill('Open Events');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog.getByPlaceholder('New category name')).toHaveValue('');
  await dialog.getByRole('button', { name: 'Done' }).click();

  // Rewrite the seriesId so the open hits the "new series" branch.
  const freshId = crypto.randomUUID();
  const fresh: SeriesFile = {
    ...original,
    seriesId: freshId,
    series: { ...original.series, id: freshId, name: 'Imported Into Category' },
  };

  // ── Import from home → confirm dialog with a category picker ───────────────
  await page.goto('/');
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

  await expect(page.getByRole('dialog', { name: /Import .*Imported Into Category/ })).toBeVisible();
  await page.getByTestId('import-category').click();
  await page.getByRole('option', { name: 'Open Events' }).click();
  await page.getByRole('button', { name: 'Open series' }).click();

  // ── Lands on the new series, and the home list files it under the category ─
  await expect(page).toHaveURL(/\/series\/[^/]+\/races$/);
  await expect(page.getByRole('heading', { name: 'Imported Into Category' })).toBeVisible();

  await page.goto('/');
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'Open Events' }) });
  await expect(section.getByText('Imported Into Category')).toBeVisible();
});

test('series file: Update from File → "Open as a new copy" creates a second series', async ({ page }) => {
  // ── Create series and save to file ────────────────────────────────────────
  await createSeriesQuick(page, { name: 'New Copy Original' });
  const originalSeriesId = getSeriesId(page);

  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const original = await saveToFile(page);

  const edited: SeriesFile = {
    ...original,
    series: { ...original.series, name: 'New Copy Result' },
  };

  // ── Update from the file, but choose "Open as a new copy" ─────────────────
  await updateFromFile(page, edited);

  await expect(page.getByRole('dialog', { name: /Update .* from file\?/ })).toBeVisible();
  await page.getByRole('button', { name: 'Open as a new copy' }).click();

  // Should land on a new series (different ID) with the edited file's name
  await expect(page).toHaveURL(/\/races$/);
  const newSeriesId = getSeriesId(page);
  expect(newSeriesId).not.toBe(originalSeriesId);
  await expect(page.getByRole('heading', { name: 'New Copy Result' })).toBeVisible();
});
