/**
 * A scorer builds a course from the race-start dialog. Starts are race-day
 * work and take `score`; so does the course library a start picks from, or a
 * scorer could fill in a whole course only to be refused at the save.
 *
 * Base Playwright (two contexts = two sessions); console errors are guarded
 * manually, as in fine-grained-roles.spec.ts.
 */
import { test, expect, type Page } from '@playwright/test';

import {
  addMemberByEmail,
  createFleets,
  createOrgWorkspace,
  createSeriesQuick,
  enableOrgFeatures,
  setActiveWorkspace,
  setScoringMode,
  signInFreshUser,
} from './helpers';

test('a scorer saves a course made from the race-start dialog', async ({ browser }) => {
  const ctxOwner = await browser.newContext();
  const ctxScorer = await browser.newContext();
  const owner: Page = await ctxOwner.newPage();
  const scorer: Page = await ctxScorer.newPage();

  const errors: string[] = [];
  for (const [who, pg] of [
    ['owner', owner],
    ['scorer', scorer],
  ] as const) {
    pg.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
    pg.on('console', (m) => {
      if (m.type() === 'error') errors.push(`${who}: ${m.text()}`);
    });
  }

  try {
    const stamp = Date.now();
    const emailOwner = await signInFreshUser(owner, `course-owner-${stamp}`);
    const emailScorer = await signInFreshUser(scorer, `course-scorer-${stamp}`);
    const org = await createOrgWorkspace(`Course Panel ${stamp}`);
    await enableOrgFeatures(org.id, ['fine-grained-roles', 'orc']);
    await addMemberByEmail(org.id, emailOwner, 'owner');
    await addMemberByEmail(org.id, emailScorer, 'scorer');
    await setActiveWorkspace(owner, org.id);
    await setActiveWorkspace(scorer, org.id);

    // The owner sets up an ORC fleet scored over a constructed course, and
    // the first race.
    const seriesName = `Course Series ${stamp}`;
    await createSeriesQuick(owner, { name: seriesName });
    await createFleets(owner, ['Class 2']);
    await setScoringMode(owner, 'handicap');
    await owner.locator('h2', { hasText: 'Fleets' }).locator('..').locator('button').click();
    await owner.getByRole('combobox').filter({ hasText: /Scratch/i }).click();
    await owner.getByRole('option', { name: 'ORC' }).click();
    await owner.getByRole('combobox').filter({ hasText: 'All-purpose · time-on-time' }).click();
    await owner.getByRole('option', { name: 'Constructed course at the recorded wind · time-on-time' }).click();
    await owner.getByRole('button', { name: 'Done' }).click();
    await owner.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
    await owner.getByRole('button', { name: 'Add race' }).click();
    await expect(owner.getByText('Race 1')).toBeVisible();

    // The scorer adds the start, and the course the committee set with it.
    await scorer.goto('/');
    await scorer.getByText(seriesName).click();
    await scorer.waitForURL(/\/series\/[0-9a-f-]{36}\/competitors$/);
    await scorer.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
    await scorer.getByText('Race 1').click();
    await expect(scorer.getByText('Race 1 — results')).toBeVisible();
    await scorer.getByRole('button', { name: 'Edit ▸' }).click();
    await scorer.getByRole('button', { name: 'Add start' }).click();
    await scorer.getByPlaceholder('14:05', { exact: true }).fill('19:00:00');

    await scorer.getByTestId('start-new-course').click();
    await scorer.getByTestId('course-source-legs').click();
    await scorer.getByTestId('paste-legs-disclosure').click();
    await scorer.getByLabel('Leg table to paste').fill(['0.80\t059', '0.80\t239'].join('\n'));
    await expect(scorer.getByTestId('paste-legs-preview')).toContainText('2 legs · 1.60 NM');
    await scorer.getByTestId('paste-legs-add').click();
    await scorer.getByRole('textbox', { name: 'Name', exact: true }).fill('RC table — 13 Aug');
    await scorer.getByTestId('course-save').click();

    // Saved, and picked on the start.
    await expect(scorer.getByTestId('start-course-picker')).toContainText('RC table — 13 Aug');
    await scorer.getByLabel('Wind direction').fill('225');
    await scorer.getByLabel('Wind speed', { exact: true }).fill('9');
    await scorer.getByRole('checkbox', { name: 'Class 2' }).check();
    await scorer.getByRole('button', { name: 'Save' }).click();
    await expect(scorer.getByRole('dialog')).toBeHidden();
    await expect(scorer.getByTitle('The course this start sailed')).toHaveText('RC table — 13 Aug');

    // The library is still not the scorer's to clear wholesale.
    const seriesId = scorer.url().match(/\/series\/([0-9a-f-]{36})\//)![1];
    const clear = await scorer.request.delete(`/api/v1/series/${seriesId}/courses`);
    expect(clear.status()).toBe(403);
  } finally {
    await ctxOwner.close();
    await ctxScorer.close();
    if (errors.length > 0) {
      throw new Error(`unexpected console/page errors:\n${errors.join('\n')}`);
    }
  }
});
