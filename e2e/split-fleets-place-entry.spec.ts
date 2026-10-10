import type { Page } from '@playwright/test';

import { signedInTest as test, expect } from './fixtures';
import { addCompetitor, createSplitFleetSeries, enableFeatures, showStageSettings } from './helpers';

/**
 * An assignment corrected after it is committed: an entry moved to another
 * fleet of the round, two entries dealt the wrong way round swapped with
 * their boats, and an entry added after the commit placed in a fleet.
 * Before this, the only correction was deleting the round and its races.
 */

const DEMO_COUNT = 24;

const configSaved = (page: Page) =>
  page.waitForResponse(
    (r) =>
      /\/api\/v1\/series\/[^/]+\/split-fleets$/.test(r.url()) &&
      r.request().method() === 'PUT' &&
      r.ok(),
  );

async function addDemoCompetitors(page: Page) {
  await page.getByRole('button', { name: `Add ${DEMO_COUNT} demo competitors` }).click();
  await expect(page.getByRole('button', { name: `Add ${DEMO_COUNT} demo competitors` })).toBeHidden();
}

test('split fleets: two entries on one boat, dealt the wrong way round, are swapped', async ({
  page,
  signedInEmail,
}) => {
  test.setTimeout(180_000);
  await enableFeatures(page, signedInEmail, ['split-fleets']);
  await createSplitFleetSeries(page, { name: 'Keelboat Cup', fleetCount: 2 });
  await showStageSettings(page, 'Qualification series');
  await Promise.all([configSaved(page), page.locator('#sf-boats').selectOption('drawn')]);
  await addDemoCompetitors(page);

  // ── Round 1, boats 401 upwards in each fleet ─────────────────────────────
  await page.getByRole('button', { name: 'Assign Preliminary fleets' }).click();
  const assign = page.getByRole('dialog');
  const rows = assign.locator('tbody tr');
  await expect(rows).toHaveCount(DEMO_COUNT);
  const entryOn = new Map<string, { sail: string; name: string }>();
  const next = new Map<string, number>();
  for (let i = 0; i < DEMO_COUNT; i++) {
    const row = rows.nth(i);
    const fleet = await row.getByRole('combobox').inputValue();
    const n = (next.get(fleet) ?? 400) + 1;
    next.set(fleet, n);
    entryOn.set(`${fleet} ${n}`, {
      sail: (await row.locator('td').nth(1).innerText()).trim(),
      name: (await row.locator('td').nth(2).innerText()).trim(),
    });
    await row.locator('[data-boat-cell]').fill(String(n));
  }
  await assign.getByRole('checkbox', { name: /Also create/ }).check();
  await assign.getByRole('button', { name: /Commit Round 1/ }).click();
  await expect(page.getByText('Round 1 · QP1 onward')).toBeVisible();

  // Yellow's QP1 is sailed: the committee hails 401.
  const a = entryOn.get('Yellow 401')!;
  const b = entryOn.get('Blue 401')!;
  const q1Row = page.getByTestId('logical-race-qualifying-1');
  await q1Row.getByRole('link', { name: /Yellow · enter finishes/ }).click();
  await expect(page).toHaveURL(/\/races\//);
  await page.getByLabel('Sail number').fill('401');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('last-recorded')).toContainText(a.name);
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.goBack();
  await expect(page.getByText('Round 1 · QP1 onward')).toBeVisible();

  // ── The swap: A to Blue on 401 is B's boat there ─────────────────────────
  await page.getByRole('button', { name: 'Move an entry…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#sf-place-entry').selectOption({ label: `${a.sail} ${a.name}` });
  await expect(dialog.locator('#sf-place-fleet option:checked')).toHaveText('Blue');
  // She keeps her boat number by default — and in Blue it is B's.
  await expect(dialog.locator('#sf-place-boat')).toHaveValue('401');
  await expect(dialog).toContainText(`Boat 401 in Blue is drawn for ${b.sail} ${b.name}`);
  await expect(dialog.getByRole('button', { name: 'Move to Blue' })).toBeDisabled();
  await dialog.getByRole('button', { name: `Swap ${a.sail} and ${b.sail}` }).click();

  // Yellow has raced, so the result is shown before the dialog goes.
  const warning = page.getByTestId('sf-place-warning');
  await expect(warning).toContainText(`${a.sail} is now scored in Blue`);
  await expect(warning).toContainText("Her result in QP1 is on another fleet's sheet and no longer counts");
  await expect(warning).toContainText(`${b.sail} is now scored in Yellow`);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.getByRole('button', { name: 'Yellow boats' }).click();
  await expect(page.getByRole('dialog').getByLabel(`Boat for ${b.name}`)).toHaveValue('401');
  await expect(page.getByRole('dialog').getByLabel(`Boat for ${a.name}`)).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Blue boats' }).click();
  await expect(page.getByRole('dialog').getByLabel(`Boat for ${a.name}`)).toHaveValue('401');
  await page.getByRole('button', { name: 'Cancel' }).click();

  // ── A plain move, onto a spare boat ──────────────────────────────────────
  const c = entryOn.get('Yellow 402')!;
  await page.getByRole('button', { name: 'Move an entry…' }).click();
  await dialog.locator('#sf-place-entry').selectOption({ label: `${c.sail} ${c.name}` });
  await expect(dialog).toContainText(`Boat 402 in Blue is drawn for ${entryOn.get('Blue 402')!.sail}`);
  await dialog.locator('#sf-place-boat').fill('413');
  await dialog.getByRole('button', { name: 'Move to Blue' }).click();
  await expect(page.getByTestId('sf-place-warning')).toContainText(`${c.sail} is now scored in Blue`);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: 'Blue boats' })).toContainText('13');
  await expect(page.getByRole('button', { name: 'Yellow boats' })).toContainText('11');
  await page.getByRole('button', { name: 'Blue boats' }).click();
  await expect(page.getByRole('dialog').getByLabel(`Boat for ${c.name}`)).toHaveValue('413');
});

test('split fleets: an entry added after the assignment is placed in a fleet', async ({
  page,
  signedInEmail,
}) => {
  test.setTimeout(120_000);
  await enableFeatures(page, signedInEmail, ['split-fleets']);
  await createSplitFleetSeries(page, { name: 'Late Entry Cup', fleetCount: 2 });
  await addDemoCompetitors(page);
  await page.getByRole('button', { name: 'Assign Preliminary fleets' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Commit Round 1/ }).click();
  await expect(page.getByText('Round 1 · QP1 onward')).toBeVisible();
  const splitFleetsUrl = page.url();

  await page.goto(splitFleetsUrl.replace(/\/split-fleets$/, '/competitors'));
  await addCompetitor(page, { sailNumber: '299999', name: 'Late Entry' });

  await page.goto(splitFleetsUrl);
  const notice = page.getByRole('button', { name: '1 entry is in no fleet — place it' });
  await notice.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('#sf-place-entry option:checked')).toHaveText('299999 Late Entry');
  await dialog.locator('#sf-place-fleet').selectOption({ label: 'Blue' });
  await dialog.getByRole('button', { name: 'Place in Blue' }).click();
  await expect(dialog).toBeHidden();
  await expect(notice).toBeHidden();
  await page.getByRole('button', { name: 'Move an entry…' }).click();
  await expect(
    dialog.locator('optgroup[label="Blue"] option', { hasText: '299999 Late Entry' }),
  ).toHaveCount(1);
});
