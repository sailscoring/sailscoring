import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

function csvBuffer(content: string) {
  return { name: 'competitors.csv', mimeType: 'text/csv', buffer: Buffer.from(content) };
}

async function uploadCsv(page: import('@playwright/test').Page, content: string) {
  await page.locator('input[type=file][accept=".csv,text/csv"]').setInputFiles(csvBuffer(content));
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
  await page.getByLabel('Crew name').check();
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
