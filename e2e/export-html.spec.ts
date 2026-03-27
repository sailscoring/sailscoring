import { test, expect } from '@playwright/test';

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
});
