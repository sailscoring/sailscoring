/**
 * End-to-end series file save / open / update covered through `/api/v1`.
 *
 * Covers the three repo-touching paths in `lib/series-file.ts`:
 *   - saveSeriesFile        (Save to File)
 *   - updateSeriesFromFile  (Update from File → "Update": in-place replace)
 *   - openSeriesFromFile    (Update from File → "Open as a new copy")
 *
 * Two tests rather than more: each magic-link sign-in counts against the
 * Better Auth rate limit shared with other server-mode specs.
 */
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { createSeriesQuick, signInFreshUser } from './helpers';

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

async function saveToFile(page: Page): Promise<SeriesFile> {
  await page.getByRole('button', { name: 'Series actions' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Save to File' }).click(),
  ]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as SeriesFile;
}

async function updateFromFile(page: Page, file: object): Promise<void> {
  await page.getByRole('button', { name: 'Series actions' }).click();
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('menuitem', { name: 'Update from File…' }).click(),
  ]);
  await fileChooser.setFiles({
    name: 'test.sailscoring',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(file)),
  });
}

// ─── tests ────────────────────────────────────────────────────────────────────

test.describe('series file save / open / update, server mode', () => {
  test('Save to File then Update from File (in-place) round-trips through Postgres', async ({ page }) => {
    await signInFreshUser(page, 'server-file-roundtrip');

    await createSeriesQuick(page, { name: 'Server Roundtrip Test', venue: 'Howth Yacht Club' });
    const seriesId = getSeriesId(page);

    // Add competitor and wait for the row to land — confirms saveCompetitor
    // (and the server-side series touch it implies) has settled. Without the
    // wait, Save to File can race the in-flight series version bump and 409.
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill('1234');
    await page.getByLabel('Competitor name').fill('Jane Doe');
    await page.getByLabel('Club').fill('HYC');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: '1234' })).toBeVisible();

    // Race + finish so the file carries finishes too.
    await page.getByRole('link', { name: 'Races' }).click();
    await page.getByRole('button', { name: 'Add race' }).click();
    await page.getByText('Race 1').click();
    await page.getByLabel('Sail number').fill('1234');
    await page.getByRole('button', { name: 'Add' }).click();
    // Wait for autosave to settle before navigating away — otherwise an in-flight
    // finish save can race saveSeriesFile reading from the DB.
    await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
    await page.getByTestId('back-to-races').click();
    await expect(page).toHaveURL(/\/races$/);

    // Save to file from the series actions menu — exercises saveSeriesFile
    // against Postgres.
    const original = await saveToFile(page);

    expect(original.formatVersion).toBe(8);
    expect(original.seriesId).toBe(seriesId);
    expect(original).not.toHaveProperty('snapshotId');
    expect(original).not.toHaveProperty('snapshotHistory');
    expect(original.series.name).toBe('Server Roundtrip Test');
    expect(original.series.venue).toBe('Howth Yacht Club');
    expect(original.competitors).toHaveLength(1);
    expect(original.competitors[0].sailNumber).toBe('1234');
    expect(original.races).toHaveLength(1);
    expect(original.races[0].finishes).toHaveLength(1);

    // Build an edited file carrying the same seriesId and upload it.
    // Exercises updateSeriesFromFile against Postgres.
    const edited: SeriesFile = {
      ...original,
      series: { ...original.series, name: 'Updated by Co-scorer', venue: 'RIYC' },
      competitors: [
        ...original.competitors,
        {
          id: 'new-competitor-1',
          fleetIds: original.competitors[0].fleetIds,
          sailNumber: '99',
          name: 'New Helm',
          club: 'RIYC',
          gender: '',
          age: null,
        },
      ],
    };

    await updateFromFile(page, edited);

    await expect(page.getByRole('dialog', { name: /Update .* from file\?/ })).toBeVisible();
    await page.getByRole('button', { name: 'Update' }).click();

    await expect(page).toHaveURL(/\/races$/);
    await expect(page.getByRole('heading', { name: 'Updated by Co-scorer' })).toBeVisible();
  });

  test('Update from File → "open as new copy" creates a second series', async ({ page }) => {
    await signInFreshUser(page, 'server-file-newcopy');

    await createSeriesQuick(page, { name: 'Server New Copy Original' });
    const originalSeriesId = getSeriesId(page);

    const original = await saveToFile(page);

    const edited: SeriesFile = {
      ...original,
      series: { ...original.series, name: 'Server New Copy Result' },
    };

    await updateFromFile(page, edited);

    await expect(page.getByRole('dialog', { name: /Update .* from file\?/ })).toBeVisible();

    // "Open as a new copy" exercises openSeriesFromFile against Postgres.
    await page.getByRole('button', { name: 'Open as a new copy' }).click();

    await expect(page).toHaveURL(/\/races$/);
    const newSeriesId = getSeriesId(page);
    expect(newSeriesId).not.toBe(originalSeriesId);
    await expect(page.getByRole('heading', { name: 'Server New Copy Result' })).toBeVisible();
  });
});
