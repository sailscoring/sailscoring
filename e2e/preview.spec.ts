import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick } from './helpers';

/**
 * E2E tests for the in-app Preview modal (#163) — the behaviour unique to the
 * modal itself. The rendered-HTML / Download correctness is covered by the
 * migrated download tests in export-html.spec.ts and friends (all of which now
 * go through Preview → Download); here we cover: the iframe renders the results
 * in-app, Publish hands off to the Publish dialog, and the multi-fleet selector
 * switches which fleet is shown.
 */

test('Preview renders the results page in an in-app iframe', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Preview Cup 2026', venue: 'Howth Yacht Club' });

  for (const [sail, name] of [['42', 'Alice Murphy'], ['7', 'Carol Ryan']]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(sail);
    await page.getByLabel('Competitor name').fill(name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: sail })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  for (const sail of ['42', '7']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  await page.getByRole('link', { name: 'Standings' }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Preview results' })).toBeVisible();

  // The rendered results page is shown inside the iframe.
  // Names appear in both the standings summary and the per-race table, so
  // scope visibility checks to the first match.
  const frame = page.frameLocator('iframe[title="Results preview"]');
  await expect(frame.getByText('Preview Cup 2026')).toBeVisible();
  await expect(frame.getByText('Alice Murphy').first()).toBeVisible();
  await expect(frame.getByText('Carol Ryan').first()).toBeVisible();

  // Single-fleet: no fleet selector, just Download + Publish.
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Download' })).toBeVisible();
});

test('Preview → Publish opens the Publish dialog', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Handoff Regatta', venue: 'HYC' });

  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('1');
  await page.getByLabel('Competitor name').fill('Alice');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: '1' })).toBeVisible();

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await page.getByLabel('Sail number').fill('1');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  await page.getByRole('link', { name: 'Standings' }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();

  const preview = page.getByRole('dialog');
  await expect(preview.locator('iframe')).toBeVisible();
  await preview.getByRole('button', { name: 'Publish' }).click();

  // Preview closes and the Publish dialog takes over.
  await expect(page.getByRole('heading', { name: 'Publish results' })).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('Preview fleet selector switches the rendered fleet', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Multi Preview', venue: 'HYC' });
  await createFleets(page, ['Junior', 'Senior']);

  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const c of [
    { sail: 'J1', name: 'Junior Jane', fleet: 'Junior' },
    { sail: 'S1', name: 'Senior Sam', fleet: 'Senior' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sail);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('checkbox', { name: c.fleet }).check();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sail })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  for (const sail of ['J1', 'S1']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add' }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  await page.getByRole('link', { name: 'Standings' }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();

  const dialog = page.getByRole('dialog');
  const frame = page.frameLocator('iframe[title="Results preview"]');

  // Defaults to the first fleet (Junior). Names appear in both the standings
  // and per-race tables, so use .first() for the visible check; absence is an
  // exact count of zero.
  await expect(frame.getByText('Junior Jane').first()).toBeVisible();
  await expect(frame.getByText('Senior Sam')).toHaveCount(0);

  // Switch to Senior via the selector.
  await dialog.getByRole('combobox').click();
  await page.getByRole('option', { name: 'Senior' }).click();
  await expect(frame.getByText('Senior Sam').first()).toBeVisible();
  await expect(frame.getByText('Junior Jane')).toHaveCount(0);
});
