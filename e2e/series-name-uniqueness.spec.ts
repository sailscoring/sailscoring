import { test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * E2E tests for issue #89: series-name uniqueness, disambiguation on import, and
 * rename from Settings.
 */

function makeImportUrl(name: string): string {
  const publicExport = {
    version: 1,
    exportedAt: '2025-06-14T10:00:00.000Z',
    series: {
      name,
      venue: 'Test YC',
      startDate: '2025-06-14',
      endDate: '',
      discardThresholds: [],
      dnfScoring: 'seriesEntries',
      displayFields: ['club'],
      scoringMode: 'scratch',
    },
    fleets: [{ name: 'Default', displayOrder: 0, scoringSystem: 'scratch' }],
    competitors: [
      { sailNumber: '1', name: 'Alice', club: 'TYC', gender: '', age: null, fleetNames: ['Default'] },
    ],
    races: [
      {
        raceNumber: 1,
        date: '2025-06-14',
        starts: [],
        finishes: [{ sailNumber: '1', sortOrder: 1, resultCode: null, startPresent: null }],
      },
    ],
    standings: [
      {
        fleetName: 'Default',
        rows: [
          { rank: 1, sailNumber: '1', name: 'Alice', racePoints: [1], raceCodes: [null], raceDiscards: [false], totalPoints: 1, netPoints: 1 },
        ],
      },
    ],
  };
  const b64url = Buffer.from(JSON.stringify(publicExport), 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `/import#data=${b64url}`;
}

test('creating a series with a duplicate name is rejected inline', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Autumn League 2025' });

  // Try to create a second series with the same name.
  await page.goto('/series/new?quick=1');
  await page.getByLabel('Name').fill('Autumn League 2025');
  await page.getByRole('button', { name: 'Create series' }).click();

  await expect(page.getByText('A series with this name already exists.')).toBeVisible();
  await expect(page).toHaveURL(/\/series\/new/);

  // Case-insensitive: also rejects 'autumn league 2025'.
  await page.getByLabel('Name').fill('autumn league 2025');
  await page.getByRole('button', { name: 'Create series' }).click();
  await expect(page.getByText('A series with this name already exists.')).toBeVisible();

  // A distinct name succeeds.
  await page.getByLabel('Name').fill('Winter League 2026');
  await page.getByRole('button', { name: 'Create series' }).click();
  await expect(page).toHaveURL(/\/series\/[0-9a-f-]{36}\/competitors$/);
});

test('importing a public export with a colliding name gets (2) / (3) suffixes', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Imported Regatta' });

  // Import 1: expect " (2)" suffix.
  await page.goto(makeImportUrl('Imported Regatta'));
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Open series' }).click();
  await expect(page).toHaveURL(/\/standings$/);
  await expect(page.getByRole('heading', { name: 'Imported Regatta (2)' })).toBeVisible();

  // Import 2: now there's "Imported Regatta" and "Imported Regatta (2)" — expect " (3)".
  await page.goto(makeImportUrl('Imported Regatta'));
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Open series' }).click();
  await expect(page).toHaveURL(/\/standings$/);
  await expect(page.getByRole('heading', { name: 'Imported Regatta (3)' })).toBeVisible();
});

test('renaming a series via Settings persists', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Old Name' });

  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Basic' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByLabel('Name').fill('New Name');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'New Name' })).toBeVisible();

  // Navigate away and back — name should still be 'New Name'.
  await page.getByRole('link', { name: 'Competitors' }).click();
  await expect(page.getByRole('heading', { name: 'New Name' })).toBeVisible();
});

test('renaming a series to an existing name is rejected inline', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Series A' });
  await createSeriesQuick(page, { name: 'Series B' });

  // Rename B → A should fail.
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Basic' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByLabel('Name').fill('Series A');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByText('A series with this name already exists.')).toBeVisible();
  // Header still shows original name.
  await expect(page.getByRole('heading', { name: 'Series B' })).toBeVisible();

  // Renaming B → B (no-op: trims to same name) is allowed.
  await page.getByLabel('Name').fill('Series B');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('A series with this name already exists.')).not.toBeVisible();
});
