import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick, downloadFleetHtml, enableFeatures, setScoringMode } from './helpers';

/**
 * E2E for the ORC course builder: the mark library (a mark by coordinates,
 * a mark by bearing and distance), a course from the club's card with the
 * laid mark placed, Swap a mark…, a race start picking the course with its
 * legs filled at the card's wind, an edited leg flagged and recomputed, and
 * the drawing on the results page. The card files are vendored under
 * public/course-cards/ at build time, so nothing is stubbed for them; the
 * ORC certificate fetch is stubbed as in orc-handicap.spec.ts.
 */

const SAMPLE = JSON.parse(
  readFileSync(join(__dirname, '../tests/fixtures/orc/downrms-irl-sample.json'), 'utf-8').replace(/^﻿/, ''),
) as { rms: Array<Record<string, unknown>> };

function cert(yachtName: string) {
  const record = SAMPLE.rms.find((r) => r.YachtName === yachtName);
  if (!record) throw new Error(`no fixture certificate for ${yachtName}`);
  return { record, expiryDate: '2026-12-31T00:00:00.000Z', vppYear: 2026 };
}

const LISTING_FIXTURE = {
  updatedAt: '19/08/2026',
  countryId: 'IRL',
  family: 'ORC',
  records: [cert('IMPETUOUS'), cert('MOJO')],
  scoringOptions: [],
};

test.beforeEach(async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['orc']);
  await page.route('**/api/v1/handicap-sources/orc?*', (route) => route.fulfill({ json: LISTING_FIXTURE }));
});

async function pick(page: import('@playwright/test').Page, testId: string, option: string | RegExp) {
  await page.getByTestId(testId).click();
  await page.getByRole('option', { name: option }).click();
}

test('marks, a course from the card, a start that picks it, and the drawing on the page', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Course Builder Test 2026' });
  await createFleets(page, ['Class 2']);
  await setScoringMode(page, 'handicap');
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'ORC' }).click();
  await page.getByRole('combobox').filter({ hasText: 'All-purpose · time-on-time' }).click();
  await page.getByRole('option', { name: 'Constructed course · performance curve (PCS)' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const c of [{ sailNumber: 'IRL 2507', name: 'Impetuous' }, { sailNumber: 'IRL 1551', name: 'Mojo' }]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sailNumber })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Update handicaps' }).click();
  await page.getByText('ORC certificates', { exact: true }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('ORC certificates as of 19/08/2026')).toBeVisible();
  await page.getByRole('button', { name: /^Apply/ }).click();
  await expect(page.getByText('Handicaps updated')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // The Courses tab appears because a fleet scores ORC.
  await page.getByRole('navigation').getByRole('link', { name: 'Courses' }).click();
  await expect(page.getByRole('heading', { name: 'Marks' })).toBeVisible();

  // A mark by coordinates, echoed canonically as it is typed.
  await page.getByTestId('new-mark').click();
  await page.getByLabel('Name').fill('Start — 12 Sep');
  await page.getByRole('textbox', { name: 'Coordinates' }).fill('53 24.330 N 006 04.050 W');
  await expect(page.getByTestId('mark-position-echo')).toHaveText('→ 53° 24.330′ N 006° 04.050′ W');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('mark-row').filter({ hasText: 'Start — 12 Sep' })).toBeVisible();

  // A laid windward mark, logged as a bearing and distance off the line.
  await page.getByTestId('new-mark').click();
  await page.getByLabel('Name').fill('Z — 12 Sep R1');
  await page.getByText('Bearing & distance').click();
  await page.getByRole('textbox', { name: 'Bearing', exact: true }).fill('190');
  await page.getByRole('textbox', { name: 'Distance', exact: true }).fill('0.54');
  await expect(page.getByTestId('mark-position-echo')).toContainText('→ 53° 23.7');
  await page.getByRole('button', { name: 'Save' }).click();
  const zRow = page.getByTestId('mark-row').filter({ hasText: 'Z — 12 Sep R1' });
  await expect(zRow).toBeVisible();
  await expect(zRow).toContainText('0.54 NM @ 190° from Start — 12 Sep');

  // Adopt the club's charted marks first — the natural order of the tab. The
  // catalogue's first set belongs to another club, so both dialogs have to
  // start from the set the library's marks came from, not from the top of it.
  await page.getByTestId('adopt-card').click();
  await pick(page, 'adopt-dialog-set', 'Howth Yacht Club — Autumn League 2026');
  await pick(page, 'adopt-dialog-card', /offshore/);
  await page.getByTestId('adopt-save').click();
  await expect(page.getByText('From the card')).toBeVisible();
  await page.getByTestId('adopt-card').click();
  await expect(page.getByTestId('adopt-dialog-set')).toContainText('Howth Yacht Club');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByTestId('new-course').click();
  await expect(page.getByTestId('course-card-set')).toContainText('Howth Yacht Club');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // A course from the card: HYC's 2026 offshore K1 (laid out for 180°),
  // whose start line and Z the card cannot place — the card quotes the
  // sailing instructions for the line and says Z is laid upwind of it, so
  // pick the marks just made for both.
  await page.getByTestId('new-course').click();
  await pick(page, 'course-card-set', 'Howth Yacht Club — Autumn League 2026');
  await pick(page, 'course-card', /offshore/);
  // The two card selects share a grid row and the catalogue's names are long:
  // neither may overlap the other or run past the dialog.
  const dialogBox = (await page.getByRole('dialog').boundingBox())!;
  const setBox = (await page.getByTestId('course-card-set').boundingBox())!;
  const cardBox = (await page.getByTestId('course-card').boundingBox())!;
  expect(setBox.x + setBox.width).toBeLessThanOrEqual(cardBox.x + 1);
  expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width + 1);
  await pick(page, 'course-number', /^K1\b/);
  await expect(page.getByTestId('placement-SL')).toBeVisible();
  await pick(page, 'placement-SL', 'Start — 12 Sep');
  await expect(page.getByTestId('placement-Z')).toBeVisible();
  await pick(page, 'placement-Z', 'Z — 12 Sep R1');
  await expect(page.getByTestId('course-summary')).toContainText('legs');
  await page.getByLabel('Name').fill('K1 — 12 Sep R1');
  await page.getByTestId('course-save').click();
  const courseRow = page.getByTestId('course-row').filter({ hasText: 'K1 — 12 Sep R1' });
  await expect(courseRow).toBeVisible();
  await expect(courseRow).toContainText('K1');
  // The card's charted marks were adopted along with it.
  await expect(page.getByText('From the card')).toBeVisible();

  // Swap a mark…: a duplicate with one mark exchanged — the course shortened
  // to finish at the line rather than out at Stack.
  await courseRow.getByRole('button', { name: 'Actions for K1 — 12 Sep R1' }).click();
  await page.getByRole('menuitem', { name: 'Swap a mark…' }).click();
  await pick(page, 'swap-from', 'K Stack');
  await pick(page, 'swap-to', 'Start — 12 Sep');
  await page.getByLabel('New course name').fill('K1 short — 12 Sep R1');
  await page.getByTestId('swap-save').click();
  await expect(page.getByTestId('course-row').filter({ hasText: 'K1 short — 12 Sep R1' })).toBeVisible();

  // Build by hand: Add mark is an action select holding no value, so it has
  // to position off its trigger — item-aligned placement has no selected item
  // to align to and never places the menu at all.
  await page.getByTestId('new-course').click();
  await page.getByText('Build by hand').click();
  const addMark = page.getByTestId('sequence-add-mark');
  await addMark.click();
  const menu = page.getByRole('listbox');
  await expect(menu).toBeVisible();
  const triggerBox = (await addMark.boundingBox())!;
  const menuBox = (await menu.boundingBox())!;
  // Over the trigger, and tall enough to be a list rather than one clipped row.
  expect(Math.abs(menuBox.x - triggerBox.x)).toBeLessThan(40);
  expect(menuBox.height).toBeGreaterThan(triggerBox.height * 2);
  await page.getByRole('option', { name: 'Start — 12 Sep', exact: true }).click();
  await addMark.click();
  await page.getByRole('option', { name: 'Z — 12 Sep R1', exact: true }).click();
  await addMark.click();
  await page.getByRole('option', { name: 'Start — 12 Sep', exact: true }).click();
  // Shorten at… is the same shape — a select whose value is never set.
  await page.getByRole('button', { name: 'Shorten at…' }).click();
  await page.getByTestId('sequence-shorten-at').click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.getByRole('option', { name: /Z — 12 Sep R1/ }).click();
  // Shortened at Z, so the hand-built course is line → Z and nothing more.
  await expect(page.getByTestId('course-summary')).toContainText('1 leg');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // A race start picks the course: legs fill in at the card's 180° wind.
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 1')).toBeVisible();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05:00').fill('14:00:00');
  // Saved without a course first: PCS has no curve to look an implied wind up
  // on, so the race is not scored — and the standings say so rather than
  // quietly ranking it on crossing order.
  await page.getByRole('checkbox', { name: 'Class 2' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByText(/its start has no course/)).toBeVisible();
  await page.getByRole('link', { name: 'Races' }).click();
  await expect(page.getByRole('button', { name: 'Add race' })).toBeVisible();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Edit start' }).click();
  await pick(page, 'start-course-picker', 'K1 — 12 Sep R1');
  await expect(page.getByLabel('Wind direction')).toHaveValue('180');
  await expect(page.getByTestId('legs-disclosure')).toContainText(/Legs \(\d+\)/);
  await page.getByTestId('legs-disclosure').click();
  await expect(page.getByLabel('Leg 1 distance')).not.toHaveValue('');
  await expect(page.getByLabel('Leg 1 wind direction')).toHaveValue('180');
  await expect(page.getByTestId('legs-edited')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByTitle('The course this start sailed')).toHaveText('K1 — 12 Sep R1');

  // Editing a leg flags the start; recomputing from the course clears it.
  await page.getByRole('button', { name: 'Edit start' }).click();
  await page.getByTestId('legs-disclosure').click();
  await page.getByLabel('Leg 1 distance').fill('0.60');
  await expect(page.getByTestId('legs-edited')).toBeVisible();
  await page.getByTestId('recompute-legs').click();
  await page.getByRole('button', { name: 'Recompute' }).click();
  await expect(page.getByTestId('legs-edited')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByTitle('The course this start sailed')).toHaveText('K1 — 12 Sep R1');

  for (const { sailNumber, finishTime } of [
    { sailNumber: 'IRL 1551', finishTime: '15:20:00' },
    { sailNumber: 'IRL 2507', finishTime: '15:23:00' },
  ]) {
    await page.getByLabel('Sail number').fill(sailNumber);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('textbox', { name: 'Finish time', exact: true }).fill(finishTime);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // The results page carries the course drawing beside the leg record.
  await page.getByRole('link', { name: 'Standings' }).click();
  const download = await downloadFleetHtml(page);
  const html = readFileSync(await download.path(), 'utf-8');
  expect(html).toContain('Constructed course');
  expect(html).toContain('<details class="orc-course"><summary>Show course</summary>');
  expect(html).toContain('class="orc-course-drawing"');
  expect(html).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
  expect(html).toContain('aria-label="Course K1 — 12 Sep R1"');
});
