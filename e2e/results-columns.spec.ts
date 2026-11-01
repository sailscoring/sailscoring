import { signedInTest as test, expect } from './fixtures';
import { addCompetitor, createSeriesQuick, downloadFleetHtml, enableFeatures } from './helpers';

/**
 * Custom results columns (#718): the escape hatch from automatic columns. A
 * series adds a custom field on the Competitor fields card, then sets its own
 * columns through the Results columns dialog — an opening screen first, then
 * the list — and the published page follows its order and titles.
 */
test('a series adds a custom field and sets its own results columns', async ({ page, signedInEmail }) => {
  await createSeriesQuick(page, { name: 'WASZP Columns' });
  await enableFeatures(page, signedInEmail, ['custom-columns']);

  // A custom field, from the Competitor fields card.
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  const fieldsCard = page.getByRole('heading', { name: 'Competitor fields' }).locator('../..');
  await page.getByRole('heading', { name: 'Competitor fields' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await expect(page.getByTestId('results-columns-line')).toContainText('Results columns: chosen from these fields');
  await fieldsCard.getByRole('button', { name: 'Add a field' }).click();
  await page.getByLabel('Name of the new field').fill('Rig');
  await fieldsCard.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByLabel('Rig field name')).toHaveValue('Rig');

  // The competitor dialog has an input for it, and the table a column.
  await page.getByRole('navigation').getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number *').fill('101');
  await page.getByLabel('Competitor name').fill('Alice');
  await page.getByLabel('Rig').fill('8.2');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: '8.2' })).toBeVisible();
  await addCompetitor(page, { sailNumber: '202', name: 'Bob' });

  // Set the series' own columns: the opening screen, then the list.
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Competitor fields' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Change results columns…' }).click();
  const dialog = page.getByTestId('results-columns-dialog');
  await expect(dialog.getByTestId('results-columns-intro')).toContainText('From then on the columns change only when you change them');
  await dialog.getByRole('button', { name: 'Set this series’ columns' }).click();
  await expect(dialog.getByTestId('column-row-sailNumber')).toBeVisible();
  await expect(dialog.locator('[data-testid^="column-row-field:"]')).toContainText('custom field');

  // Retitle the sail number.
  await dialog.getByTestId('open-column-sailNumber').click();
  const editor = dialog.getByTestId('column-editor');
  await editor.getByLabel('Title').fill('Bib Number');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByTestId('column-row-sailNumber')).toContainText('Bib Number');

  // Move Rig up above the sail number, from the keyboard: one place at a
  // time, each move saved before the next.
  const rigKey = `field:${await rigFieldId(dialog)}`;
  const order = () =>
    dialog.locator('[data-testid^="column-row-"]').evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
  const position = async (key: string) => (await order()).indexOf(`column-row-${key}`);
  while ((await position(rigKey)) > (await position('sailNumber'))) {
    const before = await position(rigKey);
    await dialog.getByTestId(`open-column-${rigKey}`).focus();
    await page.keyboard.press('Alt+ArrowUp');
    await expect.poll(() => position(rigKey)).toBe(before - 1);
  }

  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('results-columns-line')).toContainText('Results columns: set for this series');

  // The published page follows: Rig, then the retitled sail number.
  await page.getByRole('navigation').getByRole('link', { name: 'Standings' }).click();
  const download = await downloadFleetHtml(page);
  const stream = await download.createReadStream();
  const html = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
  const head = html.match(/<tr class="titlerow">([\s\S]*?)<\/tr>/)?.[1] ?? '';
  const headers = [...head.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => m[1]);
  expect(headers.indexOf('Rig')).toBeGreaterThanOrEqual(0);
  expect(headers.indexOf('Rig')).toBeLessThan(headers.indexOf('Bib Number'));
  expect(html).toContain('<td>8.2</td>');
});

/** The id of the series' one custom field, read off its row in the dialog. */
async function rigFieldId(dialog: import('@playwright/test').Locator): Promise<string> {
  const id = await dialog.locator('[data-testid^="column-row-field:"]').first().getAttribute('data-testid');
  return (id ?? '').slice('column-row-field:'.length);
}
