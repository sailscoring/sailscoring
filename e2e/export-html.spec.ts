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

test('export HTML downloads a .html file with correct standings', async ({ page }) => {
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
  expect(download.suggestedFilename()).toMatch(/howth-cup-2025\.html$/);

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
  expect(exportData.version).toBe(2);
  expect(exportData.series.name).toBe('Howth Cup 2025');
  expect(exportData.competitors).toHaveLength(3);
  expect(exportData.standings[0].rows[0].sailNumber).toBe('42'); // Alice wins

  // JSON blob is private-field-free
  expect(exportData).not.toHaveProperty('snapshotId');
  expect(exportData).not.toHaveProperty('snapshotHistory');
  expect('ftpHost' in exportData).toBe(false);

  // JSON blob appears after the visible footer (i.e. at the end of <body>)
  const footerIdx = html.indexOf('sailscoring.ie');
  const jsonBlobIdx = html.indexOf('sail-scoring-data');
  expect(jsonBlobIdx).toBeGreaterThan(footerIdx);
});

/**
 * Multi-fleet IRC handicap export test.
 *
 * Two fleets: Cruiser (scratch, 2 boats) and IRC (IRC scoring, 3 boats).
 * 1 race. IRC fleet has a start at 14:00:00, finish times recorded.
 *
 * IRC fleet:
 *   B1 (TCC=1.100): finishes 14:25:00 → ET=1500s → CT=1650.0s → 1st
 *   B2 (TCC=1.050): finishes 14:28:00 → ET=1680s → CT=1764.0s → 2nd
 *   B3 (TCC=1.000): finishes 14:30:00 → ET=1800s → CT=1800.0s → 3rd
 *
 * Cruiser fleet:
 *   C1 finishes 1st, C2 finishes 2nd (scratch positions)
 *
 * Exported JSON should include fleets, competitor fleetNames/ratings,
 * per-race starts, finish times, and per-fleet standings.
 */
test('multi-fleet IRC export includes fleets, ratings, starts, times, and per-fleet standings', async ({ page }) => {
  // ── 1. Create series ──────────────────────────────────────────────────────
  await page.goto('/');
  await page.getByRole('link', { name: 'New series' }).click();
  await page.getByLabel('Name').fill('Multi-Fleet Export Test');
  await page.getByRole('button', { name: 'Create series' }).click();
  await expect(page).toHaveURL(/\/competitors$/);

  // ── 2. Add competitors: 3 IRC, 2 Cruiser ─────────────────────────────────
  const boats = [
    { sail: 'B1', name: 'Fast One', fleet: 'IRC' },
    { sail: 'B2', name: 'Mid Two', fleet: 'IRC' },
    { sail: 'B3', name: 'Slow Three', fleet: 'IRC' },
    { sail: 'C1', name: 'Cruiser Alpha', fleet: 'Cruiser' },
    { sail: 'C2', name: 'Cruiser Beta', fleet: 'Cruiser' },
  ];
  for (const b of boats) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(b.sail);
    await page.getByLabel('Helm name').fill(b.name);
    await page.getByLabel('Fleet').fill(b.fleet);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: b.sail })).toBeVisible();
  }

  // ── 3. Set IRC fleet scoring system to IRC ────────────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const fleetsHeading = page.getByRole('heading', { name: 'Fleets', level: 2 });
  await fleetsHeading.locator('..').getByRole('button', { name: /Edit/ }).click();
  // Find the IRC fleet's combobox and change to IRC
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).first().click();
  await page.getByRole('option', { name: 'IRC' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 4. Set TCC ratings on IRC boats ───────────────────────────────────────
  await page.getByRole('link', { name: 'Competitors' }).click();
  const tccs: Record<string, string> = { B1: '1.100', B2: '1.050', B3: '1.000' };
  for (const sail of ['B1', 'B2', 'B3']) {
    const row = page.getByRole('row').filter({ hasText: sail });
    await row.getByRole('button', { name: /Edit/ }).click();
    await page.getByLabel('IRC TCC').fill(tccs[sail]);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: sail })).toBeVisible();
  }

  // ── 5. Add a race ─────────────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 1')).toBeVisible();

  // ── 6. Enter race results ─────────────────────────────────────────────────
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  // Add start time for IRC fleet
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05:00').fill('14:00:00');
  await page.getByLabel('IRC').check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('14:00:00')).toBeVisible();

  // Add IRC finishers with times
  for (const { sail, time } of [
    { sail: 'B1', time: '14:25:00' },
    { sail: 'B2', time: '14:28:00' },
    { sail: 'B3', time: '14:30:00' },
  ]) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('textbox', { name: 'Finish time', exact: true }).fill(time);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }

  // Add Cruiser finishers (scratch, no times)
  for (const sail of ['C1', 'C2']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }

  await page.getByRole('button', { name: 'Save results' }).click();
  await expect(page).toHaveURL(/\/races$/);

  // ── 7. Navigate to Standings and export IRC fleet HTML ────────────────────
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByRole('heading', { name: 'IRC' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cruiser' })).toBeVisible();

  // Export IRC fleet HTML via dropdown
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.getByRole('button', { name: /Export HTML/ }).click();
      await page.getByRole('menuitem', { name: 'IRC' }).click();
    })(),
  ]);

  // ── 8. Read and parse the HTML ────────────────────────────────────────────
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const html = Buffer.concat(chunks).toString('utf-8');

  // Race detail table should show IRC-specific columns
  expect(html).toContain('<th>TCC</th>');
  expect(html).toContain('<th>Finish</th>');
  expect(html).toContain('<th>ET</th>');
  expect(html).toContain('<th>CT</th>');

  // Start time in race header
  expect(html).toContain('Start: 14:00:00');

  // TCC values appear
  expect(html).toContain('1.100');
  expect(html).toContain('1.050');
  expect(html).toContain('1.000');

  // Finish times appear
  expect(html).toContain('14:25:00');
  expect(html).toContain('14:28:00');
  expect(html).toContain('14:30:00');

  // ── 9. Verify the embedded JSON blob ──────────────────────────────────────
  const jsonMatch = html.match(/<script type="application\/json" id="sail-scoring-data">\n([\s\S]*?)\n<\/script>/);
  expect(jsonMatch).not.toBeNull();
  const data = JSON.parse(jsonMatch![1]);
  expect(data.version).toBe(2);

  // Fleets
  expect(data.fleets).toHaveLength(2);
  const ircFleet = data.fleets.find((f: { name: string }) => f.name === 'IRC');
  const cruiserFleet = data.fleets.find((f: { name: string }) => f.name === 'Cruiser');
  expect(ircFleet.scoringSystem).toBe('irc');
  expect(cruiserFleet.scoringSystem).toBe('scratch');

  // Competitors have fleetNames and ratings
  const b1 = data.competitors.find((c: { sailNumber: string }) => c.sailNumber === 'B1');
  expect(b1.fleetNames).toContain('IRC');
  expect(b1.ircTcc).toBe(1.1);
  const c1 = data.competitors.find((c: { sailNumber: string }) => c.sailNumber === 'C1');
  expect(c1.fleetNames).toContain('Cruiser');
  expect(c1.ircTcc).toBeUndefined();

  // Race starts
  const race1 = data.races[0];
  expect(race1.starts).toHaveLength(1);
  expect(race1.starts[0].fleetNames).toContain('IRC');
  expect(race1.starts[0].startTime).toBe('14:00:00');

  // Finish times in race finishes
  const b1Finish = race1.finishes.find((f: { sailNumber: string }) => f.sailNumber === 'B1');
  expect(b1Finish.finishTime).toBe('14:25:00');
  // Scratch finishers have no finish time
  const c1Finish = race1.finishes.find((f: { sailNumber: string }) => f.sailNumber === 'C1');
  expect(c1Finish.finishTime).toBeUndefined();

  // Per-fleet standings
  expect(data.standings).toHaveLength(2);
  const ircStandings = data.standings.find((s: { fleetName: string }) => s.fleetName === 'IRC');
  const cruiserStandings = data.standings.find((s: { fleetName: string }) => s.fleetName === 'Cruiser');
  expect(ircStandings.rows).toHaveLength(3);
  expect(ircStandings.rows[0].sailNumber).toBe('B1'); // lowest CT → 1st
  expect(cruiserStandings.rows).toHaveLength(2);
  expect(cruiserStandings.rows[0].sailNumber).toBe('C1');
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
