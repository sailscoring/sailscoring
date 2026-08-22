import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, downloadFleetHtml } from './helpers';

/**
 * Naming a DPI (#424). The scorer records what a discretionary points penalty
 * was given for — "TPO" for a missed safety tally — and the published results
 * carry that word in place of the code, with a line beneath the table saying
 * what it is. The label changes nothing about the score, which is what the
 * test checks alongside it: the boat is still on its DPI points.
 */

test('a named DPI publishes under its name, with a legend explaining it', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Tally Penalty Series' });

  // ── 1. Two boats, one race ───────────────────────────────────────────────
  for (const c of [
    { sailNumber: '1001', name: 'Alice Murphy' },
    { sailNumber: '1002', name: 'Bob Kelly' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sailNumber })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 1')).toBeVisible();

  await page.getByText('Race 1').click();
  for (const sail of ['1001', '1002']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // ── 2. Alice takes a DPI, named for what it was for ──────────────────────
  await page.getByRole('button', { name: 'Row actions for 1001' }).click();
  await page.getByRole('menuitem', { name: 'Set scoring penalty' }).click();
  await page.getByRole('combobox').click();
  await page.getByRole('option', { name: /DPI/ }).click();
  // The points input carries no accessible label of its own (PerFleetPoints
  // renders a bare <label>), so locate it by role.
  await page.getByRole('spinbutton').fill('2');
  await page.getByLabel('What it was for (optional)').fill('TPO');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // ── 3. The published page names it, and says what the name means ─────────
  await page.getByRole('navigation').getByRole('link', { name: 'Standings' }).click();
  const download = await downloadFleetHtml(page);
  const stream = await download.createReadStream();
  const html = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });

  // 1st place plus 2 penalty points, under the scorer's name rather than DPI.
  expect(html).toContain('TPO(2pts)');
  expect(html).not.toContain('DPI(2pts)');
  expect(html).toContain('TPO: discretionary points penalty (DPI), the points as shown.');
});
