import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Page } from '@playwright/test';

import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick, downloadFleetHtml, enableFeatures, setScoringMode } from './helpers';

/**
 * E2E for importing an ORC constructed course into a race start
 * (docs/design/orc/constructed-course-format.md): a document refused and
 * why, a course with no position and no venue that can't be converted, an
 * anchored course picked as a file, previewed, filled into the legs as its
 * magnetic figures read, kept on reopening, replaced only when asked, and
 * drawn on the club chart on the published page with each leg under its
 * name. The ORC certificate fetch is stubbed as in orc-handicap.spec.ts.
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

/** A course off Ireland's Eye, as an app that builds courses hands it over. */
const COURSE = {
  format: 'orc-constructed-course',
  version: 1,
  name: 'Autumn League, Race 3, Class 1',
  north: 'magnetic',
  anchor: { lat: 53.40125, lng: -6.08413 },
  legs: [
    { name: 'Start – Windward', distance: 0.67, course: 282, windDirection: 280, windSpeed: 11.5 },
    { name: 'Windward – Gybe', distance: 0.78, course: 144, windDirection: 280, windSpeed: 11.5 },
    { name: 'Gybe – Leeward', distance: 0.73, course: 48, windDirection: 285, windSpeed: 13 },
  ],
};

/** The same course with nothing to say where it is. */
const { anchor: _anchor, ...UNPLACED } = COURSE;

test.beforeEach(async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['orc']);
  await page.route('**/api/v1/handicap-sources/orc?*', (route) => route.fulfill({ json: LISTING_FIXTURE }));
});

/** A series with an ORC fleet scored over a constructed course at the
 *  recorded wind, two certificated boats, and a race whose new start has its
 *  gun time and fleet: the dialog open, ready for a course. */
async function openStartOnConstructedCourse(page: Page, seriesName: string) {
  await createSeriesQuick(page, { name: seriesName });
  await createFleets(page, ['Class 1']);
  await setScoringMode(page, 'handicap');
  await page.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
  await page.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
  await page.getByRole('option', { name: 'ORC' }).click();
  await page.getByRole('combobox').filter({ hasText: 'All-purpose · time-on-time' }).click();
  await page.getByRole('option', { name: 'Constructed course at the recorded wind · time-on-time' }).click();
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
  await page.getByRole('button', { name: /^Apply/ }).click();
  await expect(page.getByText('Handicaps updated')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  await page.getByPlaceholder('14:05', { exact: true }).fill('11:12:00');
  await page.getByRole('checkbox', { name: 'Class 1' }).check();
}

/** Both boats home, then the fleet's published page, as HTML. */
async function finishAndPublish(page: Page): Promise<string> {
  for (const { sailNumber, finishTime } of [
    { sailNumber: 'IRL 1551', finishTime: '11:45:00' },
    { sailNumber: 'IRL 2507', finishTime: '11:47:00' },
  ]) {
    await page.getByLabel('Sail number').fill(sailNumber);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('textbox', { name: 'Finish time', exact: true }).fill(finishTime);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByRole('link', { name: 'Standings' }).click();
  const download = await downloadFleetHtml(page);
  return readFileSync(await download.path(), 'utf-8');
}

test('an ORC constructed course imported into a start, and drawn where it sits', async ({ page }) => {
  await openStartOnConstructedCourse(page, 'Imported Course 2026');

  // The paste box is gone from a start: a course comes in as a document.
  await expect(page.getByTestId('paste-legs-disclosure')).toHaveCount(0);
  await page.getByTestId('import-course-disclosure').click();
  const preview = page.getByTestId('import-course-preview');
  const use = page.getByTestId('import-course-use');

  // A document that isn't the format says why, and can't be used.
  await page.getByLabel('Course to import', { exact: true }).fill(JSON.stringify({ ...COURSE, north: 'true' }));
  await expect(preview).toContainText('from "true" north');
  await expect(use).toBeDisabled();

  // One with no anchor, in a series with no venue position, has nowhere to
  // read the variation at; it can still be used, kept in magnetic.
  await page.getByLabel('Course to import', { exact: true }).fill(JSON.stringify(UNPLACED));
  await expect(preview).toHaveText(
    'Autumn League, Race 3, Class 1 · 3 legs · 2.18 NM · wind direction and speed on every leg · no position',
  );
  await expect(page.getByTestId('import-course-no-variation')).toContainText('The start will keep them in magnetic');
  await expect(use).toBeEnabled();

  // The anchored one, picked as the file its app saved.
  await page.getByLabel('Course file').setInputFiles({
    name: 'course.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(COURSE)),
  });
  await expect(preview).toHaveText(
    'Autumn League, Race 3, Class 1 · 3 legs · 2.18 NM · wind direction and speed on every leg · placed on the water',
  );
  await expect(page.getByTestId('import-course').getByTestId('course-drawing')).toBeVisible();
  await use.click();

  // The legs read as the document gave them: the dialog shows magnetic, at
  // the variation where the first leg starts.
  await expect(page.getByTestId('import-course')).toHaveCount(0);
  await expect(page.getByLabel('Leg 1 name')).toHaveValue('Start – Windward');
  await expect(page.getByLabel('Leg 1 distance')).toHaveValue('0.67');
  await expect(page.getByLabel('Leg 1 bearing')).toHaveValue('282');
  await expect(page.getByLabel('Leg 1 wind direction')).toHaveValue('280');
  await expect(page.getByLabel('Leg 1 wind speed')).toHaveValue('11.5');
  await expect(page.getByLabel('Leg 3 bearing')).toHaveValue('48');
  await expect(page.getByLabel('Leg 3 wind direction')).toHaveValue('285');
  await expect(page.getByLabel('Leg 3 wind speed')).toHaveValue('13');
  await expect(page.getByRole('radio', { name: '°M' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('bearing-ref')).toContainText('World Magnetic Model');
  await expect(page.getByTestId('start-course-picker')).toContainText('Autumn League, Race 3, Class 1 (imported)');
  await expect(page.getByTestId('legs-edited')).toHaveCount(0);
  // On the club's chart, from the one position the course recorded.
  const drawing = page.getByTestId('start-course').getByTestId('course-drawing');
  await expect(drawing).toHaveAttribute('data-chart', 'set');
  await expect(page.getByTestId('course-drawing-caption')).toContainText('from where the first leg starts');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText('2.18 NM · 3 legs · 11.5–13 kt')).toBeVisible();
  await expect(page.getByTitle('The course this start sailed')).toHaveText('Autumn League, Race 3, Class 1');

  // Reopened, nothing has moved; importing over the legs asks first.
  await page.getByRole('button', { name: 'Edit start' }).click();
  await expect(page.getByTestId('start-course-picker')).toContainText('(imported)');
  await page.getByTestId('legs-disclosure').click();
  await expect(page.getByLabel('Leg 1 name')).toHaveValue('Start – Windward');
  await expect(page.getByLabel('Leg 1 bearing')).toHaveValue('282');
  await expect(page.getByTestId('legs-edited')).toHaveCount(0);
  await page.getByTestId('import-course-disclosure').click();
  await page.getByLabel('Course to import', { exact: true }).fill(JSON.stringify({ ...COURSE, name: 'Autumn League, Race 3, re-laid' }));
  await page.getByTestId('import-course-use').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText(
    "This start's 3 legs will be replaced by the 3 legs of Autumn League, Race 3, re-laid.",
  );
  await page.getByTestId('confirm-dialog-cancel').click();
  await expect(page.getByTestId('confirm-dialog')).toBeHidden();
  await expect(page.getByTestId('start-course-picker')).toContainText('Autumn League, Race 3, Class 1 (imported)');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // Published: each leg under its name, and the course on the chart.
  const html = await finishAndPublish(page);
  expect(html).toMatch(/Start – Windward 0\.67 NM @ 282°M \(\d+(\.\d)?°T\)/);
  expect(html).toContain('href="#course-chart-');
  expect(html).toContain('from where the first leg starts');
});

test('a course with nowhere to read the variation at, kept in magnetic', async ({ page }) => {
  await openStartOnConstructedCourse(page, 'Magnetic Course 2026');
  await page.getByTestId('import-course-disclosure').click();
  await page.getByLabel('Course to import', { exact: true }).fill(JSON.stringify(UNPLACED));
  await expect(page.getByTestId('import-course-no-variation')).toBeVisible();
  await expect(page.getByTestId('import-course').getByTestId('course-drawing')).toBeVisible();
  await page.getByTestId('import-course-use').click();

  // The figures read as the document gave them, and stay in magnetic: with
  // no variation there is no choice of north to offer.
  await expect(page.getByLabel('Leg 1 bearing')).toHaveValue('282');
  await expect(page.getByLabel('Leg 3 bearing')).toHaveValue('48');
  await expect(page.getByLabel('Leg 3 wind direction')).toHaveValue('285');
  await expect(page.getByTestId('bearing-ref')).toContainText('Bearings in °M');
  await expect(page.getByRole('radio', { name: '°T' })).toHaveCount(0);
  await expect(page.getByTestId('course-drawing-caption')).toContainText('Magnetic north is up');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // Reopened, still magnetic, and nothing has moved.
  await page.getByRole('button', { name: 'Edit start' }).click();
  await page.getByTestId('legs-disclosure').click();
  await expect(page.getByLabel('Leg 1 bearing')).toHaveValue('282');
  await expect(page.getByTestId('bearing-ref')).toContainText('Bearings in °M');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // Published as given: magnetic, with no true figure beside it, and the
  // drawing magnetic north up.
  const html = await finishAndPublish(page);
  expect(html).toContain('Start – Windward 0.67 NM @ 282°M, wind 280°M at 11.5 kt');
  expect(html).toContain('there was no position to read the variation at');
  expect(html).toContain('Magnetic north is up.');
});
