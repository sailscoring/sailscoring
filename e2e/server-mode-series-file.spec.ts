/**
 * End-to-end series file save / open / update covered through `/api/v1`.
 *
 * Covers the three repo-touching paths in `lib/series-file.ts`:
 *   - saveSeriesFile        (Save to File)
 *   - updateSeriesFromFile  (Update from File: clean lineage)
 *   - openSeriesFromFile    (Update from File: diverged → "open as new copy")
 *
 * Two tests rather than one-per-dialog: each magic-link sign-in counts
 * against the Better Auth rate limit shared with other server-mode specs,
 * and the "identical snapshot" branch is pure UI logic with no extra
 * server round trip. The local-mode spec exercises that branch.
 */
import { randomUUID } from 'node:crypto';
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
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save to File' }).click(),
  ]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as SeriesFile;
}

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

test.describe('series file save / open / update, server mode', () => {
  test('Save to File then Update from File (clean lineage) round-trips through Postgres', async ({ page }) => {
    await signInFreshUser(page, 'server-file-roundtrip');

    await createSeriesQuick(page, { name: 'Server Roundtrip Test', venue: 'Howth Yacht Club' });
    const seriesId = getSeriesId(page);

    // Add competitor and wait for the row to land — confirms saveCompetitor
    // + touchSeries have settled. Without the wait, Save to File can race
    // the in-flight series version bump and 409.
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

    // Save to file from Settings — exercises saveSeriesFile against Postgres.
    await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
    const original = await saveToFile(page);

    expect(original.formatVersion).toBe(6);
    expect(original.seriesId).toBe(seriesId);
    expect(typeof original.snapshotId).toBe('string');
    expect(original.snapshotHistory).toEqual([original.snapshotId]);
    expect(original.series.name).toBe('Server Roundtrip Test');
    expect(original.series.venue).toBe('Howth Yacht Club');
    expect(original.competitors).toHaveLength(1);
    expect(original.competitors[0].sailNumber).toBe('1234');
    expect(original.races).toHaveLength(1);
    expect(original.races[0].finishes).toHaveLength(1);

    // Build a descendant file (real UUIDs — Postgres validates them) and
    // upload it. Exercises updateSeriesFromFile against Postgres.
    const newSnapshotId = randomUUID();
    const descendant: SeriesFile = {
      ...original,
      snapshotId: newSnapshotId,
      snapshotHistory: [...original.snapshotHistory, newSnapshotId],
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

    await updateFromFile(page, descendant);

    await expect(page.getByRole('dialog', { name: /Update/ })).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('newer version');
    await page.getByRole('button', { name: 'Update' }).click();

    await expect(page).toHaveURL(/\/races$/);
    await expect(page.getByRole('heading', { name: 'Updated by Co-scorer' })).toBeVisible();
  });

  test('Update from File: diverged shows conflict dialog; "open as new copy" creates a second series', async ({ page }) => {
    await signInFreshUser(page, 'server-file-diverged');

    await createSeriesQuick(page, { name: 'Server Diverged Original' });
    const originalSeriesId = getSeriesId(page);

    await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
    const original = await saveToFile(page);

    const diverged: SeriesFile = {
      ...original,
      snapshotId: randomUUID(),
      // Two unrelated snapshot UUIDs — neither matches the original's
      // lineage, so checkLineage() returns 'diverged'.
      snapshotHistory: [randomUUID(), randomUUID()],
      series: { ...original.series, name: 'Server Diverged Copy' },
    };

    await updateFromFile(page, diverged);

    await expect(page.getByRole('dialog', { name: /conflicts with your workspace copy/ })).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('diverged');

    // "Open as a new copy" exercises openSeriesFromFile against Postgres.
    await page.getByRole('button', { name: 'Open as a new copy' }).click();

    await expect(page).toHaveURL(/\/races$/);
    const newSeriesId = getSeriesId(page);
    expect(newSeriesId).not.toBe(originalSeriesId);
    await expect(page.getByRole('heading', { name: 'Server Diverged Copy' })).toBeVisible();
  });
});
