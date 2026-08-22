import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, enableFeatures, importMapColumns } from './helpers';

/**
 * The seeding committee hands over the assignment already made — each boat
 * down as Yellow, Blue or Red on the entry list — rather than an order for
 * the app to deal from. This covers that path end to end: the fleet column
 * lands on `initialFleet` instead of creating fleets, and Round 1 is
 * assigned from it.
 *
 * One row carries a fleet the championship doesn't have, which is how a real
 * entry list arrives: the dialog must refuse to commit until that boat is
 * placed by hand.
 */

const ENTRY_LIST = [
  'Sail,Helm,Fleet',
  'IRL1,A Sailor,Yellow',
  'IRL2,B Sailor,Blue',
  'IRL3,C Sailor,Red',
  'IRL4,D Sailor,yellow',   // the entry list never keeps its case consistent
  'IRL5,E Sailor,Blue',
  'IRL6,F Sailor,Green',    // no such fleet — must be placed by hand
].join('\n');

test('split fleets: import the committee assignment and seed Round 1 from it', async ({
  page,
  signedInEmail,
}) => {
  test.setTimeout(180_000);
  await enableFeatures(page, signedInEmail, ['split-fleets']);
  await createSeriesQuick(page, { name: 'Assigned Worlds' });

  // ── Make it a split-fleet championship, three qualifying fleets ──────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const setupCard = page.getByTestId('split-fleets-card');
  await setupCard.locator('#sf-fleet-count').selectOption('3');
  await setupCard.getByRole('button', { name: 'Enable split fleets' }).click();
  await expect(
    page.getByRole('navigation').getByRole('link', { name: 'Split Fleets' }),
  ).toBeVisible();

  // ── Import the entry list ────────────────────────────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Competitors' }).click();
  await expect(page.getByRole('button', { name: 'Add competitor' })).toBeVisible();
  await page.getByTestId('competitor-import-input').setInputFiles({
    name: 'entries.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(ENTRY_LIST),
  });

  // The Fleets step creates nothing here — the rounds own the fleets — and
  // says so where the grouping control would otherwise be.
  await expect(page.getByRole('dialog')).toContainText('Assigned, not imported');
  await expect(page.getByTestId('group-by-column')).toHaveCount(0);

  await importMapColumns(page);
  // The fleet column is read as the committee's assignment, not as grouping.
  await expect(page.getByRole('dialog')).toContainText('Initial fleet');
  await page.getByRole('button', { name: /Import 6 rows/i }).click();
  await expect(page.getByRole('heading', { name: /import complete/i })).toBeVisible();
  await expect(page.getByText(/6 competitors? added/i)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // No fleet was created from the column: the series keeps its own single
  // fleet until Round 1 is assigned.
  await expect(page.getByRole('row', { name: /IRL1\b/ })).toContainText('Yellow');
  await expect(page.getByRole('row', { name: /IRL6\b/ })).toContainText('Green');

  // ── Assign Round 1 from what was imported ────────────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Split Fleets' }).click();
  await page.getByRole('button', { name: 'Assign Preliminary fleets' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('#sf-seed-order')).toHaveValue('imported');

  // The unknown label is named, and the boat carrying it holds the commit.
  await expect(dialog).toContainText('No fleet is called');
  await expect(dialog).toContainText('Green');
  await expect(dialog).toContainText('1 boat is in no fleet');
  await expect(page.getByRole('button', { name: /Commit Round 1/ })).toBeDisabled();

  // Place it by hand and the ceremony unblocks.
  await dialog.getByLabel('Fleet for IRL6').selectOption('Red');
  const commit = page.getByRole('button', { name: /Commit Round 1 \(2 \/ 2 \/ 2\)/ });
  await expect(commit).toBeEnabled();
  await commit.click();

  // ── The round records where its fleets came from ─────────────────────────
  await expect(page.getByText('Round 1 · Q1 onward')).toBeVisible();
  await expect(page.getByText('Initial assignment · from the entry list')).toBeVisible();
  await expect(page.getByText('Yellow', { exact: false }).first()).toBeVisible();

  // IRL4's lowercase "yellow" landed with IRL1 in the same fleet.
  await page.getByRole('navigation').getByRole('link', { name: 'Competitors' }).click();
  await expect(page.getByRole('row', { name: /IRL4\b/ })).toContainText('Yellow');
});
