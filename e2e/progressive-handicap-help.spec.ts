import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick, enableFeatures, setScoringMode } from './helpers';

/**
 * The explanation attached to the progressive-handicap blend rates (#574):
 * a visible sentence beside each control, and a ? that puts the help section
 * in front of the scorer without taking the settings screen away.
 *
 * The two controls sit in different places — the ECHO α is on the fleet row,
 * the NHC rates are in a modal — and the ? has to behave differently in each,
 * which is what these two tests pin down.
 */

test.beforeEach(async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['echo', 'nhc-parameters']);
});

async function openFleetsCard(page: import('@playwright/test').Page, system: 'ECHO' | 'NHC') {
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: system }).click();
}

test('the ECHO blend rate is explained on the page, and its ? opens the panel beside it', async ({ page }) => {
  await createSeriesQuick(page, { name: 'ECHO Help 2026' });
  await createFleets(page, ['ECHO']);
  await setScoringMode(page, 'handicap');
  await openFleetsCard(page, 'ECHO');

  // The sentence is on the page, not hidden in a tooltip: a scorer on a
  // touch screen has no way to hover the α box.
  const note = page.getByTestId('echo-alpha-note');
  await expect(note).toBeVisible();
  await expect(note).toContainText('0.25');
  await expect(note).toContainText('0.50');

  const settingsUrl = page.url();
  const panel = page.getByTestId('help-panel');
  await expect(panel).toHaveCount(0);

  await page.getByTestId('help-hint-tuning-progressive-handicaps').click();

  // The section is open in the panel and the settings screen is still there,
  // on the same URL — the whole point of answering in the panel.
  await expect(panel).toHaveAttribute('data-state', 'open');
  await expect(panel.getByRole('heading', { name: 'Tuning a progressive handicap' })).toBeVisible();
  await expect(panel).toContainText('Irish Sailing');
  expect(page.url()).toBe(settingsUrl);
  await expect(page.getByTestId('echo-alpha-note')).toBeVisible();
});

test('the NHC dialog explains its rates, and its ? goes to the page rather than behind the modal', async ({ page }) => {
  await createSeriesQuick(page, { name: 'NHC Help 2026' });
  await createFleets(page, ['NHC']);
  await setScoringMode(page, 'handicap');
  await openFleetsCard(page, 'NHC');
  await page.getByRole('button', { name: 'Configure…' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('chase recent form');
  // Each rate says which boat it moves, not just which symbol it is.
  await expect(dialog).toContainText('beat its rating');
  await expect(dialog).toContainText('fell short');

  // A modal owns the screen and the focus, so the ? can't hand the reader a
  // panel underneath it — it is a plain link to the page instead.
  const hint = dialog.getByTestId('help-hint-tuning-progressive-handicaps');
  await expect(hint).toHaveAttribute(
    'href',
    '/help/rating-systems#tuning-progressive-handicaps',
  );
  await expect(hint).toHaveAttribute('target', '_blank');

  const popup = page.waitForEvent('popup');
  await hint.click();
  const helpPage = await popup;
  await expect(
    helpPage.getByRole('heading', { name: 'Tuning a progressive handicap' }),
  ).toBeVisible();
  await helpPage.close();

  // The dialog is untouched and no panel opened behind it.
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('help-panel')).toHaveCount(0);
});
