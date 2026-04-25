import { test, expect } from './fixtures';
import { createSeriesQuick, setScoringMode } from './helpers';

/**
 * E2E test for handicap-aware fleet auto-creation in the CSV competitor
 * import wizard.
 *
 * Scenario: a single CSV fleet column ("CR 0") with two rating columns
 * (IRC TCC and ECHO starting handicap). With the series in handicap mode,
 * the importer should split CR 0 into two fleets — one IRC, one ECHO —
 * and assign each competitor to the fleet(s) matching their populated
 * ratings.
 */

function csvBuffer(content: string) {
  return { name: 'competitors.csv', mimeType: 'text/csv', buffer: Buffer.from(content) };
}

async function uploadCsv(page: import('@playwright/test').Page, content: string) {
  await page.locator('input[type=file][accept=".csv,text/csv"]').setInputFiles(csvBuffer(content));
}

test('handicap-mode CSV import splits a fleet by populated rating systems', async ({ page }) => {
  // ── 1. Create series and set handicap mode ───────────────────────────────
  await createSeriesQuick(page, { name: 'Handicap Split Import' });
  await setScoringMode(page, 'handicap');

  // ── 2. Upload a CSV: three boats in CR 0, mixed IRC/ECHO ratings ────────
  // - Alpha: both IRC and ECHO   → joins CR 0 (IRC) and CR 0 (ECHO)
  // - Bravo: only IRC            → joins CR 0 (IRC) only
  // - Charlie: only ECHO         → joins CR 0 (ECHO) only
  await page.getByRole('link', { name: 'Competitors' }).click();
  const csv = [
    'Sail,Helm,Fleet,IRC TCC,ECHO',
    'IRL1,Alpha,CR 0,1.020,0.980',
    'IRL2,Bravo,CR 0,1.000,',
    'IRL3,Charlie,CR 0,,1.010',
  ].join('\n');
  await uploadCsv(page, csv);

  // ── 3. Mapping dialog shows the planned fleets ───────────────────────────
  await expect(page.getByRole('dialog')).toBeVisible();
  const dialog = page.getByRole('dialog');
  // Both proposed fleet names appear under a single CR 0 group.
  await expect(dialog.getByText('CR 0 (IRC)', { exact: true })).toBeVisible();
  await expect(dialog.getByText('CR 0 (ECHO)', { exact: true })).toBeVisible();
  // Per-fleet boat counts: 2 boats in IRC (Alpha + Bravo), 2 in ECHO (Alpha + Charlie).
  await expect(dialog.getByText(/IRC.*2 boats/i)).toBeVisible();
  await expect(dialog.getByText(/ECHO.*2 boats/i)).toBeVisible();

  // ── 4. Run the import ────────────────────────────────────────────────────
  await page.getByRole('button', { name: /Import 3 rows/i }).click();
  await expect(page.getByRole('heading', { name: /import complete/i })).toBeVisible();
  await expect(page.getByText(/3 competitor.* added/i)).toBeVisible();
  // The done dialog lists both auto-created fleets (order independent).
  const doneDialog = page.getByRole('dialog');
  await expect(doneDialog).toContainText(/2 new fleets created/i);
  await expect(doneDialog).toContainText('CR 0 (IRC)');
  await expect(doneDialog).toContainText('CR 0 (ECHO)');
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 5. Two fleets exist in Settings, with the correct scoring systems ────
  // The Fleets card's collapsed view shows "<name> (<SYSTEM>...)" per fleet —
  // ECHO additionally shows the α value, which is unique to ECHO and proves
  // the system was set correctly during import.
  const settingsLink = page.getByRole('navigation').getByRole('link', { name: 'Settings' });
  await settingsLink.click();
  await expect(page.getByText('CR 0 (IRC) (IRC)')).toBeVisible();
  await expect(page.getByText('CR 0 (ECHO) (ECHO, α=0.25)')).toBeVisible();

  // ── 6. Membership: Alpha is in both, Bravo only in IRC, Charlie only ECHO ─
  await page.getByRole('link', { name: 'Competitors' }).click();
  const alphaRow = page.getByRole('row', { name: /IRL1/ });
  const bravoRow = page.getByRole('row', { name: /IRL2/ });
  const charlieRow = page.getByRole('row', { name: /IRL3/ });
  await expect(alphaRow).toContainText('CR 0 (IRC)');
  await expect(alphaRow).toContainText('CR 0 (ECHO)');
  await expect(bravoRow).toContainText('CR 0 (IRC)');
  await expect(bravoRow).not.toContainText('CR 0 (ECHO)');
  await expect(charlieRow).toContainText('CR 0 (ECHO)');
  await expect(charlieRow).not.toContainText('CR 0 (IRC)');
});

test('handicap-mode CSV import without a Class column saves the fleet name as boatClass', async ({ page }) => {
  // The "Cruisers 2" common case: the CSV uses the fleet column as a class
  // label and has no separate Class column. With no existing competitor
  // carrying boatClass, the importer falls back to writing the original
  // fleet name into boatClass so the grouping isn't lost when boats split
  // into rating fleets.
  await createSeriesQuick(page, { name: 'Class Fallback Import' });
  await setScoringMode(page, 'handicap');

  // Make the Class column visible so we can assert on it after import.
  const settingsLink = page.getByRole('navigation').getByRole('link', { name: 'Settings' });
  await settingsLink.click();
  await page.getByRole('heading', { name: 'Competitor fields' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByLabel('Class').check();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('link', { name: 'Competitors' }).click();

  // CSV with no Class column. The fleet name "Cruisers 2" should land in boatClass.
  const csv = [
    'Sail,Helm,Fleet,IRC TCC',
    'IRL10,Eve,Cruisers 2,0.985',
    'IRL11,Frank,Cruisers 2,1.012',
  ].join('\n');
  await uploadCsv(page, csv);

  // Hint text in the dialog explains the fallback.
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText(/No Class column detected/i)).toBeVisible();

  await page.getByRole('button', { name: /Import 2 rows/i }).click();
  await expect(page.getByRole('heading', { name: /import complete/i })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // The Class column shows "Cruisers 2" for both imported boats.
  const eveRow = page.getByRole('row', { name: /IRL10/ });
  const frankRow = page.getByRole('row', { name: /IRL11/ });
  await expect(eveRow).toContainText('Cruisers 2');
  await expect(frankRow).toContainText('Cruisers 2');
});
