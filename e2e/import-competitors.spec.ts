import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';
import { resolve } from 'path';

function csvBuffer(content: string) {
  return { name: 'competitors.csv', mimeType: 'text/csv', buffer: Buffer.from(content) };
}

async function uploadCsv(page: import('@playwright/test').Page, content: string) {
  await page.getByTestId('competitor-import-input').setInputFiles(csvBuffer(content));
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
  await expect(page.getByRole('button', { name: /Import 3 rows/i })).toBeVisible();

  // ── 6. Run the import ─────────────────────────────────────────────────────
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
  await expect(page.getByRole('button', { name: /Import 3 rows/i })).toBeVisible();
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
  await page.getByRole('button', { name: /Import 2 rows/i }).click();
  await expect(page.getByText(/2 competitor.* added/i)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 4. Crew column shows the imported value ─────────────────────────────
  await expect(page.getByRole('columnheader', { name: 'Crew' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Mark Smith' })).toBeVisible();
  const singleHanderRow = page.getByRole('row', { name: /14801/ });
  await expect(singleHanderRow).toContainText('Chris Brown');
});

test('import CSV with Crew 1/Crew 2 columns and a semicolon-separated cell', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Keelboat Crew Import' });
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Competitor fields' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByLabel('Crew', { exact: true }).check();
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
  await page.getByRole('button', { name: /Import 2 rows/i }).click();

  // ── 3. The review step lists the suspected change ─────────────────────────
  await expect(page.getByRole('heading', { name: /sail number changes/i })).toBeVisible();
  await expect(page.getByText('IRL100 → IRL150')).toBeVisible();
  await expect(page.getByText('White Mischief — J. Bloggs')).toBeVisible();
  await expect(page.getByText('matched on boat name')).toBeVisible();

  // Back returns to the mapping dialog with nothing imported.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: /map columns/i })).toBeVisible();
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

  await expect(page.getByRole('heading', { name: /map columns/i })).toBeVisible();
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

  await expect(page.getByRole('heading', { name: /map columns/i })).toBeVisible();
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
  await page.getByRole('button', { name: /Import 2 rows/i }).click();
  await expect(page.getByText(/0 competitor.* added/i)).toBeVisible();
  await expect(page.getByText(/2 unchanged/i)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // Still exactly one Division and one Age Category column (no dupes).
  await expect(page.getByRole('columnheader', { name: 'Division' })).toHaveCount(1);
  await expect(page.getByRole('columnheader', { name: 'Age Category' })).toHaveCount(1);
});
