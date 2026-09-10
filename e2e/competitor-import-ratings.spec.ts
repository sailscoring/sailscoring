import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, enableFeatures, importMapColumns } from './helpers';

/**
 * E2E for the competitor import's last step: the ratings offer (#531).
 *
 * An entry list can't say who holds an IRC certificate, so a group scored on
 * scratch and IRC gets an IRC fleet holding every boat in the group. The import
 * ends by offering the rating list, which both fills in the TCCs it has and
 * offers the boats it doesn't rate for removal from the fleet — so the series
 * leaves the importer with nobody carrying a missing-rating warning.
 *
 * The worldwide IRC fetch is stubbed from a fixture, as in
 * update-handicaps-irc-rating.spec.ts, so the test never hits the live listing.
 */

const RATINGS_FIXTURE = {
  updatedAt: '30/05/2026',
  records: [
    { sailNumber: 'IRL1431', boatName: '3 Cheers', ircTcc: 0.932, ircNonSpinTcc: 0.918, isSecondary: false },
    { sailNumber: 'IRL1601', boatName: 'Antix', ircTcc: 1.041, ircNonSpinTcc: 1.02, isSecondary: false },
  ],
};

const CSV = [
  'Sail,Helm,Class',
  'IRL1431,Alpha,Cruisers 1',
  'IRL1601,Bravo,Cruisers 1',
  'IRL9999,Charlie,Cruisers 1',
].join('\n');

test.beforeEach(async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['irc-rating']);
  await page.route('**/api/v1/handicap-sources/irc-rating', (route) =>
    route.fulfill({ json: RATINGS_FIXTURE }),
  );
});

test('the import offers the IRC list for the fleet it left unrated', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Import Ratings Offer' });
  await page.getByRole('link', { name: 'Competitors' }).click();

  // ── Import: group by class, and score the group on IRC as well as scratch ─
  await page.getByTestId('competitor-import-input').setInputFiles({
    name: 'competitors.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(CSV),
  });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.getByTestId('group-by-column').click();
  await page.getByRole('option', { name: /^Class/ }).click();
  await page.getByTestId('add-system-Cruisers 1').click();
  await page.getByRole('menuitem', { name: 'IRC' }).click();

  // The IRC fleet holds the whole group: the file has no IRC column, so the
  // import can't know who is certificated.
  // The fleet's name lives in an input, so the row is found by that control.
  const ircRow = dialog
    .getByTestId('fleet-row')
    .filter({ has: page.getByRole('textbox', { name: 'Name for Cruisers 1 (IRC)' }) });
  await expect(ircRow).toContainText('3 boats');
  await expect(ircRow).toContainText('no IRC column in this file');

  await importMapColumns(page);
  await page.getByRole('button', { name: /Import 3 rows/i }).click();
  await expect(page.getByRole('heading', { name: /import complete/i })).toBeVisible();

  // ── The offer names the gap and the fleet it is in ────────────────────────
  const offer = page.getByTestId('import-ratings-offer');
  await expect(offer).toContainText('3 of 3 boats in Cruisers 1 (IRC) have no IRC TCC.');
  await offer.getByRole('button', { name: 'Fetch IRC TCCs' }).click();

  // ── Straight into the IRC source step, no source picker ──────────────────
  await expect(page.getByText('IRC ratings as of 30/05/2026')).toBeVisible();
  await expect(page.getByRole('cell', { name: '— → 0.932' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '— → 1.041' })).toBeVisible();

  // The boat the list doesn't rate is offered for removal from the IRC fleet.
  await expect(page.getByText('Not on the rating list')).toBeVisible();
  await page.getByLabel('Remove IRL9999 from Cruisers 1 (IRC)').check();

  await page.getByRole('button', { name: /^Apply/ }).click();
  await expect(page.getByText('Handicaps updated')).toBeVisible();
  await expect(page.getByText('2 IRC')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── Back on the Competitors list: rated boats rated, nobody warned ───────
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'IRL1431' })).toContainText('0.932');
  await expect(page.getByRole('row').filter({ hasText: 'IRL1601' })).toContainText('1.041');
  // IRL9999 is out of the IRC fleet and still in the scratch one, so it needs
  // no rating and carries no warning.
  await expect(page.getByLabel(/Missing IRC TCC/)).toHaveCount(0);
});
