import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, enableFeatures, importMapColumns } from './helpers';
import { resolve } from 'path';

function csvBuffer(content: string) {
  return { name: 'competitors.csv', mimeType: 'text/csv', buffer: Buffer.from(content) };
}

async function uploadCsv(page: import('@playwright/test').Page, content: string) {
  await page.getByTestId('competitor-import-input').setInputFiles(csvBuffer(content));
  // These specs are about column mapping; step past the Fleets step.
  await importMapColumns(page);
}

test('import competitors from CSV', async ({ page }) => {
  // ── 1. Create a series ────────────────────────────────────────────────────
  await createSeriesQuick(page, { name: 'Import Test Series' });

  // ── 2. Add one competitor manually so we can test overwrite & unchanged ───
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('IRL100');
  await page.getByLabel('Competitor name').fill('Original Name');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'IRL100', exact: true })).toBeVisible();

  // ── 3. Upload a CSV ───────────────────────────────────────────────────────
  const csv = [
    'Sail,Helm,Club',
    'IRL100,Updated Name,HYC',   // exists — should update
    'IRL200,Jane Doe,RCYC',      // new
    ',No Sail Number,HYC',       // missing sail — should be skipped
  ].join('\n');

  await uploadCsv(page, csv);

  // ── 4. Mapping dialog appears ─────────────────────────────────────────────
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: /map columns/i })).toBeVisible();

  // ── 5. Import button shows correct row count ──────────────────────────────
  await importMapColumns(page);
  await expect(page.getByRole('button', { name: /Import 3 rows/i })).toBeVisible();

  // ── 6. Run the import ─────────────────────────────────────────────────────
  await importMapColumns(page);
  await page.getByRole('button', { name: /Import 3 rows/i }).click();

  // ── 7. Done dialog shows correct counts ──────────────────────────────────
  await expect(page.getByRole('heading', { name: /import complete/i })).toBeVisible();
  await expect(page.getByText(/1 competitor.* added/i)).toBeVisible();
  await expect(page.getByText(/1 updated/i)).toBeVisible();
  await expect(page.getByText(/1 row.* skipped/i)).toBeVisible();
  await expect(page.getByText(/Row 4: missing sail number/i)).toBeVisible();

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  // ── 8. Competitors table reflects the import ──────────────────────────────
  const irl100Row = page.getByRole('row', { name: /IRL100/ });
  await expect(irl100Row).toContainText('Updated Name');
  await expect(irl100Row).toContainText('HYC');
  await expect(page.getByRole('cell', { name: 'IRL200', exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /IRL200/ })).toContainText('Jane Doe');
  // The skipped row must not have been added
  await expect(page.getByText('No Sail Number')).not.toBeVisible();

  // ── 9. Re-import the same CSV — all matched rows should be unchanged ───────
  await uploadCsv(page, csv);
  await importMapColumns(page);
  await expect(page.getByRole('button', { name: /Import 3 rows/i })).toBeVisible();
  await importMapColumns(page);
  await page.getByRole('button', { name: /Import 3 rows/i }).click();
  await expect(page.getByRole('heading', { name: /import complete/i })).toBeVisible();
  await expect(page.getByText(/0 competitor.* added/i)).toBeVisible();
  await expect(page.getByText(/0 updated/i)).toBeVisible();
  await expect(page.getByText(/2 unchanged/i)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 10. Cancel mid-flow leaves data untouched ────────────────────────────
  await uploadCsv(page, 'Sail,Helm\nIRL999,Should Not Appear\n');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('cell', { name: 'IRL999', exact: true })).not.toBeVisible();
});

test('import CSV auto-detects the Crew column and stores crew names', async ({ page }) => {
  // ── 1. Create a series and enable crew-name display ─────────────────────
  await createSeriesQuick(page, { name: 'Two-Person Dinghy Import' });
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Competitor fields' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByLabel('Crew', { exact: true }).check();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('link', { name: 'Competitors' }).click();

  // ── 2. Upload a CSV with a Crew column ──────────────────────────────────
  const csv = [
    'Sail,Helm,Crew,Club',
    '14702,Jane Doe,Mark Smith,HYC',
    '14801,Chris Brown,,RCYC',    // single-hander, empty crew
  ].join('\n');
  await uploadCsv(page, csv);

  // ── 3. Mapping dialog auto-detects Crew → crewName ──────────────────────
  await expect(page.getByRole('dialog')).toBeVisible();
  await importMapColumns(page);
  await page.getByRole('button', { name: /Import 2 rows/i }).click();
  await expect(page.getByText(/2 competitor.* added/i)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 4. Crew column shows the imported value ─────────────────────────────
  await expect(page.getByRole('columnheader', { name: 'Crew' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Mark Smith' })).toBeVisible();
  const singleHanderRow = page.getByRole('row', { name: /14801/ });
  await expect(singleHanderRow).toContainText('Chris Brown');
});

test('import CSV with Crew 1/Crew 2 columns and a semicolon-separated cell', async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['multi-person-fields']);
  await createSeriesQuick(page, { name: 'Keelboat Crew Import' });
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Competitor fields' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  // Each toggle fires a fire-and-forget series PUT. Wait for both to persist
  // before importing: the mapping dialog snapshots the series' multiPersonFields
  // at file-parse time (via a one-shot GET), so if the "Allow multiple Crew"
  // write hasn't landed the split preview ("Carol Doyle + Dan Egan") never
  // renders and the assertion below times out.
  const seriesWrite = (bodyIncludes: string) => (r: import('@playwright/test').Response) =>
    /\/api\/v1\/series\//.test(r.url()) &&
    r.request().method() !== 'GET' &&
    r.ok() &&
    (r.request().postData() ?? '').includes(bodyIncludes);
  await Promise.all([
    page.waitForResponse(seriesWrite('"enabledCompetitorFields"')),
    page.getByLabel('Crew', { exact: true }).check(),
  ]);
  await Promise.all([
    page.waitForResponse(seriesWrite('"multiPersonFields":["crewName"]')),
    page.getByRole('checkbox', { name: 'Allow multiple Crew' }).check(),
  ]);
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('link', { name: 'Competitors' }).click();

  // Both multi-crew shapes at once: one column per person for 635, and two
  // names sharing one cell (semicolon) for 1024.
  const csv = [
    'Sail,Helm,Crew 1,Crew 2',
    '635,Cormac Farrelly,Alice Byrne,Bob Malone',
    '1024,Kate Lyttle,Carol Doyle; Dan Egan,',
  ].join('\n');
  await uploadCsv(page, csv);

  // Both crew columns auto-detect as Crew; the sample previews the split.
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Carol Doyle + Dan Egan');
  await importMapColumns(page);
  await page.getByRole('button', { name: /Import 2 rows/i }).click();
  await expect(page.getByText(/2 competitor.* added/i)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // Columns append in order; the semicolon cell splits into two names.
  const keelboatRow = page.getByRole('row').filter({ hasText: '635' });
  await expect(keelboatRow).toContainText('Alice Byrne');
  await expect(keelboatRow).toContainText('Bob Malone');
  const splitRow = page.getByRole('row').filter({ hasText: '1024' });
  await expect(splitRow).toContainText('Carol Doyle');
  await expect(splitRow).toContainText('Dan Egan');
});

// The shape an OA entry list arrives in: one column per owner, and a series
// nobody has been to Settings for yet — the import is where the need for
// several names first shows, so the mapping step has to propose the setting
// rather than refuse the columns.
const fourOwnerCsv = [
  'Sail Number,Boat Name,Owner,Owner 2,Owner 3,Club',
  '8188,Freelance,Sarah Allen,Tom Johns,Ruth Arthurs,HYC',
  '2070,Out & About,Terry McCoy,,,HYC',
].join('\n');

test('import proposes opening the primary field when several columns are owners', async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['multi-person-fields']);
  await createSeriesQuick(page, { name: 'Autumn League Entries' });

  await uploadCsv(page, fourOwnerCsv);

  // All three Owner columns map to the primary slot, and the panel states the
  // series change that lets them through instead of refusing the mapping.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Allowing several names per entry: Owners');
  await expect(dialog).not.toContainText('Only one column may be the primary name');

  await importMapColumns(page);
  await page.getByRole('button', { name: /Import 2 rows/i }).click();
  await expect(page.getByText(/2 competitor.* added/i)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // Every owner lands on the boat, in column order.
  const freelance = page.getByRole('row').filter({ hasText: '8188' });
  await expect(freelance).toContainText('Sarah Allen');
  await expect(freelance).toContainText('Tom Johns');
  await expect(freelance).toContainText('Ruth Arthurs');
  const singleOwner = page.getByRole('row').filter({ hasText: '2070' });
  await expect(singleOwner).toContainText('Terry McCoy');

  // The setting was persisted, not just honoured for the one import — the
  // plural column header is the series carrying `primary` in multiPersonFields.
  await expect(page.getByRole('columnheader', { name: 'Owners' })).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Competitor fields' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await expect(page.getByRole('checkbox', { name: 'Allow multiple Owner' })).toBeChecked();
});

test('without the multi-person feature several owner columns are still refused', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Single Owner Entries' });

  await uploadCsv(page, fourOwnerCsv);

  // Nothing to propose: the setting has no UI to undo it in, so the mapping
  // keeps its one-column limit and names the way through.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Only one column may be the primary name');
  await expect(dialog).not.toContainText('Allowing several names per entry');
});

test('import CSV with Club and Other Club columns keeps both affiliations', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Two Club Import' });

  // The standard Irish OA entry sheet: a Club column and an Other Club one,
  // two affiliations of the same boat.
  const csv = [
    'Sail Number,Boat Name,Owner Name,Club,Other Club',
    '1234,Windshift,Aoife Murphy,HYC,RIYC',
    '5678,Bandersnatch,Cormac Farrelly,Sutton DC,',
  ].join('\n');
  await uploadCsv(page, csv);

  // Both club columns auto-detect as Club and are collected, not overwritten.
  await expect(page.getByRole('dialog')).toBeVisible();
  await importMapColumns(page);
  await page.getByRole('button', { name: /Import 2 rows/i }).click();
  await expect(page.getByText(/2 competitor.* added/i)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  const twoClubs = page.getByRole('row').filter({ hasText: '1234' });
  await expect(twoClubs).toContainText('HYC');
  await expect(twoClubs).toContainText('RIYC');
  const oneClub = page.getByRole('row').filter({ hasText: '5678' });
  await expect(oneClub).toContainText('Sutton DC');
});

test('import competitors assigned to multiple fleets', async ({ page }) => {
  // ── 1. Create a series ────────────────────────────────────────────────────
  await createSeriesQuick(page, { name: 'Multi-Fleet Import' });

  // ── 2. Import a CSV with a pipe-delimited fleet cell ─────────────────────
  // Mirrors the HYC Dinghy Frostbite reference CSV: a Melges 15 scored in
  // both PY (handicap) and M15 (scratch).
  const csv = [
    'sailNumber,name,club,fleet',
    '635,Cormac Farrelly,HYC,PY|M15',  // multi-fleet
    '3187,Emmet Dalton,HYC,PY',        // single fleet
  ].join('\n');

  await uploadCsv(page, csv);
  await expect(page.getByRole('dialog')).toBeVisible();
  // Mapping dialog mentions the pipe syntax
  await expect(page.getByRole('dialog')).toContainText('|');
  await importMapColumns(page);
  await page.getByRole('button', { name: /Import 2 rows/i }).click();
  await expect(page.getByRole('heading', { name: /import complete/i })).toBeVisible();
  await expect(page.getByText(/2 competitor.* added/i)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 3. The multi-fleet competitor shows both fleet names ─────────────────
  // Once more than one fleet exists, the table renders a Fleet column that
  // joins the competitor's fleet names with ", ".
  const melgesRow = page.getByRole('row', { name: /635/ });
  await expect(melgesRow).toContainText('Cormac Farrelly');
  await expect(melgesRow).toContainText('PY');
  await expect(melgesRow).toContainText('M15');
  const aeroRow = page.getByRole('row', { name: /3187/ });
  await expect(aeroRow).toContainText('Emmet Dalton');
  await expect(aeroRow).toContainText('PY');
  await expect(aeroRow).not.toContainText('M15');

  // ── 4. Reimporting the same CSV reports unchanged (set-equality check) ───
  await uploadCsv(page, csv);
  await importMapColumns(page);
  await page.getByRole('button', { name: /Import 2 rows/i }).click();
  await expect(page.getByText(/0 competitor.* added/i)).toBeVisible();
  await expect(page.getByText(/0 updated/i)).toBeVisible();
  await expect(page.getByText(/2 unchanged/i)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 5. Removing one fleet from a competitor via reimport ─────────────────
  // Drop M15 from the Melges 15 row. The M15 fleet persists (fleets are
  // explicit managed objects) but the competitor is no longer assigned to it.
  const shrunkCsv = [
    'sailNumber,name,club,fleet',
    '635,Cormac Farrelly,HYC,PY',
    '3187,Emmet Dalton,HYC,PY',
  ].join('\n');
  await uploadCsv(page, shrunkCsv);
  await importMapColumns(page);
  await page.getByRole('button', { name: /Import 2 rows/i }).click();
  await expect(page.getByText(/1 updated/i)).toBeVisible();
  await expect(page.getByText(/1 unchanged/i)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // The competitor is no longer in M15 — their row should show only PY.
  await expect(page.getByRole('row', { name: /635/ })).not.toContainText('M15');
});

test('re-importing after renaming the default fleet reuses it instead of duplicating', async ({ page }) => {
  // Reported flow: import a fleet-less list → a "Default" fleet is minted →
  // the user renames it to "Scratch" → re-importing the same list must reuse
  // that fleet, not create a second "Default" and move the competitors onto it.
  await createSeriesQuick(page, { name: 'Rename Default Reimport' });

  const csv = ['Sail,Helm,Club', 'IRL1,Alice,HYC', 'IRL2,Bob,RCYC'].join('\n');

  // ── 1. First import creates the "Default" fleet with both competitors ─────
  await uploadCsv(page, csv);
  await expect(page.getByRole('dialog')).toBeVisible();
  await importMapColumns(page);
  await page.getByRole('button', { name: /Import 2 rows/i }).click();
  await expect(page.getByText(/2 competitor.* added/i)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 2. Rename the auto-created "Default" fleet to "Scratch" ───────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const fleetsHeading = page.locator('h2', { hasText: 'Fleets' });
  await fleetsHeading.locator('..').getByRole('button', { name: /Edit/ }).click();
  const fleetRows = page.getByTestId('fleet-row');
  await expect(fleetRows).toHaveCount(1);
  await expect(fleetRows.nth(0)).toContainText('Default');
  await fleetRows.nth(0).getByRole('button', { name: 'Rename' }).click();
  const renameInput = fleetRows.nth(0).locator('input');
  await renameInput.fill('Scratch');
  await renameInput.press('Enter');
  await expect(fleetRows.nth(0)).toContainText('Scratch');
  await expect(fleetRows.nth(0)).not.toContainText('Default');

  // ── 3. Re-import the same list — competitors are unchanged, not moved ─────
  await page.getByRole('link', { name: 'Competitors' }).click();
  await uploadCsv(page, csv);
  await importMapColumns(page);
  await page.getByRole('button', { name: /Import 2 rows/i }).click();
  await expect(page.getByText(/2 unchanged/i)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 4. Still exactly one fleet, "Scratch" — no duplicate "Default" ────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await fleetsHeading.locator('..').getByRole('button', { name: /Edit/ }).click();
  await expect(fleetRows).toHaveCount(1);
  await expect(fleetRows.nth(0)).toContainText('Scratch');
  await expect(fleetRows.nth(0)).not.toContainText('Default');
});

test('re-import detects sail number changes and updates in place', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Sail Number Change' });

  // ── 1. Initial entry list ─────────────────────────────────────────────────
  const initial = [
    'Sail,Boat,Helm,Club',
    'IRL100,White Mischief,J. Bloggs,HYC',
    'IRL200,Sea Biscuit,A. Nother,RCYC',
  ].join('\n');
  await uploadCsv(page, initial);
  await importMapColumns(page);
  await page.getByRole('button', { name: /Import 2 rows/i }).click();
  await expect(page.getByText(/2 competitor.* added/i)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 2. Re-import with one boat renumbered (IRL100 → IRL150) ──────────────
  const renumbered = [
    'Sail,Boat,Helm,Club',
    'IRL150,White Mischief,J. Bloggs,HYC',
    'IRL200,Sea Biscuit,A. Nother,RCYC',
  ].join('\n');
  await uploadCsv(page, renumbered);
  await importMapColumns(page);
  await page.getByRole('button', { name: /Import 2 rows/i }).click();

  // ── 3. The review step lists the suspected change ─────────────────────────
  await expect(page.getByRole('heading', { name: /sail number changes/i })).toBeVisible();
  await expect(page.getByText('IRL100 → IRL150')).toBeVisible();
  await expect(page.getByText('White Mischief — J. Bloggs')).toBeVisible();
  await expect(page.getByText('matched on boat name')).toBeVisible();

  // Back returns to the mapping dialog with nothing imported.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: /map columns/i })).toBeVisible();
  await importMapColumns(page);
  await page.getByRole('button', { name: /Import 2 rows/i }).click();
  await expect(page.getByRole('heading', { name: /sail number changes/i })).toBeVisible();

  // ── 4. Accept — the existing competitor is updated, not duplicated ────────
  await page.getByRole('button', { name: /Apply 1 change & import/i }).click();
  await expect(page.getByRole('heading', { name: /import complete/i })).toBeVisible();
  await expect(page.getByText(/0 competitor.* added/i)).toBeVisible();
  await expect(page.getByText(/1 updated/i)).toBeVisible();
  await expect(page.getByText(/1 unchanged/i)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByRole('cell', { name: 'IRL150', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'IRL100', exact: true })).not.toBeVisible();
  await expect(page.getByRole('row', { name: /IRL150/ })).toContainText('White Mischief');

  // ── 5. Reject path: unticking imports the row as a new competitor ─────────
  const renumberedAgain = [
    'Sail,Boat,Helm,Club',
    'IRL175,White Mischief,J. Bloggs,HYC',
    'IRL200,Sea Biscuit,A. Nother,RCYC',
  ].join('\n');
  await uploadCsv(page, renumberedAgain);
  await importMapColumns(page);
  await page.getByRole('button', { name: /Import 2 rows/i }).click();
  await expect(page.getByText('IRL150 → IRL175')).toBeVisible();
  await page.getByRole('checkbox').uncheck();
  await page.getByRole('button', { name: /Import as new competitors/i }).click();
  await expect(page.getByText(/1 competitor.* added/i)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // Both the old and the new number exist now — two separate boats.
  await expect(page.getByRole('cell', { name: 'IRL150', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'IRL175', exact: true })).toBeVisible();
});

test('import competitors from Excel (.xlsx)', async ({ page }) => {
  // The workbook fixture exercises what CSV can't: numeric sail-number
  // cells, a text cell with leading zeros ('007'), and a boat name
  // containing a comma — the case that silently loses boats in CSV land.
  await createSeriesQuick(page, { name: 'XLSX Import Series' });

  await page
    .getByTestId('competitor-import-input')
    .setInputFiles(resolve(__dirname, '../tests/fixtures/xlsx/competitors.xlsx'));
  await importMapColumns(page);

  await expect(page.getByRole('heading', { name: /map columns/i })).toBeVisible();
  await importMapColumns(page);
  await page.getByRole('button', { name: /Import 3 rows/i }).click();
  await expect(page.getByRole('heading', { name: /import complete/i })).toBeVisible();
  await expect(page.getByText(/3 competitor.* added/i)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // Numeric cell → plain sail number; leading zeros and the comma survive.
  await expect(page.getByRole('cell', { name: '1234', exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /1234/ })).toContainText('Rebel');
  await expect(page.getByRole('cell', { name: '007', exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /007/ })).toContainText('Comma, The Boat');
  await expect(page.getByRole('row', { name: /4321/ })).toContainText('Carol Cc');
});

test('multi-sheet workbook offers a sheet picker before mapping', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Multi-Sheet Import' });

  await page
    .getByTestId('competitor-import-input')
    .setInputFiles(resolve(__dirname, '../tests/fixtures/xlsx/multi-sheet.xlsx'));

  // The picker lists only sheets with data — the workbook's empty third
  // sheet must not be offered.
  await expect(page.getByRole('heading', { name: /choose a sheet/i })).toBeVisible();
  await expect(page.getByText('Instructions')).toBeVisible();
  await expect(page.getByText('Entries')).toBeVisible();
  await expect(page.getByText('Empty Sheet')).not.toBeVisible();

  await page.getByRole('radio', { name: /Entries/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();

  await importMapColumns(page);
  await page.getByRole('button', { name: /Import 2 rows/i }).click();
  await expect(page.getByText(/2 competitor.* added/i)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByRole('cell', { name: '101', exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /101/ })).toContainText('Alice Aa');
});

test('CSV import maps two columns to distinct subdivision axes', async ({ page }) => {
  // ── 1. Create a series (no subdivision axes configured yet) ───────────────
  await createSeriesQuick(page, { name: 'Two-Axis Import' });

  // ── 2. Upload a CSV with both a Division and an Age Category column ───────
  const csv = [
    'Sail,Helm,Division,Age Category',
    'IRL1,Alice,Gold,Master',
    'IRL2,Bob,Silver,Youth',
  ].join('\n');
  await uploadCsv(page, csv);

  // ── 3. Both subdivision columns default to a new axis (no axes exist yet),
  //     each named after its column header. ─────────────────────────────────
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("New axis: 'Division'")).toBeVisible();
  await expect(dialog.getByText("New axis: 'Age Category'")).toBeVisible();

  // ── 4. Run the import — one axis is minted per column, named from its header
  await importMapColumns(page);
  await page.getByRole('button', { name: /Import 2 rows/i }).click();
  await expect(page.getByText(/2 competitor.* added/i)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 5. Both axis columns appear in the Competitors table with their values
  await expect(page.getByRole('columnheader', { name: 'Division' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Age Category' })).toBeVisible();
  const aliceRow = page.getByRole('row', { name: /IRL1/ });
  await expect(aliceRow).toContainText('Gold');
  await expect(aliceRow).toContainText('Master');
  const bobRow = page.getByRole('row', { name: /IRL2/ });
  await expect(bobRow).toContainText('Silver');
  await expect(bobRow).toContainText('Youth');

  // ── 6. Re-importing the same CSV now matches the existing axes by name and
  //     reports every row unchanged (no duplicate axes, values land again). ─
  await uploadCsv(page, csv);
  await importMapColumns(page);
  await page.getByRole('button', { name: /Import 2 rows/i }).click();
  await expect(page.getByText(/0 competitor.* added/i)).toBeVisible();
  await expect(page.getByText(/2 unchanged/i)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // Still exactly one Division and one Age Category column (no dupes).
  await expect(page.getByRole('columnheader', { name: 'Division' })).toHaveCount(1);
  await expect(page.getByRole('columnheader', { name: 'Age Category' })).toHaveCount(1);
});

test('re-import that creates no fleets leaves existing fleet membership alone', async ({ page }) => {
  // Reported flow: the series' fleets are already built and named per scoring
  // system — "Cruiser 1 (IRC)", "Cruiser 2 (IRC)" — so a re-import to pull in
  // owner names the first pass couldn't carry proposes a *new* bare
  // "Cruiser 1" for each group, since the group name now matches no fleet.
  // The scorer clears those proposals, because the fleets are already there.
  // Every row then reached the merge with an empty fleet list, which was
  // written straight through and stripped each competitor out of the fleets
  // it was scored in.
  await createSeriesQuick(page, { name: 'Reimport Keeps Fleets' });

  const initial = [
    'Sail,Boat,Owner,Fleet',
    '1543,Indian,Simon Knowles,Cruiser 1',
    '2507,Impetuous,Fergal Noonan,Cruiser 2',
  ].join('\n');
  await page.getByTestId('competitor-import-input').setInputFiles(csvBuffer(initial));
  await importMapColumns(page);
  await page.getByRole('button', { name: /Import 2 rows/i }).click();
  await expect(page.getByText(/2 competitor.* added/i)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 1. Name the fleets the way a scorer does, per scoring system ──────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const fleetsHeading = page.locator('h2', { hasText: 'Fleets' });
  await fleetsHeading.locator('..').getByRole('button', { name: /Edit/ }).click();
  const fleetRows = page.getByTestId('fleet-row');
  await expect(fleetRows).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    await fleetRows.nth(i).getByRole('button', { name: 'Rename' }).click();
    const renameInput = fleetRows.nth(i).locator('input');
    await renameInput.fill(`Cruiser ${i + 1} (IRC)`);
    await renameInput.press('Enter');
    await expect(fleetRows.nth(i)).toContainText(`Cruiser ${i + 1} (IRC)`);
  }

  // ── 2. Re-import corrected owners, creating no fleets ─────────────────────
  await page.getByRole('link', { name: 'Competitors' }).click();
  const corrected = [
    'Sail,Boat,Owner,Fleet',
    '1543,Indian,Simon Knowles & Colm Buckley,Cruiser 1',
    '2507,Impetuous,Fergal Noonan & Robert Chambers,Cruiser 2',
  ].join('\n');
  await page.getByTestId('competitor-import-input').setInputFiles(csvBuffer(corrected));

  // Each proposal is a *new* bare fleet the scorer doesn't want — clear them.
  const dialog = page.getByRole('dialog');
  const proposals = dialog.getByTestId('fleet-row');
  await expect(proposals).toHaveCount(2);
  await proposals.nth(1).getByRole('button', { name: /^Remove / }).click();
  await proposals.nth(0).getByRole('button', { name: /^Remove / }).click();
  await expect(proposals).toHaveCount(0);

  await importMapColumns(page);
  await page.getByRole('button', { name: /Import 2 rows/i }).click();
  await expect(page.getByRole('heading', { name: /import complete/i })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 3. The owners came in, and nobody left their fleet ───────────────────
  const indian = page.getByRole('row', { name: /1543/ });
  await expect(indian).toContainText('Colm Buckley');
  await expect(indian).toContainText('Cruiser 1 (IRC)');
  await expect(page.getByRole('row', { name: /2507/ })).toContainText('Cruiser 2 (IRC)');
});

test('re-import rejoins the fleets the last import bound to the group', async ({ page }) => {
  // #524: an entry list keeps saying "Cruiser 1" while the fleets get renamed
  // to whatever the club calls them. The import records which fleets a group
  // fed, so the next one rejoins them by that binding rather than by reading
  // their names — "IRC 1" carries nothing a name match could use.
  await createSeriesQuick(page, { name: 'Reimport Rejoins Bound' });

  const csv = [
    'Sail,Boat,Owner,Fleet',
    '1543,Indian,Simon Knowles,Cruiser 1',
    '2507,Impetuous,Fergal Noonan,Cruiser 2',
  ].join('\n');
  await page.getByTestId('competitor-import-input').setInputFiles(csvBuffer(csv));
  await importMapColumns(page);
  await page.getByRole('button', { name: /Import 2 rows/i }).click();
  await expect(page.getByText(/2 competitor.* added/i)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // Rename both fleets to something no name match could tie back to the group.
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const fleetsHeading = page.locator('h2', { hasText: 'Fleets' });
  await fleetsHeading.locator('..').getByRole('button', { name: /Edit/ }).click();
  const fleetRows = page.getByTestId('fleet-row');
  await expect(fleetRows).toHaveCount(2);
  for (const [i, name] of [[0, 'IRC 1'], [1, 'The Twos']] as const) {
    await fleetRows.nth(i).getByRole('button', { name: 'Rename' }).click();
    const renameInput = fleetRows.nth(i).locator('input');
    await renameInput.fill(name);
    await renameInput.press('Enter');
    // Wait for the write before the next rename — two fleet saves in flight
    // at once conflict on the series version.
    await expect(fleetRows.nth(i)).toContainText(name);
  }

  // ── Re-import: the step proposes rejoining, not creating ─────────────────
  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByTestId('competitor-import-input').setInputFiles(csvBuffer(csv));
  const dialog = page.getByRole('dialog');
  const proposals = dialog.getByTestId('fleet-row');
  await expect(proposals).toHaveCount(2);
  await expect(proposals.nth(0)).toContainText('IRC 1');
  await expect(proposals.nth(1)).toContainText('The Twos');
  // An existing fleet shows as text, not a rename box — nothing is created.
  await expect(proposals.nth(0).locator('input')).toHaveCount(0);

  await importMapColumns(page);
  await page.getByRole('button', { name: /Import 2 rows/i }).click();
  await expect(page.getByRole('heading', { name: /import complete/i })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── Still two fleets, still the renamed ones ─────────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await fleetsHeading.locator('..').getByRole('button', { name: /Edit/ }).click();
  await expect(fleetRows).toHaveCount(2);
  await expect(fleetRows.nth(0)).toContainText('IRC 1');
  await expect(fleetRows.nth(1)).toContainText('The Twos');
});

test('a proposed fleet can be re-scored in place, without deleting and re-adding', async ({ page }) => {
  // #519: the system was static text, so the only way off the auto-proposed
  // Scratch was to delete the proposal and add the one you wanted back.
  await createSeriesQuick(page, { name: 'Rescore In Place' });

  const csv = [
    'Sail,Boat,Owner,Fleet',
    '1543,Indian,Simon Knowles,Cruiser 1',
    '2507,Impetuous,Fergal Noonan,Cruiser 2',
  ].join('\n');
  await page.getByTestId('competitor-import-input').setInputFiles(csvBuffer(csv));

  const dialog = page.getByRole('dialog');
  const proposals = dialog.getByTestId('fleet-row');
  await expect(proposals).toHaveCount(2);

  // No rating columns, so both groups are proposed as Scratch.
  const cruiser1 = proposals.nth(0);
  await expect(cruiser1).toContainText('Scratch');

  // Re-score it on NHC in place; the name the plan chose is kept.
  await cruiser1.getByRole('combobox', { name: /^Scored on for/ }).click();
  await page.getByRole('option', { name: 'NHC' }).click();
  await expect(proposals).toHaveCount(2);
  await expect(proposals.nth(0)).toContainText('NHC');
  await expect(proposals.nth(1)).toContainText('Scratch');

  await importMapColumns(page);
  await page.getByRole('button', { name: /Import 2 rows/i }).click();
  await expect(page.getByRole('heading', { name: /import complete/i })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── The created fleets carry the systems chosen on the step ──────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const fleetsHeading = page.locator('h2', { hasText: 'Fleets' });
  await fleetsHeading.locator('..').getByRole('button', { name: /Edit/ }).click();
  const fleetRows = page.getByTestId('fleet-row');
  await expect(fleetRows).toHaveCount(2);
  await expect(fleetRows.nth(0)).toContainText('NHC');
  await expect(fleetRows.nth(1)).toContainText('Scratch');
});

test('an ORC fleet can be created from the import Fleets step', async ({ page, signedInEmail }) => {
  // #521: ORC was offered by the series Fleets card but by nothing in the
  // import step, so a series needing one (Non-Spinnaker 5, a sportsboat
  // division) could not be finished here — with no reason given.
  await createSeriesQuick(page, { name: 'ORC From Import' });
  await enableFeatures(page, signedInEmail, ['orc']);
  await page.goto(page.url());

  const csv = [
    'Sail,Boat,Owner,Fleet',
    '971,Leeuwin,Eamonn Burke,Non-Spinnaker 5',
  ].join('\n');
  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByTestId('competitor-import-input').setInputFiles(csvBuffer(csv));

  const dialog = page.getByRole('dialog');
  const proposals = dialog.getByTestId('fleet-row');
  await expect(proposals).toHaveCount(1);
  await proposals.nth(0).getByRole('combobox', { name: /^Scored on for/ }).click();
  await page.getByRole('option', { name: 'ORC' }).click();
  await expect(proposals.nth(0)).toContainText('ORC');
  // And it says where the ratings come from, rather than naming a missing column.
  await expect(proposals.nth(0)).toContainText(/certificates come from the ORC database/i);

  await importMapColumns(page);
  await page.getByRole('button', { name: /Import 1 row/i }).click();
  await expect(page.getByRole('heading', { name: /import complete/i })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const fleetsHeading = page.locator('h2', { hasText: 'Fleets' });
  await fleetsHeading.locator('..').getByRole('button', { name: /Edit/ }).click();
  await expect(page.getByTestId('fleet-row').nth(0)).toContainText('ORC');
});

test('the Edit competitor dialog keeps Save reachable on a short viewport', async ({ page }) => {
  // #528: the dialog is fixed and centred with no height cap, so a form grown
  // by the series config overflowed top and bottom at once and Save could not
  // be scrolled to.
  await createSeriesQuick(page, { name: 'Tall Edit Dialog' });
  const csv = ['Sail,Boat,Owner,Club', '1543,Indian,Simon Knowles,HYC'].join('\n');
  await page.getByTestId('competitor-import-input').setInputFiles(csvBuffer(csv));
  await importMapColumns(page);
  await page.getByRole('button', { name: /Import 1 row/i }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  // A viewport the form comfortably outgrows.
  await page.setViewportSize({ width: 1280, height: 320 });
  await page.getByRole('row', { name: /1543/ }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const save = dialog.getByRole('button', { name: /^Save/ });
  await save.scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport();

  // The dialog itself stays within the viewport, top and bottom.
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(320);
});
