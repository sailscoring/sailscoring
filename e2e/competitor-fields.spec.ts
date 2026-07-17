import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, downloadFleetHtml } from './helpers';

/**
 * E2E tests for configurable competitor fields (#64) and crew name (#69).
 *
 * Exercises the Settings → Competitor fields card, confirms the Competitors
 * form + table respect the toggles, and checks that crew names render in the
 * exported HTML as "Helm / Crew".
 */

test('crew name toggle shows Crew column and exports "Helm / Crew"', async ({ page }) => {
  // ── 1. Create series ──────────────────────────────────────────────────────
  await createSeriesQuick(page, { name: 'Fireball Frostbite' });

  // ── 2. Switch to Helm-primary and turn off the default Boat column so the
  //     rest of the test exercises the enable path explicitly. ──────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Competitor fields' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('radio', { name: /^Helm/ }).click();
  await page.getByRole('checkbox', { name: 'Boat name' }).uncheck();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('link', { name: 'Competitors' }).click();

  // ── 3. By default (after step 2): Crew column is hidden, Crew field is not in the form ──
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await expect(page.getByLabel('Crew 1')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel' }).click();

  // ── 4. Enable crew name in Settings → Competitor fields ──────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Competitor fields' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('checkbox', { name: 'Crew', exact: true }).check();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 5. Add a competitor with helm + crew ────────────────────────────────
  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('14702');
  await page.getByLabel('Helm name').fill('Jane Doe');
  await page.getByLabel('Crew 1').fill('Mark Smith');
  await page.getByRole('button', { name: 'Save' }).click();

  // ── 6. Competitors table now has a Crew column ───────────────────────────
  await expect(page.getByRole('columnheader', { name: 'Crew' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Mark Smith' })).toBeVisible();

  // ── 7. Toggling Boat name adds the column ───────────────────────────────
  await expect(page.getByRole('columnheader', { name: 'Boat', exact: true })).toHaveCount(0);
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Competitor fields' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('checkbox', { name: 'Boat name' }).check();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('link', { name: 'Competitors' }).click();
  await expect(page.getByRole('columnheader', { name: 'Boat', exact: true })).toBeVisible();

  // ── 8. Add a race so export is possible ─────────────────────────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await page.getByLabel('Sail number').fill('14702');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // ── 9. Preview → Download and verify combined "Helm / Crew" rendering ────
  await page.getByRole('link', { name: 'Standings' }).click();
  const download = await downloadFleetHtml(page);
  const path = await download.path();
  const fs = await import('node:fs');
  const html = fs.readFileSync(path, 'utf-8');

  // Header uses the combined label — Helm primary + crew enabled
  expect(html).toContain('<th>Helm / Crew</th>');
  // Row body uses slash form
  expect(html).toContain('Jane Doe / Mark Smith');
  // Boat column is now visible after the enable in step 7
  expect(html).toContain('<th>Boat</th>');
});

test('multi-person crew: Add crew rows, stacked column, stacked export', async ({ page }) => {
  // ── 1. Series with Helm primary + Crew enabled ──────────────────────────
  await createSeriesQuick(page, { name: 'Keelboat Crew List' });
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Competitor fields' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('radio', { name: /^Helm/ }).click();
  await page.getByRole('checkbox', { name: 'Crew', exact: true }).check();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 2. Add a competitor with three crew via "Add crew" ──────────────────
  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('635');
  await page.getByLabel('Helm name').fill('Cormac Farrelly');
  await page.getByLabel('Crew 1').fill('Alice Byrne');
  await page.getByRole('button', { name: 'Add crew' }).click();
  // "Add crew" focuses the appended row — type straight into it.
  await expect(page.getByLabel('Crew 2')).toBeFocused();
  await page.getByLabel('Crew 2').fill('Bob Malone');
  await page.getByRole('button', { name: 'Add crew' }).click();
  await page.getByLabel('Crew 3').fill('Carol Doyle');
  await page.getByRole('button', { name: 'Save' }).click();

  // ── 3. Crew column stacks all three names in one cell ───────────────────
  const crewCell = page.getByRole('cell', { name: 'Alice Byrne' });
  await expect(crewCell).toContainText('Bob Malone');
  await expect(crewCell).toContainText('Carol Doyle');

  // ── 4. Removing a row updates the stored list ───────────────────────────
  await page.getByRole('row').filter({ hasText: '635' }).click();
  const editDialog = page.getByRole('dialog', { name: 'Edit competitor' });
  await expect(editDialog.getByLabel('Crew 2')).toHaveValue('Bob Malone');
  await editDialog.getByLabel('Crew 2').locator('..').getByRole('button', { name: 'Remove' }).click();
  await expect(editDialog.getByLabel('Crew 2')).toHaveValue('Carol Doyle');
  await editDialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'Alice Byrne' })).not.toContainText('Bob Malone');

  // ── 5. Race + finish so the fleet HTML can be exported ──────────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await page.getByLabel('Sail number').fill('635');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // ── 6. Exported HTML stacks the crew under the helm ─────────────────────
  await page.getByRole('link', { name: 'Standings' }).click();
  const download = await downloadFleetHtml(page);
  const path = await download.path();
  const fs = await import('node:fs');
  const html = fs.readFileSync(path, 'utf-8');
  expect(html).toContain('<th>Helm / Crew</th>');
  expect(html).toContain('Cormac Farrelly<br>Alice Byrne<br>Carol Doyle');
});

test('class field shows Class column and exports in results', async ({ page }) => {
  await createSeriesQuick(page, { name: 'PY Handicap' });

  // Enable Class in Settings → Competitor fields
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Competitor fields' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByLabel('Class', { exact: true }).check();
  await page.getByRole('button', { name: 'Done' }).click();

  // Add a competitor with a class
  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('207112');
  await page.getByLabel('Competitor name').fill('Jane Doe');
  await page.getByLabel('Class', { exact: true }).fill('Laser');
  await page.getByRole('button', { name: 'Save' }).click();

  // Competitors table now has a Class column
  await expect(page.getByRole('columnheader', { name: 'Class', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Laser' })).toBeVisible();

  // Add a race and export HTML
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await page.getByLabel('Sail number').fill('207112');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  await page.getByRole('link', { name: 'Standings' }).click();
  const download = await downloadFleetHtml(page);
  const path = await download.path();
  const fs = await import('node:fs');
  const html = fs.readFileSync(path, 'utf-8');

  expect(html).toContain('<th>Class</th>');
  expect(html).toContain('>Laser<');
});

test('subdivisions: two axes through the form, standings, and export', async ({ page }) => {
  // ── 1. Create series ──────────────────────────────────────────────────────
  await createSeriesQuick(page, { name: 'ILCA Leinsters' });

  // ── 2. Enable the subdivision field (seeds one "Division" axis), rename it,
  //     and add a second "Age category" axis ──────────────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Competitor fields' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('checkbox', { name: 'Division' }).check();
  // First axis seeded with the default "Division" label; leave it. Add a second.
  await expect(page.getByLabel('Axis 1 label')).toHaveValue('Division');
  await page.getByRole('button', { name: 'Add axis' }).click();
  await page.getByLabel('Axis 2 label').fill('Age category');
  await page.getByLabel('Axis 2 label').blur();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 3. Add two competitors with values on both axes ──────────────────────
  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('1');
  await page.getByLabel('Competitor name').fill('Alice');
  await page.getByLabel('Division', { exact: true }).fill('Gold');
  await page.getByLabel('Age category', { exact: true }).fill('Grand Master');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('columnheader', { name: 'Division' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Age category' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Gold', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Grand Master' })).toBeVisible();

  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('2');
  await page.getByLabel('Competitor name').fill('Bob');
  await page.getByLabel('Division', { exact: true }).fill('Silver');
  await page.getByLabel('Age category', { exact: true }).fill('Apprentice Master');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'Silver', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Apprentice Master' })).toBeVisible();

  // ── 4. Add a race both boats finish ──────────────────────────────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await page.getByLabel('Sail number').fill('1');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByLabel('Sail number').fill('2');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // ── 5. Standings: both axis columns show ─────────────────────────────────
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByRole('columnheader', { name: 'Division' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Age category' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Alice' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Bob' })).toBeVisible();

  // ── 6. Preview → Download carries both columns and the values ────────────
  const download = await downloadFleetHtml(page);
  const path = await download.path();
  const fs = await import('node:fs');
  const html = fs.readFileSync(path, 'utf-8');
  expect(html).toContain('<th>Division</th>');
  expect(html).toContain('<th>Age category</th>');
  expect(html).toContain('>Gold<');
  expect(html).toContain('>Grand Master<');
  expect(html).toContain('>Apprentice Master<');
});

test('disabling a field preserves its data on re-enable', async ({ page }) => {
  // ── 1. Create series and enable Boat name ────────────────────────────────
  await createSeriesQuick(page, { name: 'Persist Test' });
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Competitor fields' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByLabel('Boat name').check();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('link', { name: 'Competitors' }).click();

  // ── 2. Add a competitor with a boat name ─────────────────────────────────
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('1');
  await page.getByLabel('Competitor name').fill('Alice');
  await page.getByLabel('Boat name').fill('Windchaser');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'Windchaser' })).toBeVisible();

  // ── 3. Disable boat name — the column disappears ─────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Competitor fields' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByLabel('Boat name').uncheck();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('link', { name: 'Competitors' }).click();
  await expect(page.getByRole('cell', { name: 'Windchaser' })).toHaveCount(0);

  // ── 4. Re-enable boat name — the data is still there (hide, don't strip) ─
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Competitor fields' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByLabel('Boat name').check();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('link', { name: 'Competitors' }).click();
  await expect(page.getByRole('cell', { name: 'Windchaser' })).toBeVisible();
});

test('a toggle made while a prior save is in flight does not revert it', async ({ page }) => {
  // The lost-update window: save A (uncheck Boat name) is still in flight
  // when the user navigates away and back, so the re-opened card renders
  // from the pre-A cache. Toggle B (check Crew name) must not patch Boat
  // name back to enabled. Hold A's PUT at the network layer to pin the
  // window open deterministically.
  await createSeriesQuick(page, { name: 'In-flight Toggle' });

  let releaseHold!: () => void;
  const hold = new Promise<void>((resolve) => { releaseHold = resolve; });
  let held = false;
  await page.route('**/api/v1/series/*', async (route) => {
    if (route.request().method() === 'PUT' && !held) {
      held = true;
      await hold;
    }
    await route.fallback();
  });

  // ── 1. Uncheck Boat name — save A is now held in flight ──────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Competitor fields' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByLabel('Boat name').uncheck();

  // ── 2. Navigate away and back; the re-opened card shows the stale,
  //       pre-A state (Boat name checked again). Check Crew name — save B
  //       queues behind A. ─────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Competitors' }).click();
  // The transition must commit (competitors page mounted) before heading
  // back: a quick second click can cancel it, leaving the settings page —
  // and the card's expanded state — mounted throughout, so the card never
  // re-renders from the stale cache this step exists to exercise.
  await expect(page.getByRole('button', { name: 'Add competitor' })).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Competitor fields' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByLabel('Crew', { exact: true }).check();

  // ── 3. Release A; once both saves land the card re-syncs to the
  //       persisted row — Boat name must stay unchecked. The re-sync waits on
  //       two sequential round-trips (A drains, then the queued B), so allow a
  //       generous window: under full-suite CPU load the settle can outrun the
  //       default expect timeout even though the final state is deterministic.
  releaseHold();
  await expect(page.getByLabel('Boat name')).not.toBeChecked({ timeout: 15_000 });
  await expect(page.getByLabel('Crew', { exact: true })).toBeChecked({ timeout: 15_000 });

  // ── 4. The persisted state agrees after a full reload ────────────────────
  await page.reload();
  await page.getByRole('heading', { name: 'Competitor fields' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await expect(page.getByLabel('Boat name')).not.toBeChecked();
  await expect(page.getByLabel('Crew', { exact: true })).toBeChecked();
});

test('age and gender: standings columns and export columns (#211)', async ({ page }) => {
  // ── 1. Create series ──────────────────────────────────────────────────────
  await createSeriesQuick(page, { name: 'Optimist Munsters' });

  // ── 2. Enable the Age and Gender fields ──────────────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Competitor fields' }).locator('..').getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('checkbox', { name: 'Age' }).check();
  await page.getByRole('checkbox', { name: 'Gender' }).check();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 3. Add two competitors with age and gender ───────────────────────────
  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const { sail, name, age, gender } of [
    { sail: '1', name: 'Maeve', age: '15', gender: 'F' },
    { sail: '2', name: 'Rian', age: '12', gender: 'M' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(sail);
    await page.getByLabel('Competitor name').fill(name);
    await page.getByLabel('Age').fill(age);
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: gender, exact: true }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: sail, exact: true })).toBeVisible();
  }

  // The Competitors table surfaces the new columns.
  await expect(page.getByRole('columnheader', { name: 'Age' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Gender' })).toBeVisible();

  // ── 4. Add a race both boats finish ──────────────────────────────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await page.getByLabel('Sail number').fill('1');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByLabel('Sail number').fill('2');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // ── 5. Standings: the Age and Gender columns appear ──────────────────────
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByRole('columnheader', { name: 'Age' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Gender' })).toBeVisible();

  // ── 6. Preview → Download carries both columns and the values ────────────
  const download = await downloadFleetHtml(page);
  const path = await download.path();
  const fs = await import('node:fs');
  const html = fs.readFileSync(path, 'utf-8');
  expect(html).toContain('<th>Age</th>');
  expect(html).toContain('<th>Gender</th>');
  expect(html).toContain('<td>15</td>');
  expect(html).toContain('<td>F</td>');
  expect(html).toContain('<td>M</td>');
});
