import { test, expect } from './fixtures';

/**
 * E2E tests for the Export HTML feature (issue #13).
 *
 * Series: "Howth Cup 2025", venue "Howth Yacht Club"
 * 3 competitors, 2 races, scratch scoring (N=3, penalty=4).
 *
 * Race 1: 1=Alice(42), 2=Bob(99), Carol(7)=DNF
 *         Points: Alice=1, Bob=2, Carol=4
 *
 * Race 2: 1=Carol(7), 2=Alice(42), Bob(99)=DNC(implicit)
 *         Points: Carol=1, Alice=2, Bob=4
 *
 * Series totals: Alice=3, Carol=5, Bob=6
 * Expected standings: 1=Alice(3), 2=Carol(5), 3=Bob(6)
 */

test('export HTML downloads a .htm file with correct standings', async ({ page }) => {
  // ── 1. Create series ──────────────────────────────────────────────────────
  await page.goto('/');
  await page.getByRole('link', { name: 'New series' }).click();
  await page.getByLabel('Name').fill('Howth Cup 2025');
  await page.getByLabel('Venue').fill('Howth Yacht Club');
  await page.getByRole('button', { name: 'Create series' }).click();
  await expect(page).toHaveURL(/\/competitors$/);

  // ── 2. Add 3 competitors ──────────────────────────────────────────────────
  for (const [sailNumber, name, club] of [
    ['42', 'Alice Murphy', 'HYC'],
    ['99', 'Bob Kelly', 'RCYC'],
    ['7', 'Carol Ryan', 'HYC'],
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(sailNumber);
    await page.getByLabel('Helm name').fill(name);
    await page.getByLabel('Club').fill(club);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: sailNumber })).toBeVisible();
  }

  // ── 3. Add 2 races ────────────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 2')).toBeVisible();

  // ── 4. Enter Race 1: Alice 1st, Bob 2nd, Carol=DNF ────────────────────────
  await page.getByText('Race 1').click();
  for (const sail of ['42', '99']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }
  await page.getByTestId('non-finisher-7').getByRole('combobox').click();
  await page.getByRole('option', { name: 'DNF' }).click();
  await page.getByRole('button', { name: 'Save results' }).click();
  await expect(page).toHaveURL(/\/races$/);

  // ── 5. Enter Race 2: Carol 1st, Alice 2nd, Bob=implicit DNC ──────────────
  await page.getByText('Race 2').click();
  for (const sail of ['7', '42']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }
  await page.getByRole('button', { name: 'Save results' }).click();
  await expect(page).toHaveURL(/\/races$/);

  // ── 6. Navigate to Standings and trigger export ───────────────────────────
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);
  await expect(page.getByText('2 races')).toBeVisible();

  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export HTML' }).click(),
  ]).then(([dl]) => dl);

  // ── 7. Verify filename ────────────────────────────────────────────────────
  expect(download.suggestedFilename()).toMatch(/howth-cup-2025\.htm$/);

  // ── 8. Read and parse downloaded HTML ────────────────────────────────────
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const html = Buffer.concat(chunks).toString('utf-8');

  // Basic document structure
  expect(html).toContain('<!doctype html>');
  expect(html).toContain('</html>');

  // Series identity
  expect(html).toContain('Howth Cup 2025');
  expect(html).toContain('Howth Yacht Club');

  // Provisional timestamp present (export always sets generatedAt)
  expect(html).toContain('Results are provisional as of');

  // All three competitors appear
  expect(html).toContain('Alice Murphy');
  expect(html).toContain('Bob Kelly');
  expect(html).toContain('Carol Ryan');

  // Correct ordinal ranks in standings
  expect(html).toContain('1st');
  expect(html).toContain('2nd');
  expect(html).toContain('3rd');

  // Race column headers link to race detail sections
  expect(html).toContain('href="#r1"');
  expect(html).toContain('href="#r2"');
  expect(html).toContain('id="r1"');
  expect(html).toContain('id="r2"');

  // Result codes appear (Carol DNF in race 1, Bob DNC in race 2)
  expect(html).toContain('DNF');
  expect(html).toContain('DNC');

  // Gold highlight on 1st-place scores
  expect(html).toContain('class="rank1"');

  // Sail Scoring footer
  expect(html).toContain('sailscoring.ie');

  // No Nett column (no discards)
  expect(html).not.toContain('<th>Nett</th>');

  // Self-contained: no external stylesheet or script links
  expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/);
  expect(html).not.toMatch(/<script[^>]+src=/);

  // JSON export embedded — includeJsonExport defaults to true
  expect(html).toContain('id="sail-scoring-data"');
  // Footer always shows "Open in Sail Scoring" (NEXT_PUBLIC_APP_URL is required)
  expect(html).toContain('Open in Sail Scoring');
  expect(html).toContain('?import=');

  // JSON blob is valid and contains the series data
  const jsonMatch = html.match(/<script type="application\/json" id="sail-scoring-data">\n([\s\S]*?)\n<\/script>/);
  expect(jsonMatch).not.toBeNull();
  const exportData = JSON.parse(jsonMatch![1]);
  expect(exportData.version).toBe(1);
  expect(exportData.series.name).toBe('Howth Cup 2025');
  expect(exportData.competitors).toHaveLength(3);
  expect(exportData.standings[0].sailNumber).toBe('42'); // Alice wins

  // JSON blob is private-field-free
  expect(exportData).not.toHaveProperty('snapshotId');
  expect(exportData).not.toHaveProperty('snapshotHistory');
  expect('ftpHost' in exportData).toBe(false);

  // JSON blob appears after the visible footer (i.e. at the end of <body>)
  const footerIdx = html.indexOf('sailscoring.ie');
  const jsonBlobIdx = html.indexOf('sail-scoring-data');
  expect(jsonBlobIdx).toBeGreaterThan(footerIdx);
});

// Shared fixture for import flow tests
function makeImportUrl() {
  const publicExport = {
    version: 1,
    exportedAt: '2025-06-14T10:00:00.000Z',
    series: {
      name: 'Imported Regatta',
      venue: 'Test YC',
      startDate: '2025-06-14',
      endDate: '',
      discardThresholds: [],
      dnfScoring: 'seriesEntries',
    },
    competitors: [
      { sailNumber: '1', name: 'Alice', club: 'TYC', gender: '', age: null },
      { sailNumber: '2', name: 'Bob', club: 'TYC', gender: '', age: null },
    ],
    races: [
      {
        raceNumber: 1,
        date: '2025-06-14',
        finishes: [
          { sailNumber: '1', finishPosition: 1, resultCode: null, startPresent: null },
          { sailNumber: '2', finishPosition: 2, resultCode: null, startPresent: null },
        ],
      },
    ],
    standings: [
      { rank: 1, sailNumber: '1', name: 'Alice', racePoints: [1], raceCodes: [null], raceDiscards: [false], totalPoints: 1, netPoints: 1 },
      { rank: 2, sailNumber: '2', name: 'Bob', racePoints: [2], raceCodes: [null], raceDiscards: [false], totalPoints: 2, netPoints: 2 },
    ],
  };
  const b64url = Buffer.from(JSON.stringify(publicExport), 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `/?import=${b64url}`;
}

test('Open in Sail Scoring import flow creates a new series', async ({ page }) => {
  await page.goto(makeImportUrl());

  // Import dialog should appear with the correct series name
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('Imported Regatta')).toBeVisible();

  // Confirm the import
  await page.getByRole('button', { name: 'Open series' }).click();

  // Should navigate to the new series standings page
  await expect(page).toHaveURL(/\/standings$/);

  // Standings page shows the imported data
  await expect(page.getByText('Alice')).toBeVisible();
  await expect(page.getByText('Bob')).toBeVisible();

  // URL should be clean (no ?import= param) after navigation
  expect(page.url()).not.toContain('import=');
});

test('import dialog does not re-open after confirming and navigating back home', async ({ page }) => {
  await page.goto(makeImportUrl());
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Open series' }).click();
  await expect(page).toHaveURL(/\/standings$/);

  // Navigate away then back home via the header link
  await page.getByRole('link', { name: 'Help' }).click();
  await expect(page).toHaveURL('/help');
  await page.getByRole('banner').getByRole('link', { name: 'Sail Scoring' }).click();
  await expect(page).toHaveURL('/');

  // Dialog must not re-open — this was a regression caused by Next.js router cache
  // restoring the /?import= URL when the home page component remounted.
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(page.url()).not.toContain('import=');
});

test('import dialog does not re-open after cancelling and navigating back home', async ({ page }) => {
  await page.goto(makeImportUrl());
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  // Navigate away then back home
  await page.getByRole('link', { name: 'Help' }).click();
  await expect(page).toHaveURL('/help');
  await page.getByRole('banner').getByRole('link', { name: 'Sail Scoring' }).click();
  await expect(page).toHaveURL('/');

  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(page.url()).not.toContain('import=');
});
