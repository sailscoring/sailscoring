/**
 * Server round-trip smoke for the finish-sheet CSV importer. One
 * high-signal happy path covering UI → API → repository → Postgres,
 * including a hard reload to confirm the imported sheet survives the
 * in-memory query cache. Companion to `finish-sheet-csv-import.spec.ts`
 * which exercises the fuller happy path.
 */
import { test, expect } from './fixtures';
import { createSeriesQuick, signInFreshUser } from './helpers';

function csvBuffer(content: string) {
  return { name: 'finishes.csv', mimeType: 'text/csv', buffer: Buffer.from(content) };
}

test.describe('finish sheet CSV import, server mode', () => {
  test('import per-race finish sheet from CSV, reload, persists', async ({ page }) => {
    await signInFreshUser(page, 'server-csv-import');

    const seriesName = `Server Mode CSV Import ${Date.now()}`;
    await createSeriesQuick(page, { name: seriesName });
    await expect(page.getByRole('heading', { name: seriesName })).toBeVisible();

    // ── Competitors ──────────────────────────────────────────────────────────
    for (const c of [
      { sail: '15', name: 'Alice Pearson' },
      { sail: '22', name: 'Bob Dickson' },
      { sail: '254', name: 'Carol Walls' },
      { sail: '6413', name: 'Dave Murphy' },
    ]) {
      await page.getByRole('button', { name: 'Add competitor' }).click();
      await page.getByLabel('Sail number').fill(c.sail);
      await page.getByLabel('Competitor name').fill(c.name);
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByRole('cell', { name: c.sail, exact: true })).toBeVisible();
    }

    // ── Race ─────────────────────────────────────────────────────────────────
    await page.getByRole('link', { name: 'Races' }).click();
    await page.getByRole('button', { name: 'Add race' }).click();
    await page.getByText('Race 1').click();
    await expect(page.getByText('Race 1 — results')).toBeVisible();

    // ── Import: 3 finishers + 1 DNF ──────────────────────────────────────────
    const csv = [
      'sailNumber,finishTime,resultCode',
      '6413,11:55:09,',
      '15,11:57:37,',
      '254,11:58:42,',
      '22,,DNF',
    ].join('\n');

    await page.getByTestId('finish-sheet-csv-input').setInputFiles(csvBuffer(csv));
    await page.getByRole('button', { name: /Preview 4 rows/i }).click();
    await expect(
      page.getByRole('heading', { name: /confirm finish sheet import/i }),
    ).toBeVisible();
    await page.getByRole('button', { name: /import and replace/i }).click();

    // Imported rows render in crossing order, DNF lands in non-finishers.
    await expect(page.getByRole('listitem').nth(0)).toContainText('6413');
    await expect(page.getByRole('listitem').nth(1)).toContainText('15');
    await expect(page.getByRole('listitem').nth(2)).toContainText('254');
    await expect(page.getByTestId('non-finisher-22')).toContainText('DNF');
    await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

    // ── Hard reload — the sheet must come back from /api/v1, not the cache ───
    await page.reload();
    await expect(page.getByText('Race 1 — results')).toBeVisible();
    await expect(page.getByRole('listitem').nth(0)).toContainText('6413');
    await expect(page.getByRole('listitem').nth(1)).toContainText('15');
    await expect(page.getByRole('listitem').nth(2)).toContainText('254');
    await expect(page.getByTestId('non-finisher-22')).toContainText('DNF');
  });
});
