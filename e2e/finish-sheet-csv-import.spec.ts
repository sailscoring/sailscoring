import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, enableFeatures } from './helpers';
import { resolve } from 'path';

/**
 * E2E for the per-race finish sheet importer (CSV and .xlsx).
 *
 * Covers: the happy path (map → preview → confirm), auto-detection of headers,
 * result codes for non-finishers, unregistered sail numbers importing as
 * unresolved crossings, replace-all semantics, and the same flow fed from an
 * Excel workbook with real time-formatted cells.
 *
 * Finish-sheet import is a gated experimental feature (#155); enable it so
 * the Import sheet control appears.
 */

test.beforeEach(async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['csv-finish-import']);
});

function csvBuffer(content: string) {
  return { name: 'finishes.csv', mimeType: 'text/csv', buffer: Buffer.from(content) };
}

test('import per-race finish sheet from CSV', async ({ page }) => {
  // ── 1. Create a series with 4 competitors ──────────────────────────────────
  await createSeriesQuick(page, { name: 'CSV Import Race' });

  for (const c of [
    { sail: '15',   name: 'Alice Pearson' },
    { sail: '22',   name: 'Bob Dickson' },
    { sail: '254',  name: 'Carol Walls' },
    { sail: '6413', name: 'Dave Murphy' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sail);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sail, exact: true })).toBeVisible();
  }

  // ── 2. Add a race and open it ──────────────────────────────────────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  // ── 3. Upload a CSV with headers — 3 finishers, 1 DNF, 1 unregistered sail ─
  const csv = [
    'sailNumber,finishTime,resultCode',
    '6413,11:55:09,',      // finisher 1
    '15,11:57:37,',        // finisher 2
    '9999,11:58:00,',      // unregistered — imports as unresolved
    '22,,DNF',             // coded non-finisher
    '254,,',               // malformed — should be reported in preview errors
  ].join('\n');

  await page
    .getByTestId('finish-sheet-csv-input')
    .setInputFiles(csvBuffer(csv));

  // ── 4. Mapping dialog — headers auto-detect ────────────────────────────────
  await expect(page.getByRole('heading', { name: /map columns/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Preview 5 rows/i })).toBeVisible();
  await page.getByRole('button', { name: /Preview 5 rows/i }).click();

  // ── 5. Preview dialog — summary counts and errors ──────────────────────────
  await expect(page.getByRole('heading', { name: /confirm finish sheet import/i })).toBeVisible();
  await expect(page.getByText(/3 finishers/i)).toBeVisible();
  await expect(page.getByText(/1 coded entry/i)).toBeVisible();
  await expect(page.getByText(/1 unresolved sail number/i)).toBeVisible();
  await expect(page.getByText(/1 row will be skipped/i)).toBeVisible();
  await expect(page.getByText(/Row 6.*neither finish time nor result code/i)).toBeVisible();

  await page.getByRole('button', { name: /import and replace/i }).click();

  // ── 6. Finish list reflects imported rows in crossing order ────────────────
  // (The series has no handicap fleet / recorded start, so finish times are
  // stored on the record but not displayed. Round-trip persistence is the
  // test that matters here.)
  const items = page.getByRole('listitem');
  await expect(items.nth(0)).toContainText('6413');
  await expect(items.nth(1)).toContainText('15');
  await expect(items.nth(2)).toContainText('9999');
  await expect(items.nth(2)).toContainText(/not registered|Unknown/i);

  // DNF competitor appears in non-finisher list
  const nonFinisher = page.getByTestId('non-finisher-22');
  await expect(nonFinisher).toBeVisible();
  await expect(nonFinisher).toContainText('DNF');

  // ── 7. Save and verify round-trip ──────────────────────────────────────────
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);
  await expect(page.getByText(/3 finishers/)).toBeVisible();

  // Re-open the race; imported data should still be there.
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();
  await expect(page.getByRole('listitem').nth(0)).toContainText('6413');
  await expect(page.getByTestId('non-finisher-22')).toContainText('DNF');
});

test('import per-race finish sheet from Excel (.xlsx)', async ({ page }) => {
  // Same competitors as the CSV happy path; the workbook fixture holds the
  // same sheet with real time-formatted cells (hh:mm:ss serials) and
  // numeric sail-number cells — the cases CSV never exercises.
  await createSeriesQuick(page, { name: 'XLSX Import Race' });

  for (const c of [
    { sail: '15',   name: 'Alice Pearson' },
    { sail: '22',   name: 'Bob Dickson' },
    { sail: '254',  name: 'Carol Walls' },
    { sail: '6413', name: 'Dave Murphy' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sail);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sail, exact: true })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  // Fixture rows: 6413 → 11:55:09, 15 → 11:57:37, 22 → 11:57:15,
  // 254 → DNF, 999 → 12:01:00 (unregistered).
  await page
    .getByTestId('finish-sheet-csv-input')
    .setInputFiles(resolve(__dirname, '../tests/fixtures/xlsx/finish-sheet-times.xlsx'));

  // Mapping dialog — headers auto-detect from the worksheet's header row.
  await expect(page.getByRole('heading', { name: /map columns/i })).toBeVisible();
  await page.getByRole('button', { name: /Preview 5 rows/i }).click();

  await expect(page.getByRole('heading', { name: /confirm finish sheet import/i })).toBeVisible();
  await expect(page.getByText(/4 finishers/i)).toBeVisible();
  await expect(page.getByText(/1 coded entry/i)).toBeVisible();
  await expect(page.getByText(/1 unresolved sail number/i)).toBeVisible();
  await page.getByRole('button', { name: /import and replace/i }).click();

  // Crossing order and the DNF arrived intact from the workbook.
  const items = page.getByRole('listitem');
  await expect(items.nth(0)).toContainText('6413');
  await expect(items.nth(1)).toContainText('15');
  await expect(items.nth(2)).toContainText('22');
  await expect(items.nth(3)).toContainText('999');
  await expect(page.getByTestId('non-finisher-254')).toContainText('DNF');
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
});

test('finish sheet CSV import replaces existing finishes', async ({ page }) => {
  // ── 1. Series + 3 competitors + 1 race ─────────────────────────────────────
  await createSeriesQuick(page, { name: 'CSV Replace Race' });

  for (const c of [
    { sail: 'A', name: 'Alice' },
    { sail: 'B', name: 'Bob' },
    { sail: 'C', name: 'Carol' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sail);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sail, exact: true })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();

  // ── 2. Enter A, B, C manually — that's the "existing" state ────────────────
  for (const sail of ['A', 'B', 'C']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);

  // ── 3. Re-open; import a CSV in REVERSE order ──────────────────────────────
  await page.getByText('Race 1').click();
  const reverseCsv = [
    'sailNumber,finishTime,resultCode',
    'C,,',
    'B,,',
    'A,,',
  ].join('\n');

  // All three rows miss both time AND code, so they'll all be rejected.
  // That's useful: it proves the preview dialog shows errors without mutating state.
  await page
    .getByTestId('finish-sheet-csv-input')
    .setInputFiles(csvBuffer(reverseCsv));
  await page.getByRole('button', { name: /Preview 3 rows/i }).click();
  await expect(page.getByText(/3 rows will be skipped/i)).toBeVisible();

  // Cancel — existing state must be untouched.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('listitem').nth(0)).toContainText('A');
  await expect(page.getByRole('listitem').nth(1)).toContainText('B');
  await expect(page.getByRole('listitem').nth(2)).toContainText('C');

  // ── 4. Now import a valid CSV that reverses the order ─────────────────────
  const validReverseCsv = [
    'sailNumber,finishTime,resultCode',
    'C,12:00:00,',
    'B,12:01:00,',
    'A,12:02:00,',
  ].join('\n');

  await page
    .getByTestId('finish-sheet-csv-input')
    .setInputFiles(csvBuffer(validReverseCsv));
  await page.getByRole('button', { name: /Preview 3 rows/i }).click();
  await expect(page.getByText(/replace the 3 existing finishes/i)).toBeVisible();
  await page.getByRole('button', { name: /import and replace/i }).click();

  // Order is reversed — C is now first.
  await expect(page.getByRole('listitem').nth(0)).toContainText('C');
  await expect(page.getByRole('listitem').nth(1)).toContainText('B');
  await expect(page.getByRole('listitem').nth(2)).toContainText('A');
});
