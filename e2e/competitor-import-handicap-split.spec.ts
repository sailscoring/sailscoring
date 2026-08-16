import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, importMapColumns, setScoringMode } from './helpers';

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
  await page.getByTestId('competitor-import-input').setInputFiles(csvBuffer(content));
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

  // ── 3. The Fleets step shows the planned fleets ──────────────────────────
  await expect(page.getByRole('dialog')).toBeVisible();
  const dialog = page.getByRole('dialog');
  // One CR 0 group holding two proposed fleets, each name editable.
  await expect(dialog.getByTestId('fleet-group')).toHaveCount(1);
  const fleetRows = dialog.getByTestId('fleet-row');
  await expect(fleetRows).toHaveCount(2);
  await expect(dialog.getByRole('textbox', { name: /CR 0 \(IRC\)/ })).toHaveValue('CR 0 (IRC)');
  await expect(dialog.getByRole('textbox', { name: /CR 0 \(ECHO\)/ })).toHaveValue('CR 0 (ECHO)');
  // Per-fleet boat counts: 2 boats in IRC (Alpha + Bravo), 2 in ECHO (Alpha + Charlie).
  await expect(fleetRows.filter({ hasText: 'IRC' })).toContainText('2 boats');
  await expect(fleetRows.filter({ hasText: 'ECHO' })).toContainText('2 boats');

  // ── 4. Run the import ────────────────────────────────────────────────────
  await importMapColumns(page);
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

test('the Fleets step adds an IRC fleet the entry list says nothing about', async ({ page }) => {
  // The case the step exists for: an NHC entry list with IRC certificates to
  // follow. Nothing in the file says who holds one, so the added fleet takes
  // the whole group and is trimmed later from the certificate listing.
  await createSeriesQuick(page, { name: 'Ratings To Follow' });
  await setScoringMode(page, 'handicap');
  await page.getByRole('link', { name: 'Competitors' }).click();

  await uploadCsv(page, [
    'Sail,Helm,Fleet,NHC',
    'IRL1,Alpha,Cruisers 1,1.020',
    'IRL2,Bravo,Cruisers 1,0.990',
  ].join('\n'));

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // One NHC fleet is proposed, under the bare group name.
  await expect(dialog.getByTestId('fleet-row')).toHaveCount(1);
  await expect(dialog.getByRole('textbox', { name: /Cruisers 1/ })).toHaveValue('Cruisers 1');

  // Ask for IRC as well.
  await dialog.getByTestId('add-system-Cruisers 1').click();
  await page.getByRole('option', { name: 'IRC' }).click();

  const ircRow = dialog.getByTestId('fleet-row').filter({ hasText: 'IRC' });
  await expect(ircRow).toContainText('2 boats');
  // With no IRC column in the file, membership can't be filtered by rating.
  await expect(ircRow).toContainText('no IRC column in this file');
  await expect(ircRow.getByRole('combobox')).toBeDisabled();

  await importMapColumns(page);
  await page.getByRole('button', { name: /Import 2 rows/i }).click();
  await expect(page.getByRole('heading', { name: /import complete/i })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Cruisers 1 (IRC)');
  await page.getByRole('button', { name: 'Done' }).click();

  // Both boats are in both fleets, ready for the certificate import.
  await expect(page.getByRole('row', { name: /IRL1/ })).toContainText('Cruisers 1 (IRC)');
  await expect(page.getByRole('row', { name: /IRL2/ })).toContainText('Cruisers 1 (IRC)');

  // The added fleet really is IRC, so the Update handicaps IRC source can see it.
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByText('Cruisers 1 (IRC) (IRC)')).toBeVisible();
});

test('the Fleets step splits an unsplit entry list by a column of the scorer\'s choosing', async ({ page }) => {
  // No Fleet column: the importer proposes one fleet and offers to split.
  await createSeriesQuick(page, { name: 'Split By Class' });
  await page.getByRole('link', { name: 'Competitors' }).click();

  await uploadCsv(page, [
    'Sail,Helm,Boat Type',
    'IRL1,Alpha,Laser',
    'IRL2,Bravo,Laser',
    'IRL3,Charlie,RS400',
  ].join('\n'));

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('One fleet — all 3 boats');

  await dialog.getByTestId('group-by-column').click();
  await page.getByRole('option', { name: /Boat Type \(2 groups\)/ }).click();

  await expect(dialog.getByTestId('fleet-group')).toHaveCount(2);
  await expect(dialog.getByTestId('fleet-row').filter({ hasText: '2 boats' })).toHaveCount(1);

  await importMapColumns(page);
  await page.getByRole('button', { name: /Import 3 rows/i }).click();
  await expect(page.getByRole('heading', { name: /import complete/i })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('2 new fleets created');
  await page.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByRole('row', { name: /IRL1/ })).toContainText('Laser');
  await expect(page.getByRole('row', { name: /IRL3/ })).toContainText('RS400');
});

test('a grouping column with no Class column is proposed as the boat class too', async ({ page }) => {
  // The "Cruisers 2" common case: the file uses the fleet column as a class
  // label and has no separate Class column. Grouping is not a field role, so
  // that column stays free to be mapped — and with nothing else supplying a
  // boat class, the importer proposes it as one. Visibly, in the mapping
  // table, rather than as a hidden fallback.
  await createSeriesQuick(page, { name: 'Class Fallback Import' });
  await setScoringMode(page, 'handicap');

  await page.getByRole('link', { name: 'Competitors' }).click();
  const csv = [
    'Sail,Helm,Fleet,IRC TCC',
    'IRL10,Eve,Cruisers 2,0.985',
    'IRL11,Frank,Cruisers 2,1.012',
  ].join('\n');
  await uploadCsv(page, csv);

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await importMapColumns(page);

  // The proposal is on screen: the Fleet column is mapped to Class, and the
  // Class field is enabled by the ordinary "a column targets it" rule.
  await expect(dialog.getByRole('row', { name: /^Fleet/ }).getByRole('combobox')).toHaveText('Class');
  await expect(dialog.getByText(/Enabling optional fields:.*Class/)).toBeVisible();

  await page.getByRole('button', { name: /Import 2 rows/i }).click();
  await expect(page.getByRole('heading', { name: /import complete/i })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // The Class column shows "Cruisers 2" for both imported boats.
  await expect(page.getByRole('row', { name: /IRL10/ })).toContainText('Cruisers 2');
  await expect(page.getByRole('row', { name: /IRL11/ })).toContainText('Cruisers 2');
});
