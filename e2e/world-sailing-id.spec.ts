import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, enableFeatures, importMapColumns } from './helpers';

/**
 * E2E for the World Sailing Sailor ID (#362): recording the ID from an entry
 * list, and carrying an organising authority's seed ranking on a later import
 * of the same list.
 *
 * The datafeed check is deliberately not exercised here — it reaches World
 * Sailing, and an e2e suite that depends on a third party being up is a suite
 * that fails for reasons no one can fix.
 */

function csv(name: string, content: string) {
  return { name, mimeType: 'text/csv', buffer: Buffer.from(content) };
}

test('Sailor IDs come in with the entry list, and a later import ranks them', async ({
  page,
  signedInEmail,
}) => {
  await enableFeatures(page, signedInEmail, ['world-sailing-id']);
  await createSeriesQuick(page, { name: 'Worlds Qualifier' });

  // ── 1. The field is off until the series asks for it ──────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page
    .getByRole('heading', { name: 'Competitor fields' })
    .locator('..')
    .getByRole('button', { name: 'Edit ▸' })
    .click();
  await page.getByRole('checkbox', { name: 'World Sailing ID' }).check();
  // Seeding rank is offered by the same feature, for the ranking that decides
  // the first day's qualifying fleets.
  await page.getByRole('checkbox', { name: 'Seeding rank' }).check();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 2. An entry list carrying Sailor IDs ─────────────────────────────────
  await page.getByRole('link', { name: 'Competitors' }).click();
  // Anchor on a control the Competitors page owns before touching its
  // contents — the previous tab is still mounted for a moment after the click.
  await expect(page.getByRole('button', { name: 'Add competitor' })).toBeVisible();
  await page.getByTestId('competitor-import-input').setInputFiles(
    csv(
      'entries.csv',
      [
        'Sail Number,Competitor Name,Nat,World Sailing ID',
        'IRL 215,Mark McLoughlin,IRL,IRLMM1',
        'GBR 41,Hannah Mills,GBR,GBRHM15',
        'AUS 7,Tom Burton,AUS,',
      ].join('\n'),
    ),
  );
  await expect(page.getByRole('dialog')).toBeVisible();
  await importMapColumns(page);
  await page.getByRole('button', { name: /Import 3 rows/i }).click();
  await expect(page.getByRole('heading', { name: /import complete/i })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // The ID lands in its own column, linked to the sailor's biography.
  await expect(page.getByRole('columnheader', { name: 'WS ID' })).toBeVisible();
  const idLink = page.getByRole('link', { name: 'IRLMM1' });
  await expect(idLink).toHaveAttribute(
    'href',
    'https://www.sailing.org/sailor/?ref=IRLMM1',
  );

  // ── 3. The seed ranking, as a column on the same entry list ──────────────
  // The organising authority's ranking arrives after the entries, so it goes
  // back in the way it came: the same spreadsheet with a rank column added.
  // One sailor the ranking doesn't cover, as a real ranking has.
  await page.getByTestId('competitor-import-input').setInputFiles(
    csv(
      'entries-seeded.csv',
      [
        'Sail Number,Competitor Name,Nat,World Sailing ID,Seeding rank',
        'IRL 215,Mark McLoughlin,IRL,IRLMM1,17',
        'GBR 41,Hannah Mills,GBR,GBRHM15,3',
        'AUS 7,Tom Burton,AUS,,',
      ].join('\n'),
    ),
  );
  await expect(page.getByRole('dialog')).toBeVisible();
  await importMapColumns(page);
  await page.getByRole('button', { name: /Import 3 rows/i }).click();
  await expect(page.getByRole('heading', { name: /import complete/i })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 4. The published ranks are what's stored, not a renumbering ──────────
  await expect(page.getByRole('columnheader', { name: 'Seeding rank' })).toBeVisible();
  const row = (sail: string) => page.getByRole('row').filter({ hasText: sail });
  await expect(row('GBR 41').getByRole('cell', { name: '3', exact: true })).toBeVisible();
  await expect(row('IRL 215').getByRole('cell', { name: '17', exact: true })).toBeVisible();
});
