import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * E2E for the History tab (#166).
 *
 * Revisions coalesce by *context* (#166 phase 2): editing the same thing folds
 * into one revision, while switching to a different kind of work starts a new
 * one. So entering several finishes for a race is a single revision, but
 * creating the series, adding the race, and entering finishes are three.
 */
test('history tab: deleting a competitor and a race are recorded (#166 audit)', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Delete Capture Series' });

  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('D1');
  await page.getByLabel('Competitor name').fill('Doomed Boat');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'D1' })).toBeVisible();

  // Add then delete a race.
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 1')).toBeVisible();

  // Delete the competitor: open its row editor, then Delete.
  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('cell', { name: 'D1' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByTestId('confirm-dialog-confirm').click();
  await expect(page.getByRole('cell', { name: 'D1' })).toHaveCount(0);

  // History records both the (flat) competitor delete and the race add.
  await page.getByRole('navigation').getByRole('link', { name: 'History' }).click();
  const list = page.getByTestId('revision-list');
  await expect(list).toContainText('Removed competitor D1');
  await expect(list).toContainText('Added Race 1');
});

/**
 * A change no revision captured must not be passed off as part of a later
 * edit's revision (#354). Filing a series in a category stores nothing
 * recoverable, so it snapshots nothing — History used to bucket activity into
 * revisions by timestamp, which let the next unrelated edit adopt it and
 * describe itself with a change its snapshot doesn't contain.
 */
test('history tab: a change with no version behind it is not folded into a later edit', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Unversioned Spec Series' });

  // A category to file it under.
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Manage' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('New category name').fill('Club Racing');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog.getByPlaceholder('New category name')).toHaveValue('');
  await dialog.getByRole('button', { name: 'Done' }).click();

  await page.goto('/');
  await page.getByRole('button', { name: 'Actions for Unversioned Spec Series' }).click();
  await page.getByRole('menuitem', { name: 'Move to category' }).click();
  await page.getByRole('menuitemradio', { name: 'Club Racing' }).click();
  await expect(page.getByRole('heading', { name: 'Club Racing' })).toBeVisible();

  // An unrelated later edit — the one that used to swallow everything back to
  // the previous revision.
  await page.getByRole('link', { name: 'Unversioned Spec Series' }).click();
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 1')).toBeVisible();

  await page.getByRole('navigation').getByRole('link', { name: 'History' }).click();
  await expect(page).toHaveURL(/\/series\/[0-9a-f-]{36}\/history$/);
  const list = page.getByTestId('revision-list');
  await expect(list).toBeVisible();

  // The category move stands on its own, plainly not a saved version…
  await expect(list.getByRole('listitem').filter({ hasText: 'Moved to' })).toHaveCount(1);
  await expect(list).toContainText('not captured in a saved version');
  // …and the race revision describes only what it captured.
  await expect(list.getByRole('listitem').filter({ hasText: 'Added Race 1' })).toHaveCount(1);
  await expect(
    list.getByRole('listitem').filter({ hasText: 'Added Race 1' }).filter({ hasText: 'Moved to' }),
  ).toHaveCount(0);
});

test('history tab: same-context edits coalesce, different contexts split', async ({ page }) => {
  await createSeriesQuick(page, { name: 'History Spec Series' });

  // Two competitors (single adds don't create revisions of their own).
  for (const [sail, name] of [['H1', 'Boat One'], ['H2', 'Boat Two']]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(sail);
    await page.getByLabel('Competitor name').fill(name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: sail })).toBeVisible();
  }

  // A race, then two finishes in it (same context → one revision).
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  for (const sail of ['H1', 'H2']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();

  // History tab.
  await page.getByRole('navigation').getByRole('link', { name: 'History' }).click();
  await expect(page).toHaveURL(/\/series\/[0-9a-f-]{36}\/history$/);

  const list = page.getByTestId('revision-list');
  await expect(list).toBeVisible();

  // The two finishes coalesced into a single finishes revision…
  await expect(
    list.getByRole('listitem').filter({ hasText: 'Recorded finishes for Race 1' }),
  ).toHaveCount(1);
  // …while creating the series and adding the race are their own revisions.
  await expect(list).toContainText('Created the series');
  await expect(list).toContainText('Added Race 1');
});

/**
 * A settings save has to say which setting (#580). The series row carries
 * everything from the discard profile to a publish note and one endpoint
 * writes all of it, so every such save used to read as "Updated series
 * settings" — leaving a scorer unable to tell an accidental change to how the
 * series is scored from someone editing a note.
 */
test('history tab: a scoring change is named, not filed as "settings"', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Named Change Series' });

  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page
    .getByRole('heading', { name: 'Scoring', exact: true })
    .locator('..')
    .getByRole('button', { name: 'Edit ▸' })
    .click();
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByLabel('Rule 1: races sailed').fill('3');
  await page.getByLabel('Rule 1: discards').fill('1');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('1 discard from 3 races ·')).toBeVisible();

  await page.getByRole('navigation').getByRole('link', { name: 'History' }).click();
  const list = page.getByTestId('revision-list');
  await expect(list).toContainText('Changed the discard profile');
  await expect(list).not.toContainText('Updated series settings');
});
