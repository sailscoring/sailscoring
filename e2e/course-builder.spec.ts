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

  // A laid windward mark, logged as a bearing and distance off the line —
  // magnetic, as the committee reads it off a compass.
  await page.getByTestId('new-mark').click();
  await page.getByLabel('Name').fill('Z — 12 Sep R1');
  await page.getByText('Bearing & distance').click();
  await page.getByRole('textbox', { name: 'Bearing', exact: true }).fill('190');
  await page.getByRole('textbox', { name: 'Distance', exact: true }).fill('0.54');
  await expect(page.getByTestId('mark-position-echo')).toContainText('→ 53° 23.7');
  await page.getByRole('button', { name: 'Save' }).click();
  const zRow = page.getByTestId('mark-row').filter({ hasText: 'Z — 12 Sep R1' });
  await expect(zRow).toBeVisible();
  await expect(zRow).toContainText('0.54 NM @ 190°M from Start — 12 Sep');

  // Adopt the club's charted marks first — the natural order of the tab. The
  // catalogue's first set belongs to another club, so both dialogs have to
  // start from the set the library's marks came from, not from the top of it.
  await page.getByTestId('adopt-card').click();
  await pick(page, 'adopt-dialog-set', 'Howth Yacht Club — Autumn League 2026');
  await pick(page, 'adopt-dialog-card', /offshore/);
  await page.getByTestId('adopt-save').click();
  await expect(page.getByText('From the card')).toBeVisible();
  // The club's own water under its marks: the set's captured chart, fetched
  // from the app's origin and drawn inside the SVG, not linked from it.
  const drawing = page.getByTestId('course-drawing');
  await expect(drawing).toHaveAttribute('data-chart', 'set');
  await expect(drawing.locator('image')).toHaveAttribute('href', /^data:image\/png;base64,/);
  await expect(drawing).toContainText('© OpenStreetMap contributors');
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
  // to finish at the committee boat rather than at the card's line ashore.
  await courseRow.getByRole('button', { name: 'Actions for K1 — 12 Sep R1' }).click();
  await page.getByRole('menuitem', { name: 'Swap a mark…' }).click();
  await pick(page, 'swap-from', 'FH Finish line');
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
  await page.getByPlaceholder('14:05', { exact: true }).fill('14:00:00');
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
  // The card's 180° is true; the start shows it in magnetic, a degree or so
  // east of it off Howth.
  await expect(page.getByLabel('Wind direction')).toHaveValue(/^18[01]\.\d$/);
  const cardWind = await page.getByLabel('Wind direction').inputValue();
  await expect(page.getByTestId('legs-disclosure')).toContainText(/Legs \(\d+\)/);
  await page.getByTestId('legs-disclosure').click();
  await expect(page.getByLabel('Leg 1 distance')).not.toHaveValue('');
  await expect(page.getByLabel('Leg 1 wind direction')).toHaveValue(cardWind);
  // Every generated leg is recorded to 0.01 NM, the precision ORC scores a
  // course at — not to the thousandth the geometry could give.
  for (const input of await page.getByLabel(/^Leg \d+ distance$/).all()) {
    expect(await input.inputValue()).toMatch(/^\d+(\.\d{1,2})?$/);
  }
  await expect(page.getByTestId('legs-edited')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByTitle('The course this start sailed')).toHaveText('K1 — 12 Sep R1');

  // Editing a leg flags the start; recomputing from the course clears it.
  await page.getByRole('button', { name: 'Edit start' }).click();
  await page.getByTestId('legs-disclosure').click();
  await expect(page.getByText(/Drawn from the legs/)).toHaveCount(0);
  await page.getByLabel('Leg 1 distance').fill('0.60');
  await expect(page.getByTestId('legs-edited')).toBeVisible();
  // The edited legs are what will score, so they are what draws — unlocated,
  // and captioned as such, rather than the course's marks.
  await expect(page.getByText(/Drawn from the legs/)).toBeVisible();
  await page.getByTestId('recompute-legs').click();
  await page.getByRole('button', { name: 'Recompute' }).click();
  await expect(page.getByTestId('legs-edited')).toHaveCount(0);
  await expect(page.getByText(/Drawn from the legs/)).toHaveCount(0);
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
  // The chart travels inside the page: a results page fetches nothing, and
  // the tile sources are credited where their pixels are shown.
  expect(html).toContain('<image href="data:image/png;base64,');
  expect(html).toContain('© OpenStreetMap contributors · © OpenSeaMap contributors');
});

test("a course that is the committee's leg table, pasted once and reused", async ({ page }) => {
  await createSeriesQuick(page, { name: 'Leg Table Course 2026' });
  await createFleets(page, ['Class 2']);
  await setScoringMode(page, 'handicap');
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'ORC' }).click();
  await page.getByRole('combobox').filter({ hasText: 'All-purpose · time-on-time' }).click();
  await page.getByRole('option', { name: 'Constructed course at the recorded wind · time-on-time' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  // The committee's own table, as it comes out of a spreadsheet: a header, a
  // row-number column, and the wind alongside — none of which is a leg.
  const committeeTable = [
    'Leg\tDistance\tBearing\tTWD\tTWS',
    '1\t0.80\t059°\t225°\t9',
    '2\t0.80\t239°\t225°\t9',
    '3\t1.104\t130°\t225°\t9',
    '4\t0.60\t228°\t225°\t9',
    '5\t0.60\t023°\t225°\t9',
    '6\t0.90\t311°\t225°\t9',
    '7\t1.70\t032°\t225°\t9',
    '8\t0.20\t218°\t225°\t9',
    '9\t1.20\t196°\t225°\t9',
    '10\t0.50\t249°\t225°\t9',
    '11\t2.00\t026°\t225°\t9',
    '12\t2.00\t206°\t225°\t9',
  ].join('\n');

  await page.getByRole('navigation').getByRole('link', { name: 'Courses' }).click();
  await expect(page.getByRole('heading', { name: 'Marks' })).toBeVisible();
  await page.getByTestId('new-course').click();
  await page.getByTestId('course-source-legs').click();

  await page.getByTestId('paste-legs-disclosure').click();
  await page.getByLabel('Leg table to paste').fill(committeeTable);
  // What it made of the paste, before it is committed: the header skipped,
  // the row numbers recognised, the wind columns ignored.
  // With no venue position there is nothing to convert at, so the table is
  // read as true and the dialog says so.
  await expect(page.getByTestId('paste-legs-preview')).toHaveText('12 legs · 12.40 NM · bearings in °T');
  await page.getByTestId('paste-legs-add').click();
  await expect(page.getByLabel('Leg 1 distance')).toHaveValue('0.8');
  await expect(page.getByLabel('Leg 1 bearing')).toHaveValue('59');
  // A leg written to a thousandth arrives at the hundredth it is scored at.
  await expect(page.getByLabel('Leg 3 distance')).toHaveValue('1.1');
  await expect(page.getByLabel('Leg 12 bearing')).toHaveValue('206');
  await expect(page.getByLabel('Leg 13 distance')).toHaveCount(0);
  await expect(page.getByText('12.40 NM total')).toBeVisible();
  // No wind on a course: the same course runs on a different night.
  await expect(page.getByLabel('Leg 1 wind direction')).toHaveCount(0);

  // Drawn from the legs, and it says how nearly the course closes — 0.07 NM
  // over twelve legs rounded to a tenth of a mile.
  await expect(page.getByTestId('course-drawing')).toBeVisible();
  await expect(page.getByTestId('leg-course-closure')).toContainText('0.07 NM');
  await expect(page.getByTestId('leg-course-closure')).toContainText('rounding each leg to a tenth');

  await page.getByLabel('Name').fill('RC table — 13 Aug');
  await expect(page.getByTestId('course-summary')).toContainText('12 legs · 12.40 NM');
  await page.getByTestId('course-save').click();

  const courseRow = page.getByTestId('course-row').filter({ hasText: 'RC table — 13 Aug' });
  await expect(courseRow).toBeVisible();
  await expect(courseRow).toContainText('leg table');
  await expect(courseRow).toContainText('12 legs · 12.40 NM');
  // The bearings stand in for a mark sequence, because there are no marks.
  await expect(courseRow).toContainText('59°T › 239°T');

  // A leg stray enough to matter shows in the closure figure — the failure
  // that put a 13th leg into a scored race.
  await courseRow.getByRole('button', { name: 'Actions for RC table — 13 Aug' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Add leg' }).click();
  await page.getByLabel('Leg 13 distance').fill('0.87');
  await page.getByLabel('Leg 13 bearing').fill('240.5');
  await expect(page.getByTestId('leg-course-closure')).toContainText('more than rounding explains');
  await page.getByRole('button', { name: 'Remove leg 13' }).click();
  await expect(page.getByTestId('leg-course-closure')).toContainText('rounding each leg to a tenth');
  await page.getByTestId('course-save').click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // There are no marks on it to swap.
  await courseRow.getByRole('button', { name: 'Actions for RC table — 13 Aug' }).click();
  await expect(page.getByRole('menuitem', { name: 'Swap a mark…' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Two races a fortnight apart, both sailing it: pick the course, give the
  // night its own wind, and the legs are filled. That reuse is the whole
  // reason to save a course rather than type the table on each start.
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 2')).toBeVisible();
  for (const { race, windDir, windKt } of [
    { race: 'Race 1', windDir: '225', windKt: '9' },
    { race: 'Race 2', windDir: '190', windKt: '12' },
  ]) {
    await page.getByText(race).click();
    // With more than one race the "Race N — results" heading gives way to the
    // race switcher, which is the stable anchor either way.
    await expect(page.getByRole('button', { name: 'Switch race' })).toHaveText(race);
    await page.getByRole('button', { name: 'Edit ▸' }).click();
    await page.getByRole('button', { name: 'Add start' }).click();
    await page.getByPlaceholder('14:05', { exact: true }).fill('19:00:00');
    await pick(page, 'start-course-picker', 'RC table — 13 Aug');
    await page.getByLabel('Wind direction').fill(windDir);
    await page.getByLabel('Wind speed', { exact: true }).fill(windKt);
    await page.getByTestId('legs-disclosure').click();
    await expect(page.getByLabel('Leg 1 distance')).toHaveValue('0.8');
    await expect(page.getByLabel('Leg 1 wind direction')).toHaveValue(windDir);
    await expect(page.getByLabel('Leg 1 wind speed')).toHaveValue(windKt);
    await expect(page.getByLabel('Leg 12 bearing')).toHaveValue('206');
    // Picking a course is not editing its legs.
    await expect(page.getByTestId('legs-edited')).toHaveCount(0);
    // And it draws: a course with no positions is still a shape, so the
    // start must not claim there is nothing to draw.
    await expect(page.getByTestId('course-drawing')).toBeVisible();
    await expect(page.getByTestId('course-drawing-empty')).toHaveCount(0);
    await expect(page.getByText(/Drawn from the legs/)).toBeVisible();
    await page.getByRole('checkbox', { name: 'Class 2' }).check();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByText(`12.40 NM · 12 legs · ${windKt} kt`)).toBeVisible();
    await expect(page.getByTitle('The course this start sailed')).toHaveText('RC table — 13 Aug');
    await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
    await expect(page).toHaveURL(/\/races$/);
  }
});

test('a leg table in magnetic, entered as the race officer wrote it', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Magnetic Legs 2026' });
  await createFleets(page, ['Class 2']);
  await setScoringMode(page, 'handicap');
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'ORC' }).click();
  await page.getByRole('combobox').filter({ hasText: 'All-purpose · time-on-time' }).click();
  await page.getByRole('option', { name: 'Constructed course at the recorded wind · time-on-time' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  // A leg table has no marks to place it, so the variation needs the venue.
  await page.getByRole('navigation').getByRole('link', { name: 'Courses' }).click();
  await expect(page.getByRole('heading', { name: 'Marks' })).toBeVisible();
  await expect(page.getByTestId('venue-position')).toContainText('stay in °T');
  await page.getByTestId('venue-position-edit').click();
  await page.getByLabel('Venue position').fill('51 48.000 N 008 18.000 W');
  await page.getByTestId('venue-position-save').click();
  // Cork Harbour: magnetic north a degree or two west of true.
  await expect(page.getByTestId('venue-position')).toContainText(/variation \d(\.\d)?°W today/);

  await page.getByTestId('new-course').click();
  await page.getByTestId('course-source-legs').click();
  await expect(page.getByRole('radio', { name: '°M' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('bearing-ref')).toContainText('World Magnetic Model');

  // The race officer's table in magnetic, one leg marked true: the mark is
  // honoured, the rest read in the dialog's reference.
  await page.getByTestId('paste-legs-disclosure').click();
  await page.getByLabel('Leg table to paste').fill('0.24\t105\n1.10\t290T');
  await expect(page.getByTestId('paste-legs-preview')).toHaveText(
    '2 legs · 1.34 NM · bearings in °M and °T (unmarked ones read as °M)',
  );
  await page.getByTestId('paste-legs-add').click();
  await expect(page.getByLabel('Leg 1 bearing')).toHaveValue('105');
  await expect(page.getByLabel('Leg 2 bearing')).toHaveValue(/^29[1-3](\.\d)?$/);

  // Switching to true re-shows every figure; switching back restores them.
  await page.getByRole('radio', { name: '°T' }).click();
  await expect(page.getByLabel('Leg 2 bearing')).toHaveValue('290');
  await expect(page.getByLabel('Leg 1 bearing')).toHaveValue(/^10[34](\.\d)?$/);
  await page.getByRole('radio', { name: '°M' }).click();
  await expect(page.getByLabel('Leg 1 bearing')).toHaveValue('105');

  await page.getByLabel('Name').fill('RO table — 4 Oct');
  await page.getByTestId('course-save').click();
  const courseRow = page.getByTestId('course-row').filter({ hasText: 'RO table — 4 Oct' });
  await expect(courseRow).toContainText('105°M › 29');

  // Opened again, the figures are the ones typed: stored true, shown back
  // in magnetic at the same variation.
  await courseRow.getByRole('button', { name: 'Actions for RO table — 4 Oct' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await expect(page.getByLabel('Leg 1 bearing')).toHaveValue('105');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // A start picks it, with the race officer's wind off the compass.
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05', { exact: true }).fill('19:00:00');
  await pick(page, 'start-course-picker', 'RO table — 4 Oct');
  await expect(page.getByRole('radio', { name: '°M' })).toHaveAttribute('aria-checked', 'true');
  await page.getByLabel('Wind direction').fill('232');
  await page.getByLabel('Wind speed', { exact: true }).fill('9');
  await page.getByTestId('legs-disclosure').click();
  await expect(page.getByLabel('Leg 1 bearing')).toHaveValue('105');
  await expect(page.getByLabel('Leg 1 wind direction')).toHaveValue('232');
  await page.getByRole('checkbox', { name: 'Class 2' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // Saved and reopened, nothing has moved — and the legs are still the
  // course's own, not an edit.
  await page.getByRole('button', { name: 'Edit start' }).click();
  await expect(page.getByLabel('Wind direction')).toHaveValue('232');
  await page.getByTestId('legs-disclosure').click();
  await expect(page.getByLabel('Leg 1 bearing')).toHaveValue('105');
  await expect(page.getByLabel('Leg 1 wind direction')).toHaveValue('232');
  await expect(page.getByTestId('legs-edited')).toHaveCount(0);
});

test("a card course routed round the headland by the set's passages", async ({ page }) => {
  await createSeriesQuick(page, { name: 'Routed Course Test 2026' });
  await createFleets(page, ['Keelboats']);
  await setScoringMode(page, 'handicap');
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'ORC' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('navigation').getByRole('link', { name: 'Courses' }).click();
  await expect(page.getByRole('heading', { name: 'Marks' })).toBeVisible();
  // The Grassy Walk line, where Royal Cork's passages assume it.
  await page.getByTestId('new-mark').click();
  await page.getByLabel('Name').fill('SL — 5 Oct R1');
  await page.getByRole('textbox', { name: 'Coordinates' }).fill('51 48.714 N 008 16.996 W');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('mark-row').filter({ hasText: 'SL — 5 Oct R1' })).toBeVisible();

  // Course 14 runs out to Ringabella and back in to Cage, both across Rams
  // Head as the crow flies: the passages take each round it.
  await page.getByTestId('new-course').click();
  await pick(page, 'course-card-set', /Royal Cork/);
  await pick(page, 'course-card', /keelboat/i);
  await pick(page, 'course-number', /^14\b/);
  await pick(page, 'placement-SL', 'SL — 5 Oct R1');
  const routing = page.getByTestId('course-routing');
  await expect(routing).toContainText('Leg 2 goes by W2 and RW_Rams_Head, not the straight line');
  await expect(routing).toContainText("Pat Tanner's passages");
  const drawing = page.getByRole('dialog').getByTestId('course-drawing');
  await expect(drawing).toContainText('2b');
  await expect(drawing.locator('title', { hasText: 'RW_Rams_Head' })).toHaveCount(1);
  await page.getByTestId('course-save').click();
  await expect(page.getByTestId('course-row')).toBeVisible();
});

test('a card course saves the marks the card has moved since they were adopted', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Moved Marks Test 2026' });
  await createFleets(page, ['Keelboats']);
  await setScoringMode(page, 'handicap');
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'ORC' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  const seriesId = page.url().match(/\/series\/([0-9a-f-]+)/)![1];
  // Harp, as an older release of Royal Cork's set placed it: 82 m from
  // where the set has it now.
  const harpId = crypto.randomUUID();
  const seeded = await page.request.post(`/api/v1/series/${seriesId}/marks`, {
    data: {
      marks: [
        {
          id: harpId,
          seriesId,
          name: 'Harp',
          lat: 51.7865,
          lng: -8.236833,
          card: { set: 'rcyc/keelboat-2026', markId: 'Harp', release: '0.8.0' },
          shape: 'conical',
          color: 'yellow',
          createdAt: Date.now(),
        },
        { id: crypto.randomUUID(), seriesId, name: 'Grassy Start', lat: 51.8119083, lng: -8.2832667, createdAt: Date.now() },
      ],
    },
  });
  expect(seeded.ok()).toBe(true);

  await page.getByRole('navigation').getByRole('link', { name: 'Courses' }).click();
  await expect(page.getByTestId('mark-row').filter({ hasText: 'Grassy Start' })).toBeVisible();
  await page.getByTestId('new-course').click();
  await pick(page, 'course-card-set', /Royal Cork/);
  await pick(page, 'course-card', /keelboat/i);
  await pick(page, 'course-number', /^3\b/);
  await pick(page, 'placement-SL', 'Grassy Start');
  await expect(page.getByTestId('course-marks-moved')).toContainText('Harp 82 m');
  await page.getByTestId('course-save').click();
  await expect(page.getByTestId('course-row')).toBeVisible();

  // The library now holds Harp where the dialog drew it.
  const marks: Array<{ id: string; lat: number; lng: number; card?: { release: string } }> =
    await (await page.request.get(`/api/v1/series/${seriesId}/marks`)).json();
  const harp = marks.find((m) => m.id === harpId)!;
  expect(harp).toMatchObject({ lat: 51.786667, lng: -8.238 });
  expect(harp.card?.release).not.toBe('0.8.0');
});
