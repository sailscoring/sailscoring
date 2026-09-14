import { signedInTest as test, expect } from './fixtures';
import {
  createSeriesQuick,
  downloadFleetHtml,
  enableFeatures,
  keyboardReorder,
  settleFinish,
} from './helpers';

/**
 * The race record (#338/#339): the conditions a race was sailed in, and the
 * race management team that ran it, at both the per-race and series levels.
 *
 * The team also covers the write-your-own role (#591): a job World Sailing's
 * manual has no title for, typed by the scorer, which has to read as typed
 * everywhere the team is shown — and stay behind the same opt-in.
 *
 * The load-bearing assertion is the publish opt-in. Officials are named
 * non-competitors, so with the switch off no team may appear in the exported
 * HTML *or* in the JSON export embedded in it — the test reads the downloaded
 * file to check the names are genuinely absent rather than merely unstyled.
 *
 * Gated behind race-management-metadata (#155), so enable it first.
 */

async function downloadedHtml(page: Parameters<typeof downloadFleetHtml>[0]): Promise<string> {
  const download = await downloadFleetHtml(page);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf-8');
}

test.beforeEach(async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['race-management-metadata']);
});

test('a race records its conditions and team, published only on opt-in', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Wave Regatta 2026', venue: 'Howth Yacht Club' });

  for (const [sailNumber, name] of [
    ['2001', 'Alice Murphy'],
    ['2002', 'Bob Kelly'],
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(sailNumber);
    await page.getByLabel('Competitor name').fill(name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: sailNumber })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 1')).toBeVisible();

  // ── The per-race record ───────────────────────────────────────────────────
  await page.getByText('Race 1', { exact: false }).first().click();
  const line = page.getByTestId('race-metadata');
  await expect(line).toContainText('not recorded');

  for (const sail of ['2001', '2002']) {
    await settleFinish(page, async () => {
      await page.getByLabel('Sail number').fill(sail);
      await page.getByRole('button', { name: 'Add' }).click();
    });
  }

  await line.click();
  const dialog = page.getByTestId('race-metadata-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Minimum wind speed in knots').fill('8');
  await dialog.getByLabel('Maximum wind speed in knots').fill('14');
  await dialog.getByLabel('Wind direction').click();
  await page.getByRole('option', { name: 'SW', exact: true }).click();
  await dialog.getByTestId('race-conditions-notes').fill('Windward-leeward, 3 laps');

  await dialog.getByTestId('race-add-official').click();
  await dialog.getByLabel('Name for team member 1').fill('Jane Smith');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);

  // Role defaults to Race Officer — the World Sailing term for what a club
  // calls the OOD, which is why no such option exists.
  await expect(line).toContainText('Wind 8–14 kt SW · Windward-leeward, 3 laps');
  await expect(line).toContainText('Race Officer: Jane Smith');

  // The races list badges the conditions but not the team.
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);
  const row = page.getByTestId('race-row').filter({ hasText: 'Race 1' });
  await expect(row.getByTestId('race-conditions-badge')).toHaveText(
    'Wind 8–14 kt SW · Windward-leeward, 3 laps',
  );
  await expect(row).not.toContainText('Jane Smith');

  // ── The standing team, and the opt-in that is off by default ─────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  // '../..' is the card: the heading's own parent is just the heading row
  // (title + Edit button), and the collapsed summary is that row's sibling.
  const card = page
    .getByRole('heading', { name: 'Race management team', exact: true })
    .locator('../..');
  await expect(card).toContainText('No standing team recorded');
  await card.getByRole('button', { name: 'Edit ▸' }).click();

  await page.getByTestId('series-add-official').click();
  await page.getByLabel('Role for team member 1').click();
  await page.getByRole('option', { name: 'Principal Race Officer', exact: true }).click();
  await page.getByLabel('Name for team member 1').fill('Ann Kelly');

  // A job the manual has no title for: the scorer writes it out themselves.
  await page.getByTestId('series-add-official').click();
  await page.getByLabel('Role for team member 2').click();
  await page.getByRole('option', { name: 'Other…', exact: true }).click();
  // Radix hands focus back to the trigger a beat after the listbox goes, and
  // it would take it off the drag handle mid-reorder below. Wait it out.
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await page.getByLabel('Written-out role for team member 2').fill('Beach Master');
  await page.getByLabel('Name for team member 2').fill('Sam Doyle');

  // The order is the scorer's to state, so it is theirs to correct. Drag the
  // beach master above the PRO by keyboard; the rest of the test then follows
  // that order all the way to the published file.
  await keyboardReorder(page, page.getByTestId('series-official-drag-1'), 'ArrowUp');
  await expect(page.getByLabel('Name for team member 1')).toHaveValue('Sam Doyle');
  await expect(page.getByLabel('Name for team member 2')).toHaveValue('Ann Kelly');

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();

  const publishSwitch = page.getByLabel('Publish the race management team');
  await expect(publishSwitch).not.toBeChecked();

  // ── With the opt-in off, no name reaches the published file ──────────────
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);
  const unpublished = await downloadedHtml(page);
  expect(unpublished).toContain('Wave Regatta 2026');
  // Conditions describe the racing, not a person, so they publish regardless.
  expect(unpublished).toContain('Wind 8–14 kt SW');
  expect(unpublished).not.toContain('Ann Kelly');
  expect(unpublished).not.toContain('Jane Smith');
  expect(unpublished).not.toContain('Sam Doyle');

  // ── Turn it on ───────────────────────────────────────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  // Collapsed again on a fresh visit, so this is the stored team as it reads.
  await expect(
    page.getByRole('heading', { name: 'Race management team', exact: true }).locator('../..'),
  ).toContainText('Beach Master: Sam Doyle · Principal Race Officer: Ann Kelly');
  await page
    .getByRole('heading', { name: 'Race management team', exact: true })
    .locator('..')
    .getByRole('button', { name: 'Edit ▸' })
    .click();
  await page.getByLabel('Publish the race management team').check();
  await expect(page.getByLabel('Publish the race management team')).toBeChecked();

  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/standings$/);
  const published = await downloadedHtml(page);
  expect(published).toContain('Race Officer: Jane Smith');
  // The written-out role reads exactly as typed, beside the manual's own, and
  // the standing team keeps the order the scorer dragged it into.
  expect(published).toContain('Beach Master: Sam Doyle · Principal Race Officer: Ann Kelly');
});

test('the record is absent when the feature is off', async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, []);
  await createSeriesQuick(page, { name: 'Ungated Series 2026' });

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 1')).toBeVisible();

  await page.getByText('Race 1', { exact: false }).first().click();
  await expect(page.getByTestId('race-metadata')).toHaveCount(0);

  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { name: 'Race management team' })).toHaveCount(0);
});
