import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, downloadFleetHtml, keyboardReorder } from './helpers';

/**
 * A series' sponsors and trophy donors: entered on the Settings tab, in the
 * scorer's order, and named under the header of the published page — the
 * sponsors in one sentence, the donor on a line of its own.
 */

async function downloadedHtml(page: Parameters<typeof downloadFleetHtml>[0]): Promise<string> {
  const download = await downloadFleetHtml(page);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf-8');
}

test('sponsors entered in settings are named on the published page', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Spring Series 2026', venue: 'Kinsale Yacht Club' });

  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('3001');
  await page.getByLabel('Competitor name').fill('Alice Murphy');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: '3001' })).toBeVisible();

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 1')).toBeVisible();

  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  const card = page.getByTestId('sponsors-card');
  await expect(card).toContainText('No sponsors');
  await card.getByRole('button', { name: 'Edit ▸' }).click();

  await page.getByTestId('add-sponsor').click();
  await page.getByLabel('Name of sponsor 1').fill('The Draper Family');
  await page.getByLabel('Kind of sponsor 1').click();
  await page.getByRole('option', { name: 'Trophy donor', exact: true }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);

  await page.getByTestId('add-sponsor').click();
  await page.getByLabel('Name of sponsor 2').fill('Axiom Private Clients');
  await page.locator('#sponsor-url-1').fill('https://axiom.example');

  await page.getByTestId('add-sponsor').click();
  await page.getByLabel('Name of sponsor 3').fill('The Blue Haven Group');

  // The order is the scorer's: put the Blue Haven Group ahead of Axiom.
  await keyboardReorder(page, page.getByTestId('sponsor-drag-2'), 'ArrowUp');
  await expect(page.getByLabel('Name of sponsor 2')).toHaveValue('The Blue Haven Group');
  await expect(page.getByLabel('Name of sponsor 3')).toHaveValue('Axiom Private Clients');
  await expect(page.getByTestId('autosave-note')).toHaveText('Saved');

  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByTestId('sponsors-card')).toContainText(
    'Sponsored by The Blue Haven Group and Axiom Private Clients · Trophy presented by The Draper Family',
  );

  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);
  const html = await downloadedHtml(page);
  expect(html).toContain(
    'Sponsored by The Blue Haven Group and <a href="https://axiom.example" target="_top" rel="noopener">Axiom Private Clients</a>',
  );
  expect(html).toContain('Trophy presented by The Draper Family');
});
